import { APIError } from 'payload'

import { crmT, type CrmKey } from '@/i18n'

/**
 * Business-rule error: machine `code` in `data.code` (the client translates it),
 * `message` is the already translated text for the admin UI.
 */
export const businessError = (code: string, message: string, status = 400): APIError =>
  new APIError(message, status, { code }, true)

/** Machine codes of business rules (spec §5.1, §5.3–§5.5, §5.9) and their admin translations. */
export const RULE_ERROR_KEYS = {
  SLOT_TAKEN: 'errors.slotTaken',
  SLOT_UNAVAILABLE: 'errors.slotUnavailable',
  SERVICE_NOT_FOUND: 'errors.serviceNotFound',
  EXTRA_NOT_FOUND: 'errors.extraNotFound',
  EXTRA_NOT_APPLICABLE: 'errors.extraNotApplicable',
  SERVICE_REQUIRED: 'errors.serviceRequired',
  CLIENT_REQUIRED: 'errors.clientRequired',
  BARBER_LOCATION_INVALID: 'errors.barberLocationInvalid',
  BLOCK_TIME_INVALID: 'errors.blockTimeInvalid',
  STATUS_TRANSITION_INVALID: 'errors.statusTransitionInvalid',
  STATUS_TOO_EARLY: 'errors.statusTooEarly',
  STATUS_FORBIDDEN: 'errors.statusForbidden',
  CANCEL_REASON_REQUIRED: 'errors.cancelReasonRequired',
  CANCEL_TOO_LATE: 'errors.cancelTooLate',
  APPOINTMENT_PAID_LOCKED: 'errors.appointmentPaidLocked',
  APPOINTMENT_FORBIDDEN: 'errors.appointmentForbidden',
  DISCOUNT_FORBIDDEN: 'errors.discountForbidden',
  PROMO_NOT_FOUND: 'errors.promoNotFound',
  PROMO_EXPIRED: 'errors.promoExpired',
  PROMO_LIMIT: 'errors.promoLimit',
  PROMO_CLIENT_LIMIT: 'errors.promoClientLimit',
  PROMO_NOT_APPLICABLE: 'errors.promoNotApplicable',
  DISCOUNT_INVALID: 'errors.discountInvalid',
  DISCOUNT_TOO_LARGE: 'errors.discountTooLarge',
  DISCOUNT_REASON_REQUIRED: 'errors.discountReasonRequired',
} as const satisfies Record<string, CrmKey>

export type RuleErrorCode = keyof typeof RULE_ERROR_KEYS

/** `businessError` for a rule code, translated with the request `t`. */
export const ruleError = (t: unknown, code: RuleErrorCode, status = 400): APIError =>
  businessError(code, crmT(t, RULE_ERROR_KEYS[code]), status)

/**
 * Converts a pure-logic rule error (`PricingError` from `src/crm/pricing.ts`, which carries `code`)
 * into a translated `APIError`; anything else is returned unchanged for rethrowing.
 */
export const toRuleError = (t: unknown, error: unknown): unknown => {
  const code = (error as { code?: unknown } | null)?.code
  return error instanceof Error && typeof code === 'string' && code in RULE_ERROR_KEYS
    ? ruleError(t, code as RuleErrorCode)
    : error
}
