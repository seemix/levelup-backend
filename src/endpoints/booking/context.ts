/**
 * Public actor and system reads of the booking API.
 *
 * Anonymous visitors have no access to schedules, prices overrides, clients or appointments, so the
 * endpoints read them on behalf of the system — explicitly, through `SYSTEM_READ` and the
 * stage 5–7 services — and return only derived public data. Writes go through `publicRequest`:
 * a request without `user` (even if a staff cookie came along), so the appointments service applies
 * the online rules and records the client as the actor.
 */
import { createLocalReq, type PayloadRequest } from 'payload'

import { relationId, type RelationValue } from '@/crm/schedule'
import { DEFAULT_SLOT_SETTINGS } from '@/crm/slots'

import { bookingError, InputErrors, isId, localeOf } from './http'

/** System read: no access control, raw ids, a `select` is always given by the caller. */
export const SYSTEM_READ = { overrideAccess: true, depth: 0, pagination: false } as const

/** Anonymous request for the services (no `user`), with the visitor's locale and translations. */
export const publicRequest = (req: PayloadRequest): Promise<PayloadRequest> =>
  createLocalReq(
    { locale: localeOf(req), req: { i18n: req.i18n } as Partial<PayloadRequest> },
    req.payload,
  )

export type PublicSettings = {
  slotStepMinutes: number
  minLeadMinutes: number
  horizonDays: number
  clientCancelMinHours: number
  onlineBookingEnabled: boolean
}

/** Public fields of `booking-settings` (never `senderName`/`replyTo`). */
export const readSettings = async (req: PayloadRequest): Promise<PublicSettings> => {
  const doc = (await req.payload.findGlobal({
    slug: 'booking-settings',
    overrideAccess: true,
    depth: 0,
    req,
    select: {
      slotStepMinutes: true,
      minLeadMinutes: true,
      horizonDays: true,
      clientCancelMinHours: true,
      onlineBookingEnabled: true,
    },
  })) as Partial<Record<keyof PublicSettings, number | boolean | null>>
  return {
    slotStepMinutes: (doc.slotStepMinutes as number) ?? DEFAULT_SLOT_SETTINGS.slotStepMinutes,
    minLeadMinutes: (doc.minLeadMinutes as number) ?? DEFAULT_SLOT_SETTINGS.minLeadMinutes,
    horizonDays: (doc.horizonDays as number) ?? DEFAULT_SLOT_SETTINGS.horizonDays,
    clientCancelMinHours: (doc.clientCancelMinHours as number) ?? 3,
    onlineBookingEnabled: (doc.onlineBookingEnabled as boolean) ?? true,
  }
}

// ---------------------------------------------------------------------------
// Selection: location, barber (or "any"), service, extras
// ---------------------------------------------------------------------------

export type Selection = {
  locationId: string
  /** `null` = any free barber (decision 22). */
  barberId: string | null
  serviceId: string
  extraIds: string[]
}

/** Parses the selection fields; `barber` may be an id, `any` or empty. */
export const parseSelection = (
  errors: InputErrors,
  input: { location: unknown; barber: unknown; service: unknown; extras: unknown },
): Selection => {
  if (!isId(input.location)) errors.add('location')
  if (!isId(input.service)) errors.add('service')
  const barber = input.barber
  const any = barber === undefined || barber === null || barber === '' || barber === 'any'
  if (!any && !isId(barber)) errors.add('barber')
  const extras = input.extras === undefined || input.extras === null ? [] : input.extras
  if (!Array.isArray(extras) || extras.length > 20 || !extras.every(isId)) errors.add('extras')
  return {
    locationId: String(input.location),
    barberId: any ? null : String(barber),
    serviceId: String(input.service),
    extraIds: Array.isArray(extras) ? [...new Set(extras.map(String))] : [],
  }
}

type Flags = { active?: boolean | null; onlineBooking?: boolean | null }

/**
 * Checks that the selection can be booked online: active location, barber who books online and
 * works in it, active online service and extras that apply to the service. Fixed 3–4 queries.
 */
export const validateSelection = async (req: PayloadRequest, selection: Selection) => {
  const { payload } = req
  const { docs: locations } = await payload.find({
    collection: 'locations',
    ...SYSTEM_READ,
    req,
    where: { and: [{ id: { equals: selection.locationId } }, { active: { equals: true } }] },
    limit: 1,
    select: { active: true },
  })
  if (locations.length === 0) throw bookingError('LOCATION_NOT_FOUND', 404)

  if (selection.barberId) {
    const { docs } = await payload.find({
      collection: 'barbers',
      ...SYSTEM_READ,
      req,
      where: { id: { equals: selection.barberId } },
      limit: 1,
      select: { active: true, onlineBooking: true, locations: true, services: true },
    })
    const barber = docs[0] as
      | (Flags & { locations?: RelationValue[] | null; services?: RelationValue[] | null })
      | undefined
    const bookable =
      barber?.active === true &&
      barber.onlineBooking === true &&
      (barber.locations ?? []).some((id) => relationId(id) === selection.locationId)
    if (!bookable) throw bookingError('BARBER_NOT_FOUND', 404)
  }

  const { docs: services } = await payload.find({
    collection: 'services',
    ...SYSTEM_READ,
    req,
    where: { id: { equals: selection.serviceId } },
    limit: 1,
    select: { active: true, onlineBooking: true },
  })
  const service = services[0] as Flags | undefined
  if (!service?.active || !service.onlineBooking) throw bookingError('SERVICE_NOT_FOUND', 404)

  if (selection.extraIds.length > 0) {
    const { docs } = await payload.find({
      collection: 'extras',
      ...SYSTEM_READ,
      req,
      where: { id: { in: selection.extraIds } },
      limit: selection.extraIds.length,
      select: { active: true, onlineBooking: true, appliesTo: true },
    })
    const extras = docs as unknown as (Flags & {
      id: string
      appliesTo?: RelationValue[] | null
    })[]
    for (const id of selection.extraIds) {
      const extra = extras.find((item) => String(item.id) === id)
      if (!extra?.active || !extra.onlineBooking) throw bookingError('EXTRA_NOT_FOUND', 404)
      const appliesTo = (extra.appliesTo ?? []).map(relationId).filter(Boolean)
      if (appliesTo.length > 0 && !appliesTo.includes(selection.serviceId))
        throw bookingError('EXTRA_NOT_APPLICABLE', 400)
    }
  }
}
