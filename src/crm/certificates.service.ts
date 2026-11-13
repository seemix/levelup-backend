/**
 * Gift certificates, database side (spec §4.17, §5.7, A6, A34). Pure rules — `./certificates`.
 *
 * - `prepareCertificate` (beforeChange): a certificate is created only by `sellCertificate`
 *   (`CERTIFICATE_SALE_ONLY` otherwise) with server fields (code, balance = nominal, issue date,
 *   default expiry); on update the code, nominal, balance, issue date and sale never change.
 * - `sellCertificate`: the certificate + `transactions(certificate_sale)` in one DB transaction.
 * - `chargeCertificate` / `returnToCertificate`: atomic `$inc` of the balance in the caller's
 *   transaction; a charge is conditional (`balance ≥ amount`, not void, not expired), so two
 *   concurrent charges of one certificate never overdraw it (the loser gets a write conflict or
 *   `CERTIFICATE_INSUFFICIENT`).
 * - `findCertificate`: the online check of a code (only usable certificates are "found").
 */
import type { CollectionBeforeChangeHook, FieldHook, PayloadRequest } from 'payload'

import { crmT } from '@/i18n'

import { isTransientError, mongo, sessionOf } from './appointments'
import {
  certificateStatus,
  defaultExpiry,
  generateCertificateCode,
  normalizeCertificateCode,
  type CertificateState,
} from './certificates'
import { businessError, ruleError, type RuleErrorCode } from './errors'
import type { LedgerEntry } from './ledger'
import {
  createTransaction,
  runLedgerTransaction,
  type LedgerWarning,
  type TransactionDoc,
} from './ledger.service'
import { isBani } from './money'
import { tryNormalizePhone } from './phone'
import { relationId, type RelationValue } from './schedule'

export const CERTIFICATE_CONTEXT = {
  /** Set by `sellCertificate` for the create of the certificate document. */
  sale: 'certificateSale',
} as const

type SaleContext = { code: string; now: Date }

type Data = Record<string, unknown>

/** Never changed through the collection after creation (decision 34: amounts are not edited). */
const IMMUTABLE_FIELDS = ['code', 'nominal', 'balance', 'issuedAt', 'saleTransaction'] as const

const STATUS: Partial<Record<RuleErrorCode, number>> = {
  CERTIFICATE_NOT_FOUND: 404,
  CERTIFICATE_INSUFFICIENT: 409,
  CERTIFICATE_SALE_ONLY: 403,
  LEDGER_CONFLICT: 409,
}

export const certificateError = (req: PayloadRequest, code: RuleErrorCode): never => {
  throw ruleError(req.t, code, STATUS[code] ?? 400)
}

const conflict = (req: PayloadRequest, error: unknown): never => {
  if (isTransientError(error))
    throw businessError('LEDGER_CONFLICT', crmT(req.t, 'errors.ledgerConflict'), 409)
  throw error
}

const toDate = (value: unknown): Date | null => {
  if (!value) return null
  const date = new Date(value as string | Date)
  return Number.isNaN(date.getTime()) ? null : date
}

const normalizeBuyerPhone = (req: PayloadRequest, data: Data) => {
  if (data.buyerPhone === undefined || data.buyerPhone === null || data.buyerPhone === '') return
  const phone = typeof data.buyerPhone === 'string' ? tryNormalizePhone(data.buyerPhone) : null
  if (!phone) throw businessError('PHONE_INVALID', crmT(req.t, 'errors.phoneInvalid'))
  data.buyerPhone = phone
}

// ---------------------------------------------------------------------------
// Collection hooks
// ---------------------------------------------------------------------------

export const prepareCertificate: CollectionBeforeChangeHook = ({
  data,
  operation,
  originalDoc,
  req,
}) => {
  const next = data as Data
  if (operation === 'create') {
    const sale = req.context[CERTIFICATE_CONTEXT.sale] as SaleContext | undefined
    if (!sale) return certificateError(req, 'CERTIFICATE_SALE_ONLY')
    if (!isBani(next.nominal) || next.nominal <= 0)
      return certificateError(req, 'CERTIFICATE_NOMINAL_INVALID')
    next.code = sale.code
    next.balance = next.nominal
    next.issuedAt = sale.now.toISOString()
    next.expiresAt = (toDate(next.expiresAt) ?? defaultExpiry(sale.now)).toISOString()
    next.voided = false
    next.saleTransaction = null
  } else {
    const prev = (originalDoc ?? {}) as Data
    for (const field of IMMUTABLE_FIELDS) next[field] = prev[field]
  }
  const issuedAt = toDate(next.issuedAt)
  const expiresAt = toDate(next.expiresAt)
  if (!expiresAt || (issuedAt && expiresAt <= issuedAt))
    certificateError(req, 'CERTIFICATE_EXPIRY_INVALID')
  normalizeBuyerPhone(req, next)
  return next
}

/** Virtual `status` (§4.17): derived on every read from `voided`, `expiresAt` and `balance`. */
export const certificateStatusField: FieldHook = ({ siblingData }) =>
  certificateStatus(siblingData as CertificateState, new Date())

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export type CertificateRow = {
  id: string
  code: string
  balance: number
  nominal: number
  expiresAt: string | null
  voided: boolean
}

/** System read by code inside the current transaction (`null` — no such code). */
export const findCertificateByCode = async (
  req: PayloadRequest,
  rawCode: string,
): Promise<CertificateRow | null> => {
  const { docs } = await req.payload.find({
    collection: 'gift-certificates',
    where: { code: { equals: normalizeCertificateCode(rawCode) } },
    limit: 1,
    pagination: false,
    depth: 0,
    overrideAccess: true,
    req,
    select: { code: true, balance: true, nominal: true, expiresAt: true, voided: true },
  })
  const doc = docs[0] as Data | undefined
  if (!doc) return null
  return {
    id: String(doc.id),
    code: doc.code as string,
    balance: (doc.balance as number | null) ?? 0,
    nominal: (doc.nominal as number | null) ?? 0,
    expiresAt: (doc.expiresAt as string | null) ?? null,
    voided: Boolean(doc.voided),
  }
}

/** Public certificate check (online booking): only an active certificate is "found". */
export type CertificateInfo = { id: string; code: string; balance: number }

export type CertificateLookup = (
  req: PayloadRequest,
  code: string,
) => Promise<CertificateInfo | null>

const lookupInCollection: CertificateLookup = async (req, code) => {
  const certificate = await findCertificateByCode(req, code)
  if (!certificate || certificateStatus(certificate, new Date()) !== 'active') return null
  return { id: certificate.id, code: certificate.code, balance: certificate.balance }
}

let lookup: CertificateLookup = lookupInCollection

export const findCertificate: CertificateLookup = (req, code) =>
  lookup(req, normalizeCertificateCode(code))

/** Replaces the lookup (tests); without an argument restores the collection lookup. */
export const setCertificateLookup = (next: CertificateLookup = lookupInCollection): void => {
  lookup = next
}

// ---------------------------------------------------------------------------
// Balance changes (in the caller's transaction)
// ---------------------------------------------------------------------------

/** Atomic conditional charge (§5.7): `balance ≥ amount`, not void, not expired. */
export const chargeCertificate = async (
  req: PayloadRequest,
  certificateId: string,
  amount: number,
  now: Date,
): Promise<number> => {
  const session = await sessionOf(req)
  const updated = (await mongo(req)
    .collections['gift-certificates'].findOneAndUpdate(
      {
        _id: certificateId,
        balance: { $gte: amount },
        voided: { $ne: true },
        expiresAt: { $gt: now },
      },
      { $inc: { balance: -amount } },
      { new: true, session, projection: { balance: 1 } },
    )
    .lean()
    .catch((error: unknown) => conflict(req, error))) as { balance?: number } | null
  if (!updated) return certificateError(req, 'CERTIFICATE_INSUFFICIENT')
  return updated.balance ?? 0
}

/** A refund returns the certificate part to its balance (§5.7), whatever its status now. */
export const returnToCertificate = async (
  req: PayloadRequest,
  certificateId: string,
  amount: number,
): Promise<number> => {
  const session = await sessionOf(req)
  const updated = (await mongo(req)
    .collections['gift-certificates'].findOneAndUpdate(
      { _id: certificateId },
      { $inc: { balance: amount } },
      { new: true, session, projection: { balance: 1 } },
    )
    .lean()
    .catch((error: unknown) => conflict(req, error))) as { balance?: number } | null
  if (!updated) return certificateError(req, 'CERTIFICATE_NOT_FOUND')
  return updated.balance ?? 0
}

// ---------------------------------------------------------------------------
// Sale (§5.7)
// ---------------------------------------------------------------------------

export type CertificateSaleInput = {
  nominal: number
  entries: LedgerEntry[]
  /** Location of the sale; by default — the location of the first register. */
  location?: string | null
  expiresAt?: string | Date | null
  buyerName?: string | null
  buyerPhone?: string | null
  comment?: string | null
}

export type CertificateDoc = Data & { id: string | number }

export type CertificateSaleResult = {
  certificate: CertificateDoc
  transaction: TransactionDoc
  warnings: LedgerWarning[]
}

const registerLocation = async (req: PayloadRequest, registerId: string | undefined) => {
  if (!registerId) return null
  const { docs } = await req.payload.find({
    collection: 'cash-registers',
    where: { id: { equals: registerId } },
    limit: 1,
    pagination: false,
    depth: 0,
    overrideAccess: true,
    req,
    select: { location: true },
  })
  return relationId((docs[0] as Data | undefined)?.location as RelationValue)
}

/** A code that is not taken yet (the unique index stays the final guard). */
const freshCode = async (req: PayloadRequest): Promise<string> => {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateCertificateCode()
    if (!(await findCertificateByCode(req, code))) return code
  }
  throw new Error('Could not generate a unique certificate code')
}

/**
 * Sells a certificate: the certificate document and the `certificate_sale` operation (Σentries =
 * nominal) in one DB transaction, with the user's rights (admin, manager of the location).
 */
export const sellCertificate = (
  req: PayloadRequest,
  input: CertificateSaleInput,
  { now: clock }: { now?: Date } = {},
): Promise<CertificateSaleResult> =>
  runLedgerTransaction(req, async () => {
    const now = clock ?? new Date()
    if (!isBani(input.nominal) || input.nominal <= 0)
      certificateError(req, 'CERTIFICATE_NOMINAL_INVALID')
    const location = input.location ?? (await registerLocation(req, input.entries[0]?.cashRegister))
    if (!location) certificateError(req, 'CASH_REGISTER_INVALID')

    // Generate first: a nested Local API call may replace `req.context`.
    const code = await freshCode(req)
    req.context[CERTIFICATE_CONTEXT.sale] = { code, now } satisfies SaleContext
    let certificate: CertificateDoc
    try {
      certificate = (await req.payload.create({
        collection: 'gift-certificates',
        data: {
          nominal: input.nominal,
          expiresAt: input.expiresAt ? new Date(input.expiresAt).toISOString() : undefined,
          buyerName: input.buyerName ?? null,
          buyerPhone: input.buyerPhone ?? null,
          comment: input.comment ?? null,
        } as never,
        overrideAccess: !req.user,
        depth: 0,
        req,
      })) as unknown as CertificateDoc
    } finally {
      delete req.context[CERTIFICATE_CONTEXT.sale]
    }

    const sale = await createTransaction(
      req,
      {
        type: 'certificate_sale',
        location: location!,
        entries: input.entries,
        certificate: String(certificate.id),
        comment: input.comment ?? null,
        occurredAt: now,
      },
      { now, allowServiceTypes: true, nominal: input.nominal },
    )
    // The link back to the sale is a server field: set directly in the same transaction.
    await mongo(req)
      .collections['gift-certificates'].updateOne(
        { _id: certificate.id },
        { $set: { saleTransaction: sale.doc.id } },
        { session: await sessionOf(req) },
      )
      .catch((error: unknown) => conflict(req, error))
    return {
      certificate: { ...certificate, saleTransaction: String(sale.doc.id) },
      transaction: sale.doc,
      warnings: sale.warnings,
    }
  })
