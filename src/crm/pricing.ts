/**
 * Price calculation (spec §5.4). Pure functions: no database access.
 * All amounts are integer bani; percentages are rounded half-up to a whole ban (`src/crm/money.ts`).
 */
import { assertBani, percentOf, sumBani } from './money'

export type CatalogItem = { id: string; price: number; durationMinutes: number }

/** A `barber-prices` row reduced to what pricing needs; empty fields mean "use the base value" (§4.9). */
export type PriceOverride = {
  itemType: 'services' | 'extras'
  itemId: string
  price?: number | null
  durationMinutes?: number | null
}

/** Snapshot line stored in `appointments.lines` (§4.11). */
export type PriceLine = {
  itemType: 'service' | 'extra'
  item: string
  price: number
  durationMinutes: number
}

/** The part of a promo code that affects the price (§4.16). Both lists empty = applies to everything. */
export type PromoRule = {
  discountType: 'percent' | 'fixed'
  /** Percent 1–100 (whole) or an amount in bani ≥ 1. */
  value: number
  appliesToServices: readonly string[]
  appliesToExtras: readonly string[]
}

/** Manual discount by admin/manager (decision 30; the role check belongs to the caller). */
export type ManualDiscountInput = {
  type: 'amount' | 'percent'
  /** Bani for `amount`, 0–100 for `percent`. */
  value: number
  reason?: string | null
}

export type PriceInput = {
  service: CatalogItem
  extras?: readonly CatalogItem[]
  overrides?: readonly PriceOverride[]
  /** An already validated promo code (`validatePromo`), or none. */
  promo?: PromoRule | null
  manualDiscount?: ManualDiscountInput | null
}

export type PriceResult = {
  lines: PriceLine[]
  durationMinutes: number
  subtotal: number
  /** Σ prices of the lines the promo code applies to (0 without a promo). */
  promoBase: number
  promoDiscount: number
  manualDiscount: number
  /** Trimmed reason; `null` when there is no manual discount. */
  manualDiscountReason: string | null
  total: number
}

export const PRICING_ERROR_CODES = [
  'DISCOUNT_INVALID',
  'DISCOUNT_TOO_LARGE',
  'DISCOUNT_REASON_REQUIRED',
] as const
export type PricingErrorCode = (typeof PRICING_ERROR_CODES)[number]

/** Business-rule violation of the manual discount; the adapter turns it into an `APIError`. */
export class PricingError extends Error {
  constructor(readonly code: PricingErrorCode) {
    super(code)
    this.name = 'PricingError'
  }
}

const assertNonNegativeBani = (value: number, name: string): number => {
  assertBani(value, name)
  if (value < 0) throw new RangeError(`${name} must not be negative, got ${value}`)
  return value
}

// ---------------------------------------------------------------------------
// Lines (§5.4 p.1)
// ---------------------------------------------------------------------------

/** Service + extras with `barber-prices` applied, in that order. */
export const buildLines = (
  service: CatalogItem,
  extras: readonly CatalogItem[],
  overrides: readonly PriceOverride[],
): PriceLine[] => {
  const line = (itemType: PriceLine['itemType'], item: CatalogItem): PriceLine => {
    const relation = itemType === 'service' ? 'services' : 'extras'
    const override = overrides.find((o) => o.itemType === relation && o.itemId === item.id)
    const price = typeof override?.price === 'number' ? override.price : item.price
    const durationMinutes =
      typeof override?.durationMinutes === 'number'
        ? override.durationMinutes
        : item.durationMinutes
    return {
      itemType,
      item: item.id,
      price: assertNonNegativeBani(price, `price of ${item.id}`),
      durationMinutes,
    }
  }
  return [line('service', service), ...extras.map((extra) => line('extra', extra))]
}

// ---------------------------------------------------------------------------
// Promo code (§5.4 p.3)
// ---------------------------------------------------------------------------

const assertPromoRule = (rule: PromoRule): void => {
  const { discountType, value } = rule
  const valid =
    Number.isSafeInteger(value) &&
    (discountType === 'percent'
      ? value >= 1 && value <= 100
      : discountType === 'fixed' && value >= 1)
  if (!valid) throw new RangeError(`Invalid promo rule: ${discountType} ${value}`)
}

/** Lines the promo applies to: listed services/extras, or every line when both lists are empty. */
export const promoApplicableLines = (lines: readonly PriceLine[], rule: PromoRule): PriceLine[] => {
  const services = new Set(rule.appliesToServices)
  const extras = new Set(rule.appliesToExtras)
  if (services.size === 0 && extras.size === 0) return [...lines]
  return lines.filter((line) =>
    line.itemType === 'service' ? services.has(line.item) : extras.has(line.item),
  )
}

/** `percent` → round(base × value / 100), `fixed` → min(value, base). */
export const promoDiscountFor = (base: number, rule: PromoRule): number => {
  assertPromoRule(rule)
  return rule.discountType === 'percent' ? percentOf(base, rule.value) : Math.min(rule.value, base)
}

// ---------------------------------------------------------------------------
// Manual discount (§5.4 p.4)
// ---------------------------------------------------------------------------

/** Discount amount from `base` (= subtotal − promoDiscount); throws `PricingError` on a rule violation. */
export const manualDiscountFor = (
  base: number,
  input: ManualDiscountInput,
): { amount: number; reason: string | null } => {
  const { type, value } = input
  const validValue =
    type === 'amount'
      ? Number.isSafeInteger(value) && value >= 0
      : Number.isFinite(value) && value >= 0 && value <= 100
  if (!validValue) throw new PricingError('DISCOUNT_INVALID')
  const amount = type === 'amount' ? value : percentOf(base, value)
  if (amount > base) throw new PricingError('DISCOUNT_TOO_LARGE')
  if (amount === 0) return { amount: 0, reason: null }
  const reason = input.reason?.trim() ?? ''
  if (!reason) throw new PricingError('DISCOUNT_REASON_REQUIRED')
  return { amount, reason }
}

// ---------------------------------------------------------------------------
// Total (§5.4 p.2–5)
// ---------------------------------------------------------------------------

export const calculatePrice = (input: PriceInput): PriceResult => {
  const lines = buildLines(input.service, input.extras ?? [], input.overrides ?? [])
  const subtotal = sumBani(lines.map((line) => line.price))
  const durationMinutes = lines.reduce((sum, line) => sum + line.durationMinutes, 0)

  const promoBase = input.promo
    ? sumBani(promoApplicableLines(lines, input.promo).map((line) => line.price))
    : 0
  const promoDiscount = input.promo ? promoDiscountFor(promoBase, input.promo) : 0

  const manual = input.manualDiscount
    ? manualDiscountFor(subtotal - promoDiscount, input.manualDiscount)
    : { amount: 0, reason: null }

  return {
    lines,
    durationMinutes,
    subtotal,
    promoBase,
    promoDiscount,
    manualDiscount: manual.amount,
    manualDiscountReason: manual.reason,
    total: subtotal - promoDiscount - manual.amount,
  }
}

// ---------------------------------------------------------------------------
// Gift certificate (§5.4 p.6, decision 28)
// ---------------------------------------------------------------------------

/**
 * A certificate is a payment method, not a discount: `total` stays the same, the certificate
 * covers `min(balance, total − paidAmount)` and the rest is to be paid.
 */
export const certificateCoverage = (args: {
  total: number
  paidAmount?: number
  balance: number
}): { covered: number; toPay: number } => {
  const total = assertNonNegativeBani(args.total, 'total')
  const paid = assertNonNegativeBani(args.paidAmount ?? 0, 'paidAmount')
  const balance = assertNonNegativeBani(args.balance, 'balance')
  const due = Math.max(0, total - paid)
  const covered = Math.min(balance, due)
  return { covered, toPay: due - covered }
}
