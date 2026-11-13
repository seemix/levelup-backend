/**
 * `POST /api/booking` (spec §6.1, decisions 22, 25, 26, A4):
 * `{ location, barber?, service, extras?, start, phone, firstName, lastName?, email?, language,
 *    promoCode?, certificateCode?, comment?, honeypot }` → `{ id, start, end, barber, location, service, total, cancelToken }`.
 *
 * - The client is found by phone or created; an existing client's data are never overwritten and
 *   never returned — differing name/email go to `clientComment` (decision 26). The response is the
 *   same whether the phone was known or not (A4).
 * - Anti-spam: honeypot, rate limits per IP and phone, at most 3 active future bookings per phone.
 * - Everything runs in one booking transaction (client, barber auto-pick, appointment) through the
 *   appointments service in online mode with the client as the actor.
 */
import type { PayloadRequest } from 'payload'

import { createAppointment, runBookingTransaction } from '@/crm/appointments'
import { findCertificate, normalizeCertificateCode } from '@/crm/certificates'
import { tryNormalizePhone } from '@/crm/phone'
import { findPromoByCode } from '@/crm/promo'
import {
  checkRateLimit,
  consumeRateLimit,
  MAX_ACTIVE_BOOKINGS_PER_PHONE,
  RATE_LIMITS,
} from '@/crm/rate-limit'
import { ruleError } from '@/crm/errors'
import { checkSlot, pickBarber } from '@/crm/slots'
import { loadSlotInput } from '@/crm/slots.loader'
import { toLocalDate } from '@/crm/time'

import {
  parseSelection,
  publicRequest,
  readSettings,
  SYSTEM_READ,
  validateSelection,
  type Selection,
} from './context'
import {
  bookingEndpoint,
  bookingError,
  clientIp,
  enforce,
  InputErrors,
  isLocale,
  limit,
  ok,
  optionalText,
  readBody,
  type Locale,
} from './http'

export const NAME_MAX = 60
export const EMAIL_MAX = 254
export const COMMENT_MAX = 500

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export type BookingInput = Selection & {
  start: Date
  phone: string
  firstName: string
  lastName: string | null
  email: string | null
  language: Locale
  promoCode: string | null
  certificateCode: string | null
  comment: string | null
}

/** Validates the body; the phone comes back in E.164. */
export const parseBookingInput = (body: Record<string, unknown>): BookingInput => {
  const errors = new InputErrors()
  const selection = parseSelection(errors, {
    location: body.location,
    barber: body.barber,
    service: body.service,
    extras: body.extras,
  })
  const start = typeof body.start === 'string' ? new Date(body.start) : null
  if (!start || Number.isNaN(start.getTime())) errors.add('start')
  const firstName = optionalText(errors, 'firstName', body.firstName, NAME_MAX)
  if (!firstName) errors.add('firstName')
  const lastName = optionalText(errors, 'lastName', body.lastName, NAME_MAX)
  const email = optionalText(errors, 'email', body.email, EMAIL_MAX)?.toLowerCase() ?? null
  if (email && !EMAIL_RE.test(email)) errors.add('email')
  if (!isLocale(body.language)) errors.add('language')
  const promoCode = optionalText(errors, 'promoCode', body.promoCode, 64)
  const certificateCode = optionalText(errors, 'certificateCode', body.certificateCode, 64)
  const comment = optionalText(errors, 'comment', body.comment, COMMENT_MAX)
  const rawPhone = typeof body.phone === 'string' ? body.phone : ''
  if (rawPhone.length > 32) errors.add('phone')
  const phone = rawPhone.length <= 32 ? tryNormalizePhone(rawPhone) : null
  if (!phone && !errors.fields.includes('phone')) {
    // A bad phone has its own code (the form highlights the field with a specific message).
    errors.throwIfAny()
    throw bookingError('PHONE_INVALID', 400)
  }
  errors.throwIfAny()
  return {
    ...selection,
    start: start!,
    phone: phone!,
    firstName: firstName!,
    lastName,
    email,
    language: body.language as Locale,
    promoCode,
    certificateCode,
    comment,
  }
}

type ClientRow = {
  id: string
  firstName?: string | null
  lastName?: string | null
  email?: string | null
  blocked?: boolean | null
}

const same = (a: string | null | undefined, b: string | null | undefined) =>
  (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase()

/**
 * Text for `clientComment`: the visitor's comment, then — for a known phone — the submitted values
 * that differ from the client card, and the planned certificate. Field names are machine keys
 * (the comment is shown to staff as is, in any admin language).
 */
export const composeClientComment = (
  input: Pick<BookingInput, 'comment' | 'firstName' | 'lastName' | 'email'>,
  existing: ClientRow | null,
  certificateCode: string | null,
): string | null => {
  const notes: string[] = []
  if (existing) {
    if (!same(existing.firstName, input.firstName)) notes.push(`firstName: ${input.firstName}`)
    if (input.lastName && !same(existing.lastName, input.lastName))
      notes.push(`lastName: ${input.lastName}`)
    if (input.email && !same(existing.email, input.email)) notes.push(`email: ${input.email}`)
  }
  // TODO(stage 18): store as `plannedCertificate` instead.
  if (certificateCode) notes.push(`certificate: ${certificateCode}`)
  const parts = [input.comment, notes.length ? `[online] ${notes.join('; ')}` : null].filter(
    Boolean,
  )
  return parts.length ? parts.join('\n') : null
}

/** System read of the client card by phone (inside the booking transaction). */
const findClient = async (req: PayloadRequest, phone: string): Promise<ClientRow | null> => {
  const { docs } = await req.payload.find({
    collection: 'clients',
    ...SYSTEM_READ,
    req,
    where: { phone: { equals: phone } },
    limit: 1,
    select: { firstName: true, lastName: true, email: true, blocked: true },
  })
  return (docs[0] as unknown as ClientRow | undefined) ?? null
}

/** A concurrent booking created the same phone: retry the transaction, it will find the client. */
const isDuplicatePhone = (error: unknown): boolean => {
  const e = error as {
    code?: number
    name?: string
    data?: { code?: string; errors?: { path?: string }[] }
    cause?: unknown
  } | null
  if (!e) return false
  // The Mongo adapter turns a unique index violation (11000) into a `ValidationError` on `phone`.
  const uniqueViolation =
    e.name === 'ValidationError' && (e.data?.errors ?? []).some((item) => item.path === 'phone')
  return (
    e.code === 11000 ||
    e.data?.code === 'PHONE_TAKEN' ||
    uniqueViolation ||
    (!!e.cause && isDuplicatePhone(e.cause))
  )
}

/** Creates the client card of a new phone (system write: anonymous visitors cannot create clients). */
const createClient = async (req: PayloadRequest, input: BookingInput): Promise<string> => {
  try {
    const doc = await req.payload.create({
      collection: 'clients',
      data: {
        firstName: input.firstName,
        lastName: input.lastName,
        phone: input.phone,
        email: input.email,
        language: input.language,
        source: 'online',
      },
      overrideAccess: true,
      depth: 0,
      select: {},
      req,
    })
    return String(doc.id)
  } catch (error) {
    if (isDuplicatePhone(error))
      throw Object.assign(new Error('PHONE_TAKEN_CONCURRENTLY'), { data: { retryable: true } })
    throw error
  }
}

const activeBookings = async (req: PayloadRequest, clientId: string, now: Date) =>
  (
    await req.payload.count({
      collection: 'appointments',
      overrideAccess: true,
      req,
      where: {
        and: [
          { client: { equals: clientId } },
          { kind: { equals: 'appointment' } },
          { status: { equals: 'scheduled' } },
          { startAt: { greater_than: now.toISOString() } },
        ],
      },
    })
  ).totalDocs

/** "Any barber" (decision 22): the auto-pick of §5.3 p.6 at the moment of creation. */
const chooseBarber = async (
  req: PayloadRequest,
  input: BookingInput,
  now: Date,
  clientBlocked: boolean,
): Promise<string> => {
  if (input.barberId) return input.barberId
  const slotInput = await loadSlotInput(
    req.payload,
    {
      mode: 'online',
      locationId: input.locationId,
      date: toLocalDate(input.start),
      serviceId: input.serviceId,
      extraIds: input.extraIds,
      now,
      clientBlocked,
    },
    req,
  )
  const picked = pickBarber(slotInput, input.start)
  if (picked) return picked
  const taken = slotInput.barbers.some((barber) => {
    const check = checkSlot(slotInput, barber.id, input.start)
    return !check.ok && check.code === 'SLOT_TAKEN'
  })
  throw taken ? ruleError(req.t, 'SLOT_TAKEN', 409) : ruleError(req.t, 'SLOT_UNAVAILABLE')
}

export type BookingResult = {
  id: string
  start: string
  end: string
  barber: { id: string; name: string }
  location: string
  service: string
  total: number
  /** Plain cancel token of the new booking (for the link on the success screen; also in the email). */
  cancelToken: string
}

export const createBooking = async (
  req: PayloadRequest,
  input: BookingInput,
  now: Date = new Date(),
): Promise<BookingResult> => {
  const settings = await readSettings(req)
  if (!settings.onlineBookingEnabled) throw bookingError('BOOKING_DISABLED', 403)
  await validateSelection(req, input)

  let certificateCode: string | null = null
  if (input.certificateCode) {
    const certificate = await findCertificate(req, input.certificateCode)
    if (!certificate) throw bookingError('CERTIFICATE_NOT_FOUND', 404)
    certificateCode = normalizeCertificateCode(certificate.code)
  }

  const actor = await publicRequest(req)
  const { doc, cancelToken } = await runBookingTransaction(actor, async () => {
    const existing = await findClient(actor, input.phone)
    if (
      existing &&
      (await activeBookings(actor, existing.id, now)) >= MAX_ACTIVE_BOOKINGS_PER_PHONE
    )
      throw bookingError('ACTIVE_BOOKINGS_LIMIT', 409)
    const clientId = existing ? String(existing.id) : await createClient(actor, input)
    const barberId = await chooseBarber(actor, input, now, existing?.blocked === true)

    let promoCode: string | null = null
    if (input.promoCode) {
      const promo = await findPromoByCode(actor, input.promoCode)
      // The service validates the code in full (period, limits, per-client limit, applicability).
      if (!promo) throw ruleError(actor.t, 'PROMO_NOT_FOUND', 404)
      promoCode = String(promo.id)
    }

    return createAppointment(
      actor,
      {
        location: input.locationId,
        barber: barberId,
        client: clientId,
        service: input.serviceId,
        extras: input.extraIds,
        startAt: input.start,
        promoCode,
        language: input.language,
        clientComment: composeClientComment(input, existing, certificateCode),
      },
      { mode: 'online', actorType: 'client', now },
    )
  })

  const barberId = String(doc.barber)
  const { docs: barbers } = await req.payload.find({
    collection: 'barbers',
    ...SYSTEM_READ,
    req,
    where: { id: { equals: barberId } },
    limit: 1,
    select: { name: true },
  })
  return {
    id: String(doc.id),
    start: new Date(doc.startAt as string).toISOString(),
    end: new Date(doc.endAt as string).toISOString(),
    barber: { id: barberId, name: (barbers[0] as { name?: string } | undefined)?.name ?? '' },
    location: String(doc.location),
    service: String(doc.service),
    total: doc.total as number,
    cancelToken: cancelToken!,
  }
}

export const createEndpoint = bookingEndpoint(
  'post',
  '/booking',
  async (req) => {
    const ip = clientIp(req)
    await limit(RATE_LIMITS.createAttempt, ip)
    enforce(await checkRateLimit(RATE_LIMITS.create, ip))

    const body = await readBody(req)
    // Honeypot: a hidden field people never fill in.
    if (body.honeypot !== undefined && body.honeypot !== null && body.honeypot !== '')
      throw bookingError('BOOKING_REJECTED', 400)

    const input = parseBookingInput(body)
    await limit(RATE_LIMITS.phoneAttempt, input.phone)

    const result = await createBooking(req, input)
    await consumeRateLimit(RATE_LIMITS.create, ip)
    return ok(result)
  },
  { rateLimit: 'none' },
)
