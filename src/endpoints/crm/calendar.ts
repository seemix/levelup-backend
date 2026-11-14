/**
 * `GET /api/crm/calendar?date&view=day|week&location&barber&cancelled` (spec §6.2, §3.1, A1, A2).
 *
 * One request returns everything the calendar view needs: visible locations, columns
 * (day — barbers of the location; week — 7 days of one barber), working intervals of each column
 * in the location and the appointments. Fields are filtered by role (decision 36): rows the user may
 * not read come back as `{ start, end, busy }` only; the client's email is never returned.
 *
 * Fixed number of queries whatever the amount of data: settings, locations, barbers, exceptions,
 * appointments, clients, services, extras, media (+ 1–2 for the staff context of manager/barber).
 */
import type { PayloadRequest, Where } from 'payload'

import { allowed, type StaffContext } from '@/access/policy'
import { ACTIVE_STATUSES, CANCELLED_STATUSES } from '@/crm/appointment-status'
import {
  getWorkingIntervals,
  relationId,
  type BarberSchedule,
  type RelationValue,
  type ScheduleException,
} from '@/crm/schedule'
import { DEFAULT_SLOT_SETTINGS } from '@/crm/slots'
import { addLocalDays, isLocalDate, isoWeekday, localDayRange, todayLocal } from '@/crm/time'

import { SYSTEM_READ } from '../booking/context'
import { InputErrors, isId, localeOf, ok, type Locale } from '../booking/http'
import { locationScope } from './access'
import { crmEndpoint, crmError } from './http'
import {
  APPOINTMENT_SELECT,
  busyView,
  canSeeDetails,
  detailView,
  loadNames,
  type AppointmentRow,
  type AppointmentView,
  type BusyView,
} from './view'

export type CalendarView = 'day' | 'week'

type LocationRow = { id: string; name?: string | null; active?: boolean | null }

type BarberRow = {
  id: string
  name?: string | null
  position?: string | null
  color?: string | null
  order?: number | null
  active?: boolean | null
  image?: RelationValue
  locations?: RelationValue[] | null
  weeklySchedule?: BarberSchedule['weeklySchedule']
}

type ExceptionRow = ScheduleException & { barber: RelationValue }

type MediaRow = { id: string; url?: string | null; sizes?: { thumbnail?: { url?: string | null } } }

export type CalendarQuery = {
  date: string
  view: CalendarView
  locationId: string | null
  barberId: string | null
  includeCancelled: boolean
}

export const parseCalendarQuery = (params: URLSearchParams): CalendarQuery => {
  const errors = new InputErrors()
  const date = params.get('date') || todayLocal()
  if (!isLocalDate(date)) errors.add('date')
  const view = params.get('view') || 'day'
  if (view !== 'day' && view !== 'week') errors.add('view')
  const location = params.get('location') || null
  if (location && !isId(location)) errors.add('location')
  const barber = params.get('barber') || null
  if (barber && !isId(barber)) errors.add('barber')
  const cancelled = params.get('cancelled')
  errors.throwIfAny()
  return {
    date,
    view: view as CalendarView,
    locationId: location,
    barberId: barber,
    includeCancelled: cancelled === '1' || cancelled === 'true',
  }
}

/** Locations whose calendar the user may open: admin — all, manager — own, barber — the barber's. */
export const visibleLocations = async (
  req: PayloadRequest,
  staff: StaffContext,
  locale: Locale,
): Promise<LocationRow[]> => {
  const scope = await locationScope(req, staff)
  if (scope !== 'all' && scope.size === 0) return []
  const where: Where | undefined = scope === 'all' ? undefined : { id: { in: [...scope] } }
  const { docs } = await req.payload.find({
    collection: 'locations',
    ...SYSTEM_READ,
    req,
    locale,
    where,
    sort: 'order',
    select: { name: true, active: true },
  })
  return docs.map((doc) => ({ id: String(doc.id), name: doc.name, active: doc.active }))
}

/** Local dates of the view: the day itself or Monday…Sunday of its week (A2). */
export const viewDates = (date: string, view: CalendarView): string[] => {
  if (view === 'day') return [date]
  const monday = addLocalDays(date, 1 - isoWeekday(date))
  return Array.from({ length: 7 }, (_, index) => addLocalDays(monday, index))
}

type ColumnBarber = {
  id: string
  name: string
  position: string | null
  color: string | null
  image: string | null
  active: boolean
  own: boolean
}

export type CalendarColumn = {
  barber: ColumnBarber
  date: string
  /** Why there is no working time in this location on the date (`null` = working). */
  off: 'no_schedule' | 'day_off' | 'vacation' | 'sick' | 'other_location' | null
  /** Working intervals in the requested location (breaks excluded). */
  intervals: { start: string; end: string }[]
  appointments: (AppointmentView | BusyView)[]
}

const workingTime = (
  barber: BarberRow,
  exceptions: ExceptionRow[],
  date: string,
  locationId: string,
): Pick<CalendarColumn, 'off' | 'intervals'> => {
  const day = getWorkingIntervals(
    { locations: barber.locations ?? [], weeklySchedule: barber.weeklySchedule ?? [] },
    date,
    exceptions.filter((item) => relationId(item.barber) === String(barber.id)),
  )
  if (!day.working) return { off: day.reason, intervals: [] }
  if (day.locationId && day.locationId !== locationId)
    return { off: 'other_location', intervals: [] }
  return {
    off: null,
    intervals: day.intervals.map((item) => ({
      start: item.start.toISOString(),
      end: item.end.toISOString(),
    })),
  }
}

export const loadCalendar = async (
  req: PayloadRequest,
  staff: StaffContext,
  query: CalendarQuery,
) => {
  if (!allowed(req.user, 'read', 'calendar')) throw crmError('FORBIDDEN', 403)
  const locale = localeOf(req)
  // Queries run one after another (safe on a transaction session, predictable count).
  const settings = (await req.payload.findGlobal({
    slug: 'booking-settings',
    overrideAccess: true,
    depth: 0,
    req,
    select: { slotStepMinutes: true },
  })) as { slotStepMinutes?: number | null }

  const locations = await visibleLocations(req, staff, locale)
  const location = query.locationId
    ? locations.find((item) => item.id === query.locationId)
    : (locations.find((item) => item.active) ?? locations[0])
  if (!location) {
    if (query.locationId) throw crmError('FORBIDDEN', 403)
    throw crmError('LOCATION_NOT_FOUND', 404)
  }

  const { docs: barberDocs } = await req.payload.find({
    collection: 'barbers',
    ...SYSTEM_READ,
    req,
    locale,
    where: { locations: { in: [location.id] } },
    sort: 'order',
    select: {
      name: true,
      position: true,
      color: true,
      order: true,
      active: true,
      image: true,
      locations: true,
      weeklySchedule: true,
    },
  })
  let barbers = (barberDocs as unknown as BarberRow[]).map((row) => ({
    ...row,
    id: String(row.id),
  }))

  // Week view shows one barber: the requested one, the user's own, or the only one of the location.
  // Barbers of the location for the week-view selector (before the view narrows the list).
  const barberOptions = barbers
    .filter((row) => row.active !== false || row.id === query.barberId)
    .map((row) => ({ id: row.id, name: row.name ?? '', own: row.id === staff.barberId }))
  let barberId = query.barberId
  if (!barberId && query.view === 'week') {
    const own = barbers.find((row) => row.id === staff.barberId)
    barberId = own?.id ?? (barbers.length === 1 ? barbers[0].id : null)
    if (!barberId) throw crmError('VALIDATION_ERROR', 400, { fields: ['barber'] })
  }
  if (barberId) {
    barbers = barbers.filter((row) => row.id === barberId)
    if (barbers.length === 0) throw crmError('BARBER_NOT_FOUND', 404)
  }

  const dates = viewDates(query.date, query.view)
  const from = dates[0]
  const to = dates[dates.length - 1]
  const range = { start: localDayRange(from).start, end: localDayRange(to).end }
  const barberIds = barbers.map((row) => row.id)

  let exceptions: ExceptionRow[] = []
  let rows: AppointmentRow[] = []
  if (barberIds.length > 0) {
    exceptions = (
      await req.payload.find({
        collection: 'schedule-exceptions',
        ...SYSTEM_READ,
        req,
        where: {
          and: [
            { barber: { in: barberIds } },
            { dateFrom: { less_than_equal: to } },
            { dateTo: { greater_than_equal: from } },
          ],
        },
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

    const statuses = [
      ...ACTIVE_STATUSES,
      'no_show',
      ...(query.includeCancelled ? CANCELLED_STATUSES : []),
    ]
    rows = (
      await req.payload.find({
        collection: 'appointments',
        ...SYSTEM_READ,
        req,
        where: {
          and: [
            { barber: { in: barberIds } },
            { status: { in: statuses } },
            { startAt: { less_than: range.end.toISOString() } },
            { endAt: { greater_than: range.start.toISOString() } },
          ],
        },
        sort: 'startAt',
        select: APPOINTMENT_SELECT,
      })
    ).docs as unknown as AppointmentRow[]
  }

  // Details only for rows the user may read; others are busy time, and only while they occupy it.
  const visible = rows.filter((row) => canSeeDetails(req, staff, row))
  const visibleIds = new Set(visible.map((row) => String(row.id)))
  const names = await loadNames(req, visible, locale)
  const items = rows.flatMap((row): { row: AppointmentRow; view: AppointmentView | BusyView }[] => {
    if (visibleIds.has(String(row.id))) return [{ row, view: detailView(row, names) }]
    if (!(ACTIVE_STATUSES as readonly string[]).includes(row.status ?? '')) return []
    return [{ row, view: busyView(row) }]
  })

  // Inactive barbers stay hidden unless they still have appointments in the range.
  const busyBarbers = new Set(rows.map((row) => relationId(row.barber)))
  barbers = barbers.filter((row) => row.active !== false || busyBarbers.has(row.id))
  // A barber sees their own column first (spec §9).
  barbers.sort((a, b) => Number(b.id === staff.barberId) - Number(a.id === staff.barberId))

  const imageIds = [
    ...new Set(barbers.map((row) => relationId(row.image)).filter((id): id is string => !!id)),
  ]
  const media =
    imageIds.length === 0
      ? []
      : ((
          await req.payload.find({
            collection: 'media',
            ...SYSTEM_READ,
            req,
            where: { id: { in: imageIds } },
            select: { url: true, sizes: { thumbnail: { url: true } } },
          })
        ).docs as unknown as MediaRow[])
  const imageUrl = (id: string | null) => {
    const doc = id ? media.find((item) => String(item.id) === id) : undefined
    return doc ? (doc.sizes?.thumbnail?.url ?? doc.url ?? null) : null
  }

  const columns: CalendarColumn[] = barbers.flatMap((barber) => {
    const head: ColumnBarber = {
      id: barber.id,
      name: barber.name ?? '',
      position: barber.position ?? null,
      color: barber.color ?? null,
      image: imageUrl(relationId(barber.image)),
      active: barber.active !== false,
      own: barber.id === staff.barberId,
    }
    return dates.map((date) => {
      const day = localDayRange(date)
      return {
        barber: head,
        date,
        ...workingTime(barber, exceptions, date, location.id),
        appointments: items
          .filter(
            ({ row }) =>
              relationId(row.barber) === barber.id &&
              new Date(row.startAt) < day.end &&
              new Date(row.endAt) > day.start,
          )
          .map(({ view }) => view),
      }
    })
  })

  return {
    view: query.view,
    date: query.date,
    from,
    to,
    location: location.id,
    locations: locations
      .filter((item) => item.active || item.id === location.id)
      .map((item) => ({ id: item.id, name: item.name ?? '' })),
    barbers: barberOptions,
    slotStepMinutes: settings.slotStepMinutes ?? DEFAULT_SLOT_SETTINGS.slotStepMinutes,
    columns,
  }
}

export const calendarEndpoint = crmEndpoint('get', '/calendar', async (req, staff) =>
  ok(await loadCalendar(req, staff, parseCalendarQuery(req.searchParams))),
)
