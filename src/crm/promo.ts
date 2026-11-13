/**
 * Promo codes (spec §5.5, §4.16, A5). `checkPromo` is pure; `validatePromo` is the database adapter:
 * it loads the code, counts the client's uses through a `PromoUsageSource` and throws `APIError`
 * with a machine code (`PROMO_*`) and a translated message.
 */
import type { Payload, PayloadRequest } from 'payload'

import { CANCELLED_STATUSES } from './appointment-status'
import { ruleError } from './errors'
import type { PriceLine, PromoRule } from './pricing'
import { promoApplicableLines } from './pricing'
import { relationId, type RelationValue } from './schedule'
import { toLocalDate } from './time'

export const PROMO_ERROR_CODES = [
  'PROMO_NOT_FOUND',
  'PROMO_EXPIRED',
  'PROMO_LIMIT',
  'PROMO_CLIENT_LIMIT',
  'PROMO_NOT_APPLICABLE',
] as const
export type PromoErrorCode = (typeof PROMO_ERROR_CODES)[number]

export const PROMO_CODE_MAX_LENGTH = 32
/** Letters (any script), digits, `-` and `_` after normalization. */
const PROMO_CODE_RE = /^[\p{L}\p{N}_-]+$/u

/** Codes are case-insensitive: stored and compared upper-cased, without any whitespace. */
export const normalizePromoCode = (raw: string): string => raw.replace(/\s+/g, '').toUpperCase()

export const isValidPromoCode = (code: string): boolean =>
  code.length > 0 && code.length <= PROMO_CODE_MAX_LENGTH && PROMO_CODE_RE.test(code)

/** `promo-codes` document as read with `depth: 0`. */
export type PromoDoc = {
  id: string | number
  code: string
  active?: boolean | null
  discountType: 'percent' | 'fixed'
  value: number
  validFrom?: string | Date | null
  validTo?: string | Date | null
  maxUses?: number | null
  maxUsesPerClient?: number | null
  appliesToServices?: readonly RelationValue[] | null
  appliesToExtras?: readonly RelationValue[] | null
  onlineAllowed?: boolean | null
  usedCount?: number | null
}

const ids = (values: readonly RelationValue[] | null | undefined): string[] =>
  (values ?? []).map(relationId).filter((id): id is string => id !== null)

export const toPromoRule = (promo: PromoDoc): PromoRule => ({
  discountType: promo.discountType,
  value: promo.value,
  appliesToServices: ids(promo.appliesToServices),
  appliesToExtras: ids(promo.appliesToExtras),
})

/** Local `YYYY-MM-DD` of a stored date (the admin stores "day only" dates at noon). */
const localDay = (value: string | Date | null | undefined): string | null =>
  value ? toLocalDate(new Date(value)) : null

export type PromoCheckInput = {
  promo: PromoDoc | null
  now: Date
  mode: 'online' | 'staff'
  /** Lines of the appointment being priced (`buildLines`). */
  lines: readonly PriceLine[]
  /** Non-cancelled appointments of the client with this code (excluding the edited one). */
  clientUses: number
  /** The edited appointment already holds this code, so `usedCount` already includes it. */
  alreadyApplied?: boolean
}

export type PromoCheck =
  { ok: true; promoId: string; rule: PromoRule } | { ok: false; code: PromoErrorCode }

/**
 * Checks, in this order: exists and active (a staff-only code is "not found" online) →
 * period (inclusive local days) → at least one applicable line → total limit → per-client limit.
 */
export const checkPromo = (input: PromoCheckInput): PromoCheck => {
  const { promo, now, mode } = input
  if (!promo || !promo.active || (mode === 'online' && !promo.onlineAllowed))
    return { ok: false, code: 'PROMO_NOT_FOUND' }

  const today = toLocalDate(now)
  const from = localDay(promo.validFrom)
  const to = localDay(promo.validTo)
  if ((from && today < from) || (to && today > to)) return { ok: false, code: 'PROMO_EXPIRED' }

  const rule = toPromoRule(promo)
  if (promoApplicableLines(input.lines, rule).length === 0)
    return { ok: false, code: 'PROMO_NOT_APPLICABLE' }

  const used = (promo.usedCount ?? 0) - (input.alreadyApplied ? 1 : 0)
  if (typeof promo.maxUses === 'number' && used >= promo.maxUses)
    return { ok: false, code: 'PROMO_LIMIT' }
  if (typeof promo.maxUsesPerClient === 'number' && input.clientUses >= promo.maxUsesPerClient)
    return { ok: false, code: 'PROMO_CLIENT_LIMIT' }

  return { ok: true, promoId: String(promo.id), rule }
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

/** Counts the client's non-cancelled appointments with the promo code (A5), in one query. */
export type PromoUsageSource = (args: {
  payload: Payload
  req: PayloadRequest
  promoId: string
  clientId: string
  excludeAppointmentId?: string
}) => Promise<number>

/** Test helper: the client has never used the code. */
export const noPromoUsages: PromoUsageSource = async () => 0

/** Non-cancelled appointments of the client holding the code (A5), except the edited one. */
export const appointmentsPromoUsage: PromoUsageSource = async ({
  payload,
  req,
  promoId,
  clientId,
  excludeAppointmentId,
}) => {
  const { totalDocs } = await payload.count({
    collection: 'appointments',
    where: {
      and: [
        { promoCode: { equals: promoId } },
        { client: { equals: clientId } },
        { status: { not_in: [...CANCELLED_STATUSES] } },
        ...(excludeAppointmentId ? [{ id: { not_equals: excludeAppointmentId } }] : []),
      ],
    },
    overrideAccess: true,
    req,
  })
  return totalDocs
}

const PROMO_SELECT = {
  code: true,
  active: true,
  discountType: true,
  value: true,
  validFrom: true,
  validTo: true,
  maxUses: true,
  maxUsesPerClient: true,
  appliesToServices: true,
  appliesToExtras: true,
  onlineAllowed: true,
  usedCount: true,
} as const

/** System read of a promo code by id (the appointment holds the relation). */
export const findPromoById = async (req: PayloadRequest, id: string): Promise<PromoDoc | null> => {
  const { docs } = await req.payload.find({
    collection: 'promo-codes',
    where: { id: { equals: id } },
    depth: 0,
    limit: 1,
    pagination: false,
    overrideAccess: true,
    select: PROMO_SELECT,
    req,
  })
  return (docs[0] as PromoDoc | undefined) ?? null
}

/** System read of a code (no `user`: anonymous visitors validate codes via the booking endpoint). */
export const findPromoByCode = async (
  req: PayloadRequest,
  rawCode: string,
): Promise<PromoDoc | null> => {
  const code = normalizePromoCode(rawCode)
  if (!isValidPromoCode(code)) return null
  const { docs } = await req.payload.find({
    collection: 'promo-codes',
    where: { code: { equals: code } },
    depth: 0,
    limit: 1,
    pagination: false,
    overrideAccess: true,
    select: PROMO_SELECT,
    req,
  })
  return (docs[0] as PromoDoc | undefined) ?? null
}

export type ValidatePromoArgs = {
  req: PayloadRequest
  code: string
  mode: 'online' | 'staff'
  lines: readonly PriceLine[]
  now: Date
  /** Empty before the client is known (online quote): the per-client limit is not checked then. */
  clientId?: string | null
  /** The appointment being edited: its own use is not counted for the client. */
  currentAppointmentId?: string
  /** The edited appointment already holds this code (see `PromoCheckInput.alreadyApplied`). */
  alreadyApplied?: boolean
  usageSource?: PromoUsageSource
}

const PROMO_ERROR_STATUS: Record<PromoErrorCode, number> = {
  PROMO_NOT_FOUND: 404,
  PROMO_EXPIRED: 400,
  PROMO_LIMIT: 409,
  PROMO_CLIENT_LIMIT: 409,
  PROMO_NOT_APPLICABLE: 400,
}

/**
 * Validates a code for the given lines. Returns the rule for `calculatePrice`;
 * throws `APIError` (`data.code` = `PROMO_*`) otherwise. Pass the transaction `req`.
 */
export const validatePromo = async (
  args: ValidatePromoArgs,
): Promise<{ promoId: string; rule: PromoRule }> => {
  const { req, mode, lines, now, clientId, usageSource = appointmentsPromoUsage } = args
  const promo = await findPromoByCode(req, args.code)

  const clientUses =
    promo && clientId && typeof promo.maxUsesPerClient === 'number'
      ? await usageSource({
          payload: req.payload,
          req,
          promoId: String(promo.id),
          clientId,
          excludeAppointmentId: args.currentAppointmentId,
        })
      : 0

  const result = checkPromo({
    promo,
    now,
    mode,
    lines,
    clientUses,
    alreadyApplied: args.alreadyApplied,
  })
  if (!result.ok) throw ruleError(req.t, result.code, PROMO_ERROR_STATUS[result.code])
  return { promoId: result.promoId, rule: result.rule }
}
