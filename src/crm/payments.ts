/**
 * Appointment payments (spec §5.8, §5.1 prepayment / refund, §5.4 p.6, decisions 17, 28, 31, 32, A34):
 * pure rules, no database. The service (`./payments.service`) loads the data, runs the ledger and
 * applies the result in one DB transaction.
 */
import type { AppointmentStatus } from './appointment-status'
import type { LedgerEntry } from './ledger'
import { isBani, sumBani } from './money'

export type PaymentErrorCode =
  | 'APPOINTMENT_NOT_PAYABLE'
  | 'PAYMENT_EXCEEDS_DUE'
  | 'PAYMENT_EMPTY'
  | 'PAYMENT_TIP_INVALID'
  | 'CERTIFICATE_INSUFFICIENT'
  | 'LEDGER_ENTRIES_INVALID'

export class PaymentError extends Error {
  constructor(readonly code: PaymentErrorCode) {
    super(code)
    this.name = 'PaymentError'
  }
}

const fail = (code: PaymentErrorCode): never => {
  throw new PaymentError(code)
}

/** Statuses in which an appointment takes payments (a prepayment included, §5.1). */
export const PAYABLE_STATUSES: readonly AppointmentStatus[] = ['scheduled', 'completed', 'paid']

/** Payment-related state of an appointment. */
export type AppointmentMoney = {
  kind?: 'appointment' | 'block' | null
  status: AppointmentStatus
  startAt: Date
  total: number
  paidAmount: number
  certificateAmount: number
  tipAmount: number
}

export type PaymentRequest = {
  entries: readonly LedgerEntry[]
  tipAmount?: number | null
  /** Explicit certificate amount; without it the certificate covers what the money does not. */
  certificateAmount?: number | null
  /** Balance of the certificate given with the payment (`null` — no certificate). */
  certificateBalance?: number | null
}

export type PaymentPlan = {
  /** Charged from the certificate. */
  certificateAmount: number
  tipAmount: number
  /** Goes to the appointment: Σentries + certificate − tip (§5.8). */
  applied: number
}

/** Still to pay for the appointment. */
export const amountDue = (money: Pick<AppointmentMoney, 'total' | 'paidAmount'>): number =>
  Math.max(0, money.total - money.paidAmount)

/**
 * Validates a payment against the appointment (§5.8): payable status, positive whole entries,
 * tips only from money, the certificate within its balance, the applied part ≤ amount due
 * (an overpayment is refused). Throws `PaymentError`.
 */
export const planPayment = (money: AppointmentMoney, request: PaymentRequest): PaymentPlan => {
  if (money.kind === 'block' || !PAYABLE_STATUSES.includes(money.status))
    fail('APPOINTMENT_NOT_PAYABLE')
  if (request.entries.some((entry) => !isBani(entry.amount) || entry.amount <= 0))
    fail('LEDGER_ENTRIES_INVALID')
  const cash = sumBani(request.entries.map((entry) => entry.amount))
  const tipAmount = request.tipAmount ?? 0
  if (!isBani(tipAmount) || tipAmount < 0 || tipAmount > cash) fail('PAYMENT_TIP_INVALID')

  const due = amountDue(money)
  const fromMoney = cash - tipAmount
  let certificateAmount = 0
  if (request.certificateBalance !== null && request.certificateBalance !== undefined) {
    const balance = request.certificateBalance
    if (balance <= 0) fail('CERTIFICATE_INSUFFICIENT')
    const explicit = request.certificateAmount
    // §5.4 p.6: by default the certificate covers min(balance, what is still due after the money).
    certificateAmount =
      explicit === null || explicit === undefined
        ? Math.max(0, Math.min(balance, due - fromMoney))
        : explicit
    if (!isBani(certificateAmount) || certificateAmount < 0) fail('CERTIFICATE_INSUFFICIENT')
    if (certificateAmount > balance) fail('CERTIFICATE_INSUFFICIENT')
  } else if (request.certificateAmount) {
    fail('CERTIFICATE_INSUFFICIENT')
  }

  const applied = fromMoney + certificateAmount
  if (applied <= 0) fail('PAYMENT_EMPTY')
  if (applied > due) fail('PAYMENT_EXCEEDS_DUE')
  return { certificateAmount, tipAmount, applied }
}

export type MoneyChange = { applied: number; certificateAmount: number; tipAmount: number }

export type AppointmentPaymentState = {
  paidAmount: number
  certificateAmount: number
  tipAmount: number
  status: AppointmentStatus
}

/**
 * Status after a payment (A34): a fully paid `completed` visit becomes `paid`; so does a `scheduled`
 * one that has already started (paying at the end of the visit completes it, §5.1). A prepayment of
 * a future visit keeps `scheduled`: completing it later gives `paid` at once.
 */
export const statusAfterPayment = (
  money: Pick<AppointmentMoney, 'status' | 'startAt' | 'total'>,
  paidAmount: number,
  now: Date,
): AppointmentStatus => {
  if (paidAmount < money.total) return money.status
  if (money.status === 'completed') return 'paid'
  if (money.status === 'scheduled' && money.startAt <= now) return 'paid'
  return money.status
}

/** Appointment totals after a payment. */
export const afterPayment = (
  money: AppointmentMoney,
  change: MoneyChange,
  now: Date,
): AppointmentPaymentState => {
  const paidAmount = money.paidAmount + change.applied
  return {
    paidAmount,
    certificateAmount: money.certificateAmount + change.certificateAmount,
    tipAmount: money.tipAmount + change.tipAmount,
    status: statusAfterPayment(money, paidAmount, now),
  }
}

/** Appointment totals after a refund of one payment (§5.8): `paid → completed` when not covered. */
export const afterRefund = (
  money: AppointmentMoney,
  change: MoneyChange,
): AppointmentPaymentState => {
  const paidAmount = Math.max(0, money.paidAmount - change.applied)
  return {
    paidAmount,
    certificateAmount: Math.max(0, money.certificateAmount - change.certificateAmount),
    tipAmount: Math.max(0, money.tipAmount - change.tipAmount),
    status: money.status === 'paid' && paidAmount < money.total ? 'completed' : money.status,
  }
}
