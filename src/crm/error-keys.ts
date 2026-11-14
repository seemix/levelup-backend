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
  // Ledger (§4.15, §5.6): `src/crm/ledger.ts`, `src/crm/ledger.service.ts`.
  LEDGER_ENTRIES_INVALID: 'errors.ledgerEntriesInvalid',
  LEDGER_SUM_INVALID: 'errors.ledgerSumInvalid',
  LEDGER_SAME_REGISTER: 'errors.ledgerSameRegister',
  LEDGER_AMOUNT_INVALID: 'errors.ledgerAmountInvalid',
  LEDGER_CONFLICT: 'errors.ledgerConflict',
  EXPENSE_CATEGORY_REQUIRED: 'errors.expenseCategoryRequired',
  EXPENSE_CATEGORY_NOT_ALLOWED: 'errors.expenseCategoryNotAllowed',
  EXPENSE_CATEGORY_INVALID: 'errors.expenseCategoryInvalid',
  EXPENSE_CATEGORY_IN_USE: 'errors.expenseCategoryInUse',
  COMMENT_REQUIRED: 'errors.commentRequired',
  APPOINTMENT_REQUIRED: 'errors.appointmentRequired',
  REVERSAL_TARGET_INVALID: 'errors.reversalTargetInvalid',
  ALREADY_REVERSED: 'errors.alreadyReversed',
  CASH_REGISTER_INVALID: 'errors.cashRegisterInvalid',
  TRANSACTION_FORBIDDEN: 'errors.transactionForbidden',
  TRANSACTION_TYPE_UNSUPPORTED: 'errors.transactionTypeUnsupported',
  // Gift certificates and payments (§4.17, §5.7, §5.8): `src/crm/certificates*.ts`, `src/crm/payments*.ts`.
  CERTIFICATE_NOT_FOUND: 'errors.certificateNotFound',
  CERTIFICATE_EXPIRED: 'errors.certificateExpired',
  CERTIFICATE_VOID: 'errors.certificateVoid',
  CERTIFICATE_INSUFFICIENT: 'errors.certificateInsufficient',
  CERTIFICATE_REQUIRED: 'errors.certificateRequired',
  CERTIFICATE_SALE_ONLY: 'errors.certificateSaleOnly',
  CERTIFICATE_EXPIRY_INVALID: 'errors.certificateExpiryInvalid',
  CERTIFICATE_NOMINAL_INVALID: 'errors.certificateNominalInvalid',
  APPOINTMENT_NOT_FOUND: 'errors.appointmentNotFound',
  APPOINTMENT_NOT_PAYABLE: 'errors.appointmentNotPayable',
  PAYMENT_EXCEEDS_DUE: 'errors.paymentExceedsDue',
  PAYMENT_EMPTY: 'errors.paymentEmpty',
  PAYMENT_TIP_INVALID: 'errors.paymentTipInvalid',
  // Schedule roster (A44): `src/crm/schedule.ts`, `src/crm/schedule-edit.service.ts`.
  TIME_INVALID: 'errors.timeInvalid',
  END_BEFORE_START: 'errors.endBeforeStart',
  BREAK_INVALID: 'errors.breakInvalid',
  BREAK_OUTSIDE: 'errors.breakOutside',
  BREAKS_OVERLAP: 'errors.breaksOverlap',
  LOCATION_NOT_ALLOWED: 'errors.locationNotAllowed',
  SCHEDULE_CONFLICT: 'errors.scheduleConflict',
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
