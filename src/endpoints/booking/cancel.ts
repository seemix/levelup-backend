/**
 * Cancellation by the token from the confirmation email (spec §5.10, §6.1):
 * - `GET /api/booking/cancel/:token?locale=` → short details and `canCancel`;
 * - `POST /api/booking/cancel/:token` → `cancelled_by_client` (client actor, ≥ `clientCancelMinHours`).
 * Only the sha256 of the token is stored; an unknown or malformed token is `TOKEN_INVALID` (404).
 */
import type { PayloadRequest } from 'payload'

import { changeAppointmentStatus, hashCancelToken } from '@/crm/appointments'
import { relationId, type RelationValue } from '@/crm/schedule'

import { publicRequest, readSettings, SYSTEM_READ } from './context'
import { bookingEndpoint, bookingError, isLocale, ok, type Locale } from './http'

/** 32 random bytes in base64url (`generateCancelToken`). */
const TOKEN_RE = /^[\w-]{43}$/

type AppointmentRow = {
  id: string
  status: string
  startAt: string
  endAt: string
  location?: RelationValue
  barber?: RelationValue
  service?: RelationValue
  language?: string | null
}

const findByToken = async (req: PayloadRequest): Promise<AppointmentRow> => {
  const token = String(req.routeParams?.token ?? '')
  if (!TOKEN_RE.test(token)) throw bookingError('TOKEN_INVALID', 404)
  const { docs } = await req.payload.find({
    collection: 'appointments',
    ...SYSTEM_READ,
    req,
    where: {
      and: [
        { cancelTokenHash: { equals: hashCancelToken(token) } },
        { kind: { equals: 'appointment' } },
      ],
    },
    limit: 1,
    select: {
      status: true,
      startAt: true,
      endAt: true,
      location: true,
      barber: true,
      service: true,
      language: true,
    },
  })
  const doc = docs[0] as unknown as AppointmentRow | undefined
  if (!doc) throw bookingError('TOKEN_INVALID', 404)
  return doc
}

/** `scheduled` and at least `clientCancelMinHours` before the start (§5.10). */
const cancellable = (doc: AppointmentRow, minHours: number, now: Date): boolean =>
  doc.status === 'scheduled' &&
  new Date(doc.startAt).getTime() - now.getTime() >= minHours * 3_600_000

const nameOf = async (
  req: PayloadRequest,
  collection: 'barbers' | 'services' | 'locations',
  id: string | null,
  locale: Locale,
  select: Record<string, true>,
): Promise<Record<string, unknown> | null> => {
  if (!id) return null
  const { docs } = await req.payload.find({
    collection,
    ...SYSTEM_READ,
    req,
    locale,
    fallbackLocale: 'ru',
    where: { id: { equals: id } },
    limit: 1,
    select,
  })
  return (docs[0] as unknown as Record<string, unknown> | undefined) ?? null
}

export const cancelInfoEndpoint = bookingEndpoint('get', '/booking/cancel/:token', async (req) => {
  const doc = await findByToken(req)
  const requested = req.searchParams.get('locale')
  const locale: Locale = isLocale(requested)
    ? requested
    : isLocale(doc.language)
      ? doc.language
      : 'ru'
  const settings = await readSettings(req)
  const barber = await nameOf(req, 'barbers', relationId(doc.barber), locale, { name: true })
  const service = await nameOf(req, 'services', relationId(doc.service), locale, { name: true })
  const location = await nameOf(req, 'locations', relationId(doc.location), locale, {
    name: true,
    address: true,
    phone: true,
  })
  return ok({
    start: new Date(doc.startAt).toISOString(),
    end: new Date(doc.endAt).toISOString(),
    status: doc.status,
    barber: { name: (barber?.name as string | undefined) ?? '' },
    service: { name: (service?.name as string | undefined) ?? '' },
    // The salon phone is shown when the appointment can no longer be cancelled online.
    location: {
      name: (location?.name as string | undefined) ?? '',
      address: (location?.address as string | null | undefined) ?? null,
      phone: (location?.phone as string | null | undefined) ?? null,
    },
    clientCancelMinHours: settings.clientCancelMinHours,
    canCancel: cancellable(doc, settings.clientCancelMinHours, new Date()),
  })
})

export const cancelEndpoint = bookingEndpoint('post', '/booking/cancel/:token', async (req) => {
  const doc = await findByToken(req)
  if (doc.status !== 'scheduled') throw bookingError('CANCEL_NOT_ALLOWED', 409)
  // The status machine checks `clientCancelMinHours` (`CANCEL_TOO_LATE`) and logs the client as actor.
  const { doc: updated } = await changeAppointmentStatus(
    await publicRequest(req),
    String(doc.id),
    'cancelled_by_client',
    { mode: 'online', actorType: 'client' },
  )
  return ok({ status: updated.status })
})
