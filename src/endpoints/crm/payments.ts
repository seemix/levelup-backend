/**
 * Payments, refunds and certificate sales (spec §6.2, §5.7, §5.8, A34):
 * - `POST /api/crm/appointments/:id/payments` {entries, certificateCode?, certificateAmount?,
 *   comment?} (no tips, A45) → `{ transaction, appointment, certificate, warnings }`;
 * - `POST /api/crm/transactions/:id/refund` {comment?} (admin) → `{ transaction, original,
 *   appointment, certificate, warnings }`;
 * - `POST /api/crm/certificates/sell` {nominal, entries, location?, expiresAt?, buyer?: {name,
 *   phone}, comment?} → `{ certificate, transaction, warnings }`.
 *
 * Amounts are integer bani. A resource outside the user's read access → 404 (existence is not
 * revealed); the remaining rules (roles, registers of the location, amounts) — the services and the
 * ledger hook, with the user's rights.
 */
import type { PayloadRequest } from 'payload'

import { isBani } from '@/crm/money'
import { runLedgerTransaction } from '@/crm/ledger.service'
import type { LedgerEntry } from '@/crm/ledger'
import { sellCertificate } from '@/crm/certificates.service'
import { payAppointment, refundPayment } from '@/crm/payments.service'

import { InputErrors, isId, ok, optionalText, readBody } from '../booking/http'
import { crmEndpoint, crmError, routeParam } from './http'

const COMMENT_MAX = 1000
const NAME_MAX = 120
const PHONE_MAX = 40
const CODE_MAX = 40
const MAX_ENTRIES = 10

const has = (body: Record<string, unknown>, key: string) =>
  body[key] !== undefined && body[key] !== null && body[key] !== ''

/** `[{ cashRegister, amount }]`: ids and positive whole bani; empty allowed when `allowEmpty`. */
const parseEntries = (errors: InputErrors, value: unknown, allowEmpty: boolean): LedgerEntry[] => {
  if (value === undefined || value === null) {
    if (!allowEmpty) errors.add('entries')
    return []
  }
  if (!Array.isArray(value) || value.length > MAX_ENTRIES || (!allowEmpty && value.length === 0)) {
    errors.add('entries')
    return []
  }
  return value.map((row) => {
    const entry = (row ?? {}) as Record<string, unknown>
    if (!isId(entry.cashRegister) || !isBani(entry.amount) || (entry.amount as number) <= 0)
      errors.add('entries')
    return { cashRegister: String(entry.cashRegister), amount: entry.amount as number }
  })
}

const optionalBani = (errors: InputErrors, field: string, value: unknown): number | null => {
  if (value === undefined || value === null) return null
  if (!isBani(value) || value < 0) {
    errors.add(field)
    return null
  }
  return value
}

/** The user may read the document (row access) — otherwise 404. */
const assertReadable = async (
  req: PayloadRequest,
  collection: 'appointments' | 'transactions',
  id: string,
) => {
  const { totalDocs } = await req.payload.count({
    collection,
    where: { id: { equals: id } },
    overrideAccess: false,
    user: req.user,
    req,
  })
  if (totalDocs === 0) throw crmError('NOT_FOUND', 404)
}

export const appointmentPaymentEndpoint = crmEndpoint(
  'post',
  '/appointments/:id/payments',
  async (req) => {
    const id = routeParam(req, 'id')
    if (!isId(id)) throw crmError('NOT_FOUND', 404)
    const body = await readBody(req)
    const errors = new InputErrors()
    const certificateCode = optionalText(errors, 'certificateCode', body.certificateCode, CODE_MAX)
    const entries = parseEntries(errors, body.entries, Boolean(certificateCode))
    const certificateAmount = optionalBani(errors, 'certificateAmount', body.certificateAmount)
    if (certificateAmount !== null && !certificateCode) errors.add('certificateCode')
    const comment = optionalText(errors, 'comment', body.comment, COMMENT_MAX)
    errors.throwIfAny()

    const result = await runLedgerTransaction(req, async () => {
      await assertReadable(req, 'appointments', id)
      return payAppointment(req, id, {
        entries,
        certificateCode,
        certificateAmount,
        comment,
      })
    })
    return ok(result)
  },
)

export const refundTransactionEndpoint = crmEndpoint(
  'post',
  '/transactions/:id/refund',
  async (req) => {
    const id = routeParam(req, 'id')
    if (!isId(id)) throw crmError('NOT_FOUND', 404)
    const body = await readBody(req)
    const errors = new InputErrors()
    const comment = optionalText(errors, 'comment', body.comment, COMMENT_MAX)
    errors.throwIfAny()

    const result = await runLedgerTransaction(req, async () => {
      await assertReadable(req, 'transactions', id)
      return refundPayment(req, id, { comment })
    })
    return ok({ ...result, original: id })
  },
)

export const sellCertificateEndpoint = crmEndpoint('post', '/certificates/sell', async (req) => {
  const body = await readBody(req)
  const errors = new InputErrors()
  const nominal = body.nominal
  if (!isBani(nominal) || nominal <= 0) errors.add('nominal')
  const entries = parseEntries(errors, body.entries, false)
  const location = has(body, 'location') ? body.location : null
  if (location !== null && !isId(location)) errors.add('location')
  let expiresAt: Date | null = null
  if (has(body, 'expiresAt')) {
    expiresAt = typeof body.expiresAt === 'string' ? new Date(body.expiresAt) : null
    if (!expiresAt || Number.isNaN(expiresAt.getTime())) errors.add('expiresAt')
  }
  const buyer = (body.buyer ?? {}) as Record<string, unknown>
  if (typeof buyer !== 'object' || Array.isArray(buyer)) errors.add('buyer')
  const buyerName = optionalText(errors, 'buyer.name', buyer.name, NAME_MAX)
  const buyerPhone = optionalText(errors, 'buyer.phone', buyer.phone, PHONE_MAX)
  const comment = optionalText(errors, 'comment', body.comment, COMMENT_MAX)
  errors.throwIfAny()

  const result = await sellCertificate(req, {
    nominal: nominal as number,
    entries,
    location: location as string | null,
    expiresAt,
    buyerName,
    buyerPhone,
    comment,
  })
  return ok(result)
})
