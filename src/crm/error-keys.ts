import type { CrmKey } from '@/i18n'

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

/** Codes of the CRM API itself (`src/endpoints/crm/http.ts`) and of client rules. */
export const API_ERROR_KEYS = {
  UNAUTHORIZED: 'errors.unauthorized',
  FORBIDDEN: 'errors.forbidden',
  NOT_FOUND: 'errors.notFound',
  VALIDATION_ERROR: 'errors.validationError',
  LOCATION_NOT_FOUND: 'errors.locationNotFound',
  BARBER_NOT_FOUND: 'errors.barberNotFound',
  PHONE_INVALID: 'errors.phoneInvalid',
  PHONE_TAKEN: 'errors.phoneTaken',
  INTERNAL_ERROR: 'errors.internalError',
  NETWORK_ERROR: 'errors.networkError',
} as const satisfies Record<string, CrmKey>

/** Translation key of a machine error code; unknown codes → `errors.unknown`. Safe for client code. */
export const errorKeyFor = (code: string | null | undefined): CrmKey => {
  const all: Record<string, CrmKey> = { ...RULE_ERROR_KEYS, ...API_ERROR_KEYS }
  return (code && all[code]) || 'errors.unknown'
}
