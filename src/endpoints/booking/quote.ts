/**
 * `POST /api/booking/quote` (spec §6.1, §5.4, §5.5, §5.7 online):
 * `{ location, barber?, service, extras?, promoCode?, certificateCode? }` →
 * `{ lines, durationMinutes, subtotal, promoDiscount, total, certificateCover, toPay, priceFrom }`.
 * Without a barber ("any") the cheapest of the barbers who could take the booking is shown as "from".
 * The per-client promo limit is checked only on creation (the phone is not known here).
 */
import type { PayloadRequest } from 'payload'

import { loadPriceItems } from '@/crm/appointments'
import { findCertificate } from '@/crm/certificates.service'
import {
  certificateCoverage,
  calculatePrice,
  type PriceResult,
  type PromoRule,
} from '@/crm/pricing'
import { normalizePromoCode, validatePromo } from '@/crm/promo'

import { parseSelection, SYSTEM_READ, validateSelection, type Selection } from './context'
import { bookingEndpoint, bookingError, InputErrors, ok, optionalText, readBody } from './http'

export type QuoteInput = Selection & { promoCode: string | null; certificateCode: string | null }

export const parseQuoteInput = (
  errors: InputErrors,
  body: Record<string, unknown>,
): QuoteInput => ({
  ...parseSelection(errors, {
    location: body.location,
    barber: body.barber,
    service: body.service,
    extras: body.extras,
  }),
  promoCode: optionalText(errors, 'promoCode', body.promoCode, 64),
  certificateCode: optionalText(errors, 'certificateCode', body.certificateCode, 64),
})

/** Barbers who could take the selection online in the location (for "any"). */
const candidateBarbers = async (req: PayloadRequest, selection: Selection): Promise<string[]> => {
  if (selection.barberId) return [selection.barberId]
  const { docs } = await req.payload.find({
    collection: 'barbers',
    ...SYSTEM_READ,
    req,
    where: {
      and: [
        { active: { equals: true } },
        { onlineBooking: { equals: true } },
        { locations: { in: [selection.locationId] } },
        { services: { in: [selection.serviceId] } },
      ],
    },
    sort: 'order',
    limit: 0,
    select: { order: true },
  })
  return docs.map((doc) => String(doc.id))
}

export type Quote = {
  barber: string | null
  /** `true` when no barber was chosen: the minimum over the possible barbers (§5.4 p.8). */
  priceFrom: boolean
  promoCode: string | null
  certificateCode: string | null
} & Pick<PriceResult, 'lines' | 'durationMinutes' | 'subtotal' | 'promoDiscount' | 'total'> & {
    certificateCover: number
    toPay: number
  }

export const quote = async (req: PayloadRequest, input: QuoteInput, now: Date): Promise<Quote> => {
  await validateSelection(req, input)
  const barbers = await candidateBarbers(req, input)
  if (barbers.length === 0) throw bookingError('BARBER_NOT_FOUND', 404)

  let rule: PromoRule | null = null
  let best: { barber: string; price: PriceResult } | null = null
  for (const barber of barbers) {
    const items = await loadPriceItems(req, {
      mode: 'online',
      serviceId: input.serviceId,
      extraIds: input.extraIds,
      barberId: barber,
    })
    // Applicability depends on the items, not on the barber: the code is validated once.
    if (input.promoCode && !rule) {
      const lines = calculatePrice(items).lines
      rule = (await validatePromo({ req, code: input.promoCode, mode: 'online', lines, now })).rule
    }
    const price = calculatePrice({ ...items, promo: rule })
    if (!best || price.total < best.price.total) best = { barber, price }
  }
  const { price } = best!

  let certificateCover = 0
  let toPay = price.total
  let certificateCode: string | null = null
  if (input.certificateCode) {
    const certificate = await findCertificate(req, input.certificateCode)
    if (!certificate) throw bookingError('CERTIFICATE_NOT_FOUND', 404)
    const cover = certificateCoverage({ total: price.total, balance: certificate.balance })
    certificateCover = cover.covered
    toPay = cover.toPay
    certificateCode = certificate.code
  }

  return {
    barber: input.barberId,
    priceFrom: !input.barberId && barbers.length > 1,
    promoCode: rule && input.promoCode ? normalizePromoCode(input.promoCode) : null,
    certificateCode,
    lines: price.lines,
    durationMinutes: price.durationMinutes,
    subtotal: price.subtotal,
    promoDiscount: price.promoDiscount,
    total: price.total,
    certificateCover,
    toPay,
  }
}

export const quoteEndpoint = bookingEndpoint('post', '/booking/quote', async (req) => {
  const errors = new InputErrors()
  const input = parseQuoteInput(errors, await readBody(req))
  errors.throwIfAny()
  return ok(await quote(req, input, new Date()))
})
