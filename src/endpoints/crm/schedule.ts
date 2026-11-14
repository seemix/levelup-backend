/**
 * Schedule roster (spec A44): barbers × days of a month, editing days and «fill by pattern».
 *
 * - `GET  /api/crm/schedule?month=YYYY-MM&location` (or `from&to`, ≤ 62 days — day / week views)
 *   — the roster of a location.
 * - `POST /api/crm/schedule/days` `{ barber, dates[], kind, location?, start?, end?, breaks?, comment? }` —
 *   sets the days (`kind = pattern` removes the overrides).
 * - `POST /api/crm/schedule/fill` `{ barbers[], dateFrom, dateTo, keepAbsences? }` — the weekly pattern
 *   applies again on the dates (vacations and sick leaves are kept unless `keepAbsences = false`).
 *
 * Days are stored as `schedule-exceptions`; rights are those of the collection (admin — everyone,
 * manager — barbers of own locations, barber — reads own row). The weekly pattern itself is saved
 * through the standard `PATCH /api/barbers/:id` (field rule `barbers.schedule`).
 */
import type { PayloadRequest } from 'payload'

import { allowed, type PolicyScope, type StaffContext } from '@/access/policy'
import { relationId, type BarberSchedule, type RelationValue } from '@/crm/schedule'
import {
  isMonth,
  monthRange,
  parseDates,
  parseDayValue,
  rosterDay,
  type RosterDay,
} from '@/crm/schedule-edit'
import { editScheduleDays, fillSchedule, loadExceptions } from '@/crm/schedule-edit.service'
import { eachLocalDate, isLocalDate, localDayRange, toLocalDate, todayLocal } from '@/crm/time'

import { SYSTEM_READ } from '../booking/context'
import { InputErrors, isId, localeOf, ok, readBody } from '../booking/http'
import { visibleLocations } from './calendar'
import { crmEndpoint, crmError } from './http'

/** Longest period of one edit or fill (two months). */
export const MAX_SCHEDULE_DAYS = 62

type BarberRow = BarberSchedule & {
  id: string
  name?: string | null
  position?: string | null
  color?: string | null
  active?: boolean | null
  user?: RelationValue
  image?: RelationValue
}

type MediaRow = { id: string; url?: string | null; sizes?: { thumbnail?: { url?: string | null } } }

export type RosterBarber = {
  id: string
  name: string
  position: string | null
  color: string | null
  /** Thumbnail of the photo (column header of the day view). */
  image: string | null
  own: boolean
  /** May change days (schedule exceptions) of this barber. */
  canEdit: boolean
  /** May change the weekly pattern (`barbers.weeklySchedule`). */
  canEditPattern: boolean
  locations: { id: string; name: string }[]
  pattern: {
    weekday: number
    location: string | null
    start: string
    end: string
    breaks: { start: string; end: string }[]
  }[]
  days: (RosterDay & { appointments: number })[]
}

export type RosterResponse = {
  /** `YYYY-MM` when a month was requested, otherwise `null` (day / week range). */
  month: string | null
  from: string
  to: string
  today: string
  location: string
  locations: { id: string; name: string }[]
  barbers: RosterBarber[]
}

const scopeOf = (staff: StaffContext): PolicyScope => ({
  barberId: staff.barberId,
  managedBarberIds: staff.managedBarberIds,
})

/** May the user change the days of this barber (create/delete exceptions)? */
const mayEditDays = (req: PayloadRequest, staff: StaffContext, barberId: string) =>
  allowed(req.user, 'create', 'schedule-exceptions', { barber: barberId }, scopeOf(staff)) &&
  allowed(req.user, 'delete', 'schedule-exceptions', { barber: barberId }, scopeOf(staff))

export const loadRoster = async (
  req: PayloadRequest,
  staff: StaffContext,
  query: { month: string | null; from: string; to: string; locationId: string | null },
): Promise<RosterResponse> => {
  if (!allowed(req.user, 'read', 'schedule')) throw crmError('FORBIDDEN', 403)
  const locale = localeOf(req)
  const locations = await visibleLocations(req, staff, locale)
  const location = query.locationId
    ? locations.find((item) => item.id === query.locationId)
    : (locations.find((item) => item.active) ?? locations[0])
  if (!location) {
    if (query.locationId) throw crmError('FORBIDDEN', 403)
    throw crmError('LOCATION_NOT_FOUND', 404)
  }

  const { from, to } = query
  const dates = eachLocalDate(from, to)

  const { docs: barberDocs } = await req.payload.find({
    collection: 'barbers',
    ...SYSTEM_READ,
    req,
    locale,
    where: { and: [{ locations: { in: [location.id] } }, { active: { equals: true } }] },
    sort: 'order',
    select: {
      name: true,
      position: true,
      color: true,
      active: true,
      user: true,
      image: true,
      locations: true,
      weeklySchedule: true,
    },
  })
  // Admin — everyone; manager — barbers of own locations; barber — only their own row.
  const barbers = (barberDocs as unknown as BarberRow[])
    .map((row) => ({ ...row, id: String(row.id) }))
    .filter(
      (row) =>
        staff.isAdmin ||
        (staff.isManager && staff.managedBarberIds.includes(row.id)) ||
        row.id === staff.barberId,
    )
  const barberIds = barbers.map((row) => row.id)

  const locationIds = [
    ...new Set(barbers.flatMap((row) => (row.locations ?? []).map(relationId))),
  ].filter((id): id is string => !!id)
  const locationNames = new Map(locations.map((item) => [item.id, item.name ?? '']))
  const unknown = locationIds.filter((id) => !locationNames.has(id))
  if (unknown.length > 0) {
    const { docs } = await req.payload.find({
      collection: 'locations',
      ...SYSTEM_READ,
      req,
      locale,
      where: { id: { in: unknown } },
      select: { name: true },
    })
    for (const doc of docs) locationNames.set(String(doc.id), doc.name ?? '')
  }

  const exceptions = await loadExceptions(req, barberIds, from, to)

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

  // Scheduled appointments per barber and day: the warning before a day is changed.
  const counts = new Map<string, number>()
  if (barberIds.length > 0) {
    const { docs } = await req.payload.find({
      collection: 'appointments',
      ...SYSTEM_READ,
      req,
      where: {
        and: [
          { barber: { in: barberIds } },
          { kind: { equals: 'appointment' } },
          { status: { equals: 'scheduled' } },
          { startAt: { greater_than_equal: localDayRange(from).start.toISOString() } },
          { startAt: { less_than: localDayRange(to).end.toISOString() } },
        ],
      },
      select: { barber: true, startAt: true },
    })
    for (const doc of docs) {
      const key = `${relationId(doc.barber as RelationValue)}|${toLocalDate(new Date(doc.startAt))}`
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }

  return {
    month: query.month,
    from,
    to,
    today: todayLocal(),
    location: location.id,
    locations: locations
      .filter((item) => item.active || item.id === location.id)
      .map((item) => ({ id: item.id, name: item.name ?? '' })),
    barbers: barbers.map((barber) => {
      const own = exceptions.filter((item) => relationId(item.barber) === barber.id)
      const schedule = { weeklySchedule: barber.weeklySchedule, locations: barber.locations }
      return {
        id: barber.id,
        name: barber.name ?? '',
        position: barber.position ?? null,
        color: barber.color ?? null,
        image: imageUrl(relationId(barber.image)),
        own: barber.id === staff.barberId,
        canEdit: mayEditDays(req, staff, barber.id),
        canEditPattern: allowed(req.user, 'update', 'barbers.schedule', barber),
        locations: (barber.locations ?? [])
          .map(relationId)
          .filter((id): id is string => !!id)
          .map((id) => ({ id, name: locationNames.get(id) ?? '' })),
        pattern: (barber.weeklySchedule ?? [])
          .map((row) => ({
            weekday: Number(row.weekday),
            location: relationId(row.location),
            start: row.start,
            end: row.end,
            breaks: (row.breaks ?? [])
              .filter((item): item is { start: string; end: string } => !!item.start && !!item.end)
              .map(({ start, end }) => ({ start, end })),
          }))
          .sort((a, b) => a.weekday - b.weekday),
        days: dates.map((date) => ({
          ...rosterDay(schedule, date, own),
          appointments: counts.get(`${barber.id}|${date}`) ?? 0,
        })),
      }
    }),
  }
}

export const scheduleRosterEndpoint = crmEndpoint('get', '/schedule', async (req, staff) => {
  const errors = new InputErrors()
  const fromParam = req.searchParams.get('from')
  const toParam = req.searchParams.get('to')
  let month: string | null = null
  let from = ''
  let to = ''
  if (fromParam || toParam) {
    from = fromParam ?? ''
    to = toParam ?? ''
    const valid =
      isLocalDate(from) &&
      isLocalDate(to) &&
      from <= to &&
      eachLocalDate(from, to).length <= MAX_SCHEDULE_DAYS
    if (!valid) errors.add('from')
  } else {
    month = req.searchParams.get('month') || todayLocal().slice(0, 7)
    if (isMonth(month)) ({ from, to } = monthRange(month))
    else errors.add('month')
  }
  const location = req.searchParams.get('location') || null
  if (location && !isId(location)) errors.add('location')
  errors.throwIfAny()
  return ok(await loadRoster(req, staff, { month, from, to, locationId: location }))
})

/** The barber must exist; `null` → 404. */
const barberExists = async (req: PayloadRequest, id: string): Promise<boolean> => {
  const { docs } = await req.payload.find({
    collection: 'barbers',
    ...SYSTEM_READ,
    req,
    where: { id: { equals: id } },
    limit: 1,
    select: {},
  })
  return docs.length > 0
}

export const scheduleDaysEndpoint = crmEndpoint('post', '/schedule/days', async (req, staff) => {
  const body = await readBody(req)
  const errors = new InputErrors()
  const barber = body.barber
  if (!isId(barber)) errors.add('barber')
  const dates = parseDates(body.dates, MAX_SCHEDULE_DAYS)
  if (!dates) errors.add('dates')
  const value = parseDayValue(body)
  if (!value) errors.add('kind')
  if (body.comment !== undefined && body.comment !== null && typeof body.comment !== 'string')
    errors.add('comment')
  errors.throwIfAny()
  if (!(await barberExists(req, barber as string))) throw crmError('BARBER_NOT_FOUND', 404)
  if (!mayEditDays(req, staff, barber as string)) throw crmError('FORBIDDEN', 403)
  const result = await editScheduleDays(req, {
    barber: barber as string,
    dates: dates!,
    value: value!,
  })
  if (!result) throw crmError('BARBER_NOT_FOUND', 404)
  return ok(result)
})

export const scheduleFillEndpoint = crmEndpoint('post', '/schedule/fill', async (req, staff) => {
  const body = await readBody(req)
  const errors = new InputErrors()
  const barbers = Array.isArray(body.barbers) ? [...new Set(body.barbers as unknown[])] : []
  if (barbers.length === 0 || !barbers.every(isId)) errors.add('barbers')
  const { dateFrom, dateTo } = body
  const range =
    typeof dateFrom === 'string' &&
    typeof dateTo === 'string' &&
    isLocalDate(dateFrom) &&
    isLocalDate(dateTo) &&
    dateFrom <= dateTo
      ? eachLocalDate(dateFrom, dateTo)
      : null
  if (!range || range.length > MAX_SCHEDULE_DAYS) errors.add('dateFrom')
  if (body.keepAbsences !== undefined && typeof body.keepAbsences !== 'boolean')
    errors.add('keepAbsences')
  errors.throwIfAny()
  const ids = barbers as string[]
  for (const id of ids) {
    if (!(await barberExists(req, id))) throw crmError('BARBER_NOT_FOUND', 404)
    if (!mayEditDays(req, staff, id)) throw crmError('FORBIDDEN', 403)
  }
  return ok(
    await fillSchedule(req, {
      barbers: ids,
      dates: range!,
      keepAbsences: body.keepAbsences !== false,
    }),
  )
})
