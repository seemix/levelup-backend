import { APIError } from 'payload'

import { crmT } from '@/i18n'

import { RULE_ERROR_KEYS } from './error-keys'

export { RULE_ERROR_KEYS }

/**
 * Business-rule error: machine `code` in `data.code` (the client translates it),
 * `message` is the already translated text for the admin UI.
 */
export const businessError = (code: string, message: string, status = 400): APIError =>
  new APIError(message, status, { code }, true)

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
