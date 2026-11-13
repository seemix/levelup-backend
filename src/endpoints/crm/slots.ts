/**
 * `GET /api/crm/slots?location&barber&service&extras[]&date&exclude&duration` (spec §6.2, §5.3 p.7).
 *
 * Staff mode: no online filters (lead time, horizon, `onlineBooking`, service list of the barber);
 * every grid step without an overlap is returned, those outside the working hours carry the
 * `OUTSIDE_SCHEDULE` warning. A barber gets only their own slots (decision 37); a manager — only in
 * their locations. `exclude` = the appointment being edited (its own time is not busy), `duration` —
 * its snapshot duration (only with a specific barber).
 */
import type { PayloadRequest } from 'payload'

import type { StaffContext } from '@/access/policy'
import { relationId } from '@/crm/schedule'
import { computeSlots } from '@/crm/slots'
import { loadSlotInput } from '@/crm/slots.loader'
import { isLocalDate } from '@/crm/time'

import { InputErrors, isId, ok, queryList } from '../booking/http'
import { inLocationScope } from './access'
import { crmEndpoint, crmError } from './http'

const MAX_DURATION = 24 * 60

export type StaffSlotQuery = {
  locationId: string
  barberId: string | null
  serviceId: string
  extraIds: string[]
  date: string
  excludeId: string | null
  durationMinutes: number | null
}

export const parseStaffSlotQuery = (params: URLSearchParams): StaffSlotQuery => {
  const errors = new InputErrors()
  const location = params.get('location') ?? ''
  if (!isId(location)) errors.add('location')
  const service = params.get('service') ?? ''
  if (!isId(service)) errors.add('service')
  const barberParam = params.get('barber')
  const barber = !barberParam || barberParam === 'any' ? null : barberParam
  if (barber && !isId(barber)) errors.add('barber')
  const extras = queryList(params, 'extras')
  if (extras.length > 20 || !extras.every(isId)) errors.add('extras')
  const date = params.get('date') ?? ''
  if (!isLocalDate(date)) errors.add('date')
  const exclude = params.get('exclude') || null
  if (exclude && !isId(exclude)) errors.add('exclude')
  const durationParam = params.get('duration')
  const duration = durationParam ? Number(durationParam) : null
  if (
    duration !== null &&
    (!Number.isInteger(duration) || duration <= 0 || duration > MAX_DURATION || !barber)
  )
    errors.add('duration')
  errors.throwIfAny()
  return {
    locationId: location,
    barberId: barber,
    serviceId: service,
    extraIds: [...new Set(extras)],
    date,
    excludeId: exclude,
    durationMinutes: duration,
  }
}

export const loadStaffSlots = async (
  req: PayloadRequest,
  staff: StaffContext,
  query: StaffSlotQuery,
) => {
  // A barber books only for themselves (decision 37); "any" means their own column.
  let barberId = query.barberId
  if (!staff.isAdmin && !staff.isManager) {
    if (!staff.barberId || (barberId && barberId !== staff.barberId))
      throw crmError('FORBIDDEN', 403)
    barberId = staff.barberId
  }
  if (!(await inLocationScope(req, staff, query.locationId))) throw crmError('FORBIDDEN', 403)
  if (query.excludeId) {
    // The edited appointment must be readable by the user (404 otherwise, existence is not revealed).
    await req.payload.findByID({
      collection: 'appointments',
      id: query.excludeId,
      depth: 0,
      overrideAccess: false,
      user: req.user,
      req,
      select: {},
    })
  }

  const input = await loadSlotInput(
    req.payload,
    {
      mode: 'staff',
      locationId: query.locationId,
      date: query.date,
      barberId,
      serviceId: query.serviceId,
      extraIds: query.extraIds,
      now: new Date(),
      excludeAppointmentId: query.excludeId,
      durationMinutes: query.durationMinutes,
    },
    req,
  )
  // Only barbers who work in the location; "any" = every active barber of it.
  const barbers = input.barbers.filter(
    (barber) =>
      barber.schedule.locations?.some((id) => relationId(id) === query.locationId) &&
      (barberId ? true : barber.active),
  )
  if (barberId && barbers.length === 0) throw crmError('BARBER_NOT_FOUND', 404)

  const slots = computeSlots({ ...input, barbers }).map((slot) => ({
    start: slot.start.toISOString(),
    time: slot.time,
    barbers: slot.barbers.map((option) => ({
      id: option.barberId,
      end: option.end.toISOString(),
      durationMinutes: option.durationMinutes,
      warnings: option.warnings,
    })),
  }))
  return { date: query.date, location: query.locationId, slots }
}

export const staffSlotsEndpoint = crmEndpoint('get', '/slots', async (req, staff) =>
  ok(await loadStaffSlots(req, staff, parseStaffSlotQuery(req.searchParams))),
)
