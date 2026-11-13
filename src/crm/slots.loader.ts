/**
 * Database adapter for `computeSlots` (spec §5.3): loads everything for one location and date
 * with a fixed number of queries, whatever the number of barbers (no N+1), `depth: 0` + `select`.
 *
 * Access: the loader reads schedules, exceptions and overrides on behalf of the system
 * (`overrideAccess: true`, no `user`) — anonymous visitors must get slots without seeing schedules.
 * It returns only what `computeSlots` needs; the calling endpoint checks who may ask (stages 10, 13).
 */
import type { Payload, PayloadRequest } from 'payload'

import { crmT } from '@/i18n'

import { businessError } from './errors'
import type { BarberSchedule, RelationValue, ScheduleException } from './schedule'
import { relationId } from './schedule'
import type {
  BusyInterval,
  DurationOverride,
  SlotBarber,
  SlotInput,
  SlotMode,
  SlotSettings,
} from './slots'
import { DEFAULT_SLOT_SETTINGS, resolveDuration } from './slots'
import { ACTIVE_STATUSES } from './appointment-status'
import { addMinutes, isLocalDate, localDayRange } from './time'

export type SlotQuery = {
  mode: SlotMode
  locationId: string
  /** Local `YYYY-MM-DD`. */
  date: string
  /** A specific barber; empty = "any barber" of the location. */
  barberId?: string | null
  serviceId: string
  extraIds?: readonly string[]
  now: Date
  clientBlocked?: boolean
  /** The appointment being edited: its own interval is not "busy". */
  excludeAppointmentId?: string | null
  /**
   * Fixed duration for the requested barber (an edited appointment keeps its price snapshot
   * durations); without it the duration comes from the catalog and `barber-prices`.
   */
  durationMinutes?: number | null
}

export type BarberBusyInterval = BusyInterval & { barberId: string }

/**
 * Source of occupied intervals: active appointments and blocks of the given barbers that overlap
 * `[from, to)`, in any location. Must run a single query for all barbers.
 */
export type BusySource = (args: {
  payload: Payload
  req: PayloadRequest
  barberIds: readonly string[]
  from: Date
  to: Date
  excludeAppointmentId?: string | null
}) => Promise<BarberBusyInterval[]>

/** Test helper: nobody is busy. */
export const noBusyIntervals: BusySource = async () => []

type BusyRow = {
  barber: RelationValue
  startAt: string
  endAt: string
  kind: 'appointment' | 'block'
}

/**
 * Active appointments and blocks (`scheduled | completed | paid`, spec §5.3 p.2) of the barbers
 * overlapping `[from, to)`, in any location, in one query. Runs inside the caller's transaction.
 */
export const appointmentsBusySource: BusySource = async ({
  payload,
  req,
  barberIds,
  from,
  to,
  excludeAppointmentId,
}) => {
  if (barberIds.length === 0) return []
  const { docs } = await payload.find({
    collection: 'appointments',
    where: {
      and: [
        { barber: { in: [...barberIds] } },
        { status: { in: [...ACTIVE_STATUSES] } },
        { startAt: { less_than: to.toISOString() } },
        { endAt: { greater_than: from.toISOString() } },
        ...(excludeAppointmentId ? [{ id: { not_equals: excludeAppointmentId } }] : []),
      ],
    },
    depth: 0,
    limit: 0,
    pagination: false,
    overrideAccess: true,
    select: { barber: true, startAt: true, endAt: true, kind: true },
    req,
  })
  return (docs as unknown as BusyRow[]).map((row) => ({
    barberId: relationId(row.barber) ?? '',
    start: new Date(row.startAt),
    end: new Date(row.endAt),
    kind: row.kind,
  }))
}

type BarberRow = {
  id: string
  order?: number | null
  active?: boolean | null
  onlineBooking?: boolean | null
  locations?: RelationValue[] | null
  services?: RelationValue[] | null
  weeklySchedule?:
    | {
        weekday: string | number
        location: RelationValue
        start?: string | null
        end?: string | null
        breaks?: { start?: string | null; end?: string | null }[] | null
      }[]
    | null
}

type ExceptionRow = ScheduleException & { barber: RelationValue }

type PriceRow = {
  barber: RelationValue
  item: { relationTo: 'services' | 'extras'; value: RelationValue }
  durationMinutes?: number | null
}

/** Shared options of every query: system read, raw ids, inside the caller's transaction (if any). */
const readOptions = (req: PayloadRequest) => ({ depth: 0, overrideAccess: true, req }) as const

/** Same as `SlotQuery`, for an inclusive range of local dates (calendar of available days). */
export type SlotRangeQuery = Omit<SlotQuery, 'date'> & { from: string; to: string }

export type SlotRange = {
  settings: SlotSettings
  /** Input of `computeSlots` for one date of the loaded range. */
  inputFor: (date: string) => SlotInput
}

/**
 * Loads everything for one location and a range of dates with the same fixed number of queries
 * as a single day (exceptions and busy intervals are read for the whole range).
 */
export const loadSlotRange = async (
  payload: Payload,
  params: SlotRangeQuery,
  req: PayloadRequest,
  { busySource = appointmentsBusySource }: { busySource?: BusySource } = {},
): Promise<SlotRange> => {
  if (!isLocalDate(params.from)) throw new RangeError(`Invalid date: ${params.from}`)
  if (!isLocalDate(params.to) || params.to < params.from)
    throw new RangeError(`Invalid date: ${params.to}`)
  const extraIds = [...new Set(params.extraIds ?? [])]
  const options = readOptions(req)
  // Queries run one after another: parallel operations on one MongoDB transaction session are unsafe.

  // 1. Settings.
  const settingsDoc = await payload.findGlobal({
    slug: 'booking-settings',
    ...options,
    select: {
      slotStepMinutes: true,
      minLeadMinutes: true,
      horizonDays: true,
      bufferMinutes: true,
      onlineBookingEnabled: true,
    },
  })
  const stored = settingsDoc as Partial<SlotSettings>
  const settings: SlotSettings = {
    slotStepMinutes: stored.slotStepMinutes ?? DEFAULT_SLOT_SETTINGS.slotStepMinutes,
    minLeadMinutes: stored.minLeadMinutes ?? DEFAULT_SLOT_SETTINGS.minLeadMinutes,
    horizonDays: stored.horizonDays ?? DEFAULT_SLOT_SETTINGS.horizonDays,
    bufferMinutes: stored.bufferMinutes ?? DEFAULT_SLOT_SETTINGS.bufferMinutes,
    onlineBookingEnabled: stored.onlineBookingEnabled ?? DEFAULT_SLOT_SETTINGS.onlineBookingEnabled,
  }

  // 2. Service, 3. extras.
  const { docs: services } = await payload.find({
    collection: 'services',
    ...options,
    where: { id: { equals: params.serviceId } },
    limit: 1,
    pagination: false,
    select: { durationMinutes: true },
  })
  const service = services[0]
  if (!service) throw businessError('SERVICE_NOT_FOUND', crmT(req.t, 'errors.serviceNotFound'), 404)

  const extras =
    extraIds.length === 0
      ? []
      : (
          await payload.find({
            collection: 'extras',
            ...options,
            where: { id: { in: extraIds } },
            limit: extraIds.length,
            pagination: false,
            select: { durationMinutes: true },
          })
        ).docs
  const missingExtra = extraIds.find((id) => !extras.some((extra) => String(extra.id) === id))
  if (missingExtra) throw businessError('EXTRA_NOT_FOUND', crmT(req.t, 'errors.extraNotFound'), 404)

  // 4. Barbers: the requested one, or all of the location.
  const { docs: barberDocs } = await payload.find({
    collection: 'barbers',
    ...options,
    where: params.barberId
      ? { id: { equals: params.barberId } }
      : { locations: { in: [params.locationId] } },
    limit: 0,
    pagination: false,
    sort: 'order',
    select: {
      order: true,
      active: true,
      onlineBooking: true,
      locations: true,
      services: true,
      weeklySchedule: true,
    },
  })
  const barbers = barberDocs as unknown as BarberRow[]
  const barberIds = barbers.map((barber) => String(barber.id))

  const range = { start: localDayRange(params.from).start, end: localDayRange(params.to).end }
  let exceptions: ExceptionRow[] = []
  let prices: PriceRow[] = []
  let busy: BarberBusyInterval[] = []
  if (barberIds.length > 0) {
    // 5. Exceptions overlapping the range.
    exceptions = (
      await payload.find({
        collection: 'schedule-exceptions',
        ...options,
        where: {
          and: [
            { barber: { in: barberIds } },
            { dateFrom: { less_than_equal: params.to } },
            { dateTo: { greater_than_equal: params.from } },
          ],
        },
        limit: 0,
        pagination: false,
        select: {
          barber: true,
          kind: true,
          dateFrom: true,
          dateTo: true,
          location: true,
          start: true,
          end: true,
          breaks: true,
        },
      })
    ).docs as unknown as ExceptionRow[]

    // 6. Duration overrides of the selected items.
    prices = (
      await payload.find({
        collection: 'barber-prices',
        ...options,
        where: {
          and: [
            { barber: { in: barberIds } },
            { 'item.value': { in: [params.serviceId, ...extraIds] } },
          ],
        },
        limit: 0,
        pagination: false,
        select: { barber: true, item: true, durationMinutes: true },
      })
    ).docs as unknown as PriceRow[]

    // 7. Busy intervals, widened by the buffer so neighbours across midnight count too.
    busy = await busySource({
      payload,
      req,
      barberIds,
      from: addMinutes(range.start, -settings.bufferMinutes),
      to: addMinutes(range.end, settings.bufferMinutes),
      excludeAppointmentId: params.excludeAppointmentId,
    })
  }

  const serviceItem = { id: String(service.id), durationMinutes: service.durationMinutes }
  const extraItems = extraIds.map((id) => {
    const extra = extras.find((item) => String(item.id) === id)!
    return { id, durationMinutes: extra.durationMinutes }
  })

  const barberBase = barbers.map((barber) => {
    const id = String(barber.id)
    const overrides: DurationOverride[] = prices
      .filter((price) => relationId(price.barber) === id)
      .map((price) => ({
        itemType: price.item.relationTo,
        itemId: relationId(price.item.value) ?? '',
        durationMinutes: price.durationMinutes,
      }))
    const schedule: BarberSchedule = {
      locations: barber.locations ?? [],
      weeklySchedule: (barber.weeklySchedule ?? []).map((row) => ({
        weekday: Number(row.weekday),
        location: row.location,
        start: row.start ?? '',
        end: row.end ?? '',
        breaks: row.breaks,
      })),
    }
    return {
      id,
      order: typeof barber.order === 'number' ? barber.order : null,
      active: barber.active === true,
      onlineBooking: barber.onlineBooking === true,
      providesService: (barber.services ?? []).some((item) => relationId(item) === serviceItem.id),
      durationMinutes:
        params.barberId && typeof params.durationMinutes === 'number'
          ? params.durationMinutes
          : resolveDuration(serviceItem, extraItems, overrides),
      schedule,
      exceptions: exceptions.filter((exception) => relationId(exception.barber) === id),
      busy: busy.filter((item) => item.barberId === id),
    }
  })

  const inputFor = (date: string): SlotInput => {
    if (!isLocalDate(date) || date < params.from || date > params.to)
      throw new RangeError(`Date ${date} is outside the loaded range`)
    // Only intervals that can touch the day (with the buffer) are passed on.
    const day = localDayRange(date)
    const from = addMinutes(day.start, -settings.bufferMinutes)
    const to = addMinutes(day.end, settings.bufferMinutes)
    return {
      mode: params.mode,
      date,
      locationId: params.locationId,
      now: params.now,
      settings,
      barbers: barberBase.map(({ busy: barberBusy, ...barber }): SlotBarber => ({
        ...barber,
        busy: barberBusy
          .filter((item) => item.start < to && item.end > from)
          .map(({ start, end, kind }) => ({ start, end, kind })),
      })),
      clientBlocked: params.clientBlocked,
    }
  }

  return { settings, inputFor }
}

/** Input of `computeSlots` / `checkSlot` for one location and date. */
export const loadSlotInput = async (
  payload: Payload,
  params: SlotQuery,
  req: PayloadRequest,
  options: { busySource?: BusySource } = {},
): Promise<SlotInput> => {
  if (!isLocalDate(params.date)) throw new RangeError(`Invalid date: ${params.date}`)
  const { date, ...rest } = params
  const range = await loadSlotRange(payload, { ...rest, from: date, to: date }, req, options)
  return range.inputFor(date)
}
