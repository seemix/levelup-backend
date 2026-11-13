/**
 * Ledger rules (spec §4.13–§4.15, §5.6, decisions 32–34, A8): pure functions, no database.
 * Amounts are integer bani with a sign: + money comes into the register, − money leaves it.
 */
import { isBani, sumBani } from './money'

export const TRANSACTION_TYPES = [
  'appointment_payment',
  'certificate_sale',
  'expense',
  'transfer',
  'refund',
  'reversal',
  'adjustment',
] as const
export type TransactionType = (typeof TRANSACTION_TYPES)[number]

export const CASH_REGISTER_TYPES = ['cash', 'account'] as const
export type CashRegisterType = (typeof CASH_REGISTER_TYPES)[number]

/**
 * Types created only by the payment / certificate services, which also update the
 * appointment or the certificate in the same transaction; a direct create is refused.
 */
export const SERVICE_ONLY_TYPES: readonly TransactionType[] = [
  'appointment_payment',
  'certificate_sale',
  'refund',
]

/** Types that may reference a gift certificate. */
export const CERTIFICATE_TYPES: readonly TransactionType[] = [
  'certificate_sale',
  'appointment_payment',
  'refund',
]

/** Operations that undo another one (`reverses`). */
export const UNDO_TYPES: readonly TransactionType[] = ['refund', 'reversal']

export type LedgerEntry = { cashRegister: string; amount: number }

export type LedgerErrorCode =
  | 'LEDGER_ENTRIES_INVALID'
  | 'LEDGER_SUM_INVALID'
  | 'LEDGER_SAME_REGISTER'
  | 'LEDGER_AMOUNT_INVALID'
  | 'EXPENSE_CATEGORY_REQUIRED'
  | 'EXPENSE_CATEGORY_NOT_ALLOWED'
  | 'COMMENT_REQUIRED'
  | 'APPOINTMENT_REQUIRED'
  | 'REVERSAL_TARGET_INVALID'
  | 'ALREADY_REVERSED'
  | 'CERTIFICATE_REQUIRED'
  | 'PAYMENT_TIP_INVALID'

/** A rule violation; the adapter turns it into a translated `APIError` (`toRuleError`). */
export class LedgerError extends Error {
  constructor(readonly code: LedgerErrorCode) {
    super(code)
    this.name = 'LedgerError'
  }
}

const fail = (code: LedgerErrorCode): never => {
  throw new LedgerError(code)
}

export type TransactionInput = {
  type: TransactionType
  entries: readonly LedgerEntry[]
  comment?: string | null
  expenseCategory?: string | null
  appointment?: string | null
  certificateAmount?: number | null
  tipAmount?: number | null
  reverses?: string | null
  /** Gift certificate: sold (`certificate_sale`) or used / returned (`appointment_payment`, `refund`). */
  certificate?: string | null
  /** `certificate_sale`: nominal of the sold certificate. */
  nominal?: number | null
}

/** The operation being undone by a `refund` / `reversal`. */
export type ReversalTarget = {
  type: TransactionType
  entries: readonly LedgerEntry[]
  reversed?: boolean | null
}

/** Which undo type applies to an operation; `null` — it cannot be undone this way. */
export const undoTypeFor = (type: TransactionType): TransactionType | null => {
  switch (type) {
    case 'appointment_payment':
      return 'refund'
    case 'expense':
    case 'transfer':
    case 'adjustment':
      return 'reversal'
    // Certificate sale: not undone (A34; void the certificate instead). Undo of an undo: never.
    default:
      return null
  }
}

/** Mirror entries of the undone operation (§4.15: refund / reversal). */
export const mirrorEntries = (entries: readonly LedgerEntry[]): LedgerEntry[] =>
  entries.map(({ cashRegister, amount }) => ({ cashRegister, amount: -amount }))

const isZeroOrMore = (value: number | null | undefined) =>
  value === null || value === undefined || (isBani(value) && value >= 0)

const amountOf = (value: number | null | undefined) => value ?? 0

const sameEntries = (a: readonly LedgerEntry[], b: readonly LedgerEntry[]) =>
  a.length === b.length &&
  a.every((entry, i) => entry.cashRegister === b[i].cashRegister && entry.amount === b[i].amount)

/**
 * Checks the invariants of an operation by type (§4.15). Throws `LedgerError`.
 * `target` is required for `refund` / `reversal` (the undone operation).
 */
export const validateTransaction = (input: TransactionInput, target?: ReversalTarget): void => {
  const { type, entries } = input
  if (!(TRANSACTION_TYPES as readonly string[]).includes(type)) fail('LEDGER_ENTRIES_INVALID')

  // Common: every entry is a register + a non-zero whole amount, one entry per register.
  for (const entry of entries)
    if (!entry.cashRegister || !isBani(entry.amount) || entry.amount === 0)
      fail('LEDGER_ENTRIES_INVALID')
  if (new Set(entries.map((entry) => entry.cashRegister)).size !== entries.length)
    fail('LEDGER_SAME_REGISTER')
  if (!isZeroOrMore(input.certificateAmount) || !isZeroOrMore(input.tipAmount))
    fail('LEDGER_AMOUNT_INVALID')

  // Type-specific links are not allowed elsewhere.
  if (type !== 'expense' && input.expenseCategory) fail('EXPENSE_CATEGORY_NOT_ALLOWED')
  if (!UNDO_TYPES.includes(type) && input.reverses) fail('REVERSAL_TARGET_INVALID')
  if (
    type !== 'appointment_payment' &&
    type !== 'refund' &&
    (input.appointment || amountOf(input.certificateAmount) > 0 || amountOf(input.tipAmount) > 0)
  )
    fail('LEDGER_AMOUNT_INVALID')
  if (input.certificate && !CERTIFICATE_TYPES.includes(type)) fail('LEDGER_AMOUNT_INVALID')

  const total = sumBani(entries.map((entry) => entry.amount))
  switch (type) {
    case 'appointment_payment': {
      if (!input.appointment) fail('APPOINTMENT_REQUIRED')
      if (entries.some((entry) => entry.amount <= 0)) fail('LEDGER_ENTRIES_INVALID')
      const certificate = amountOf(input.certificateAmount)
      // A payment moves money (entries) and/or certificate value.
      if (entries.length === 0 && certificate === 0) fail('LEDGER_ENTRIES_INVALID')
      // Certificate value and the certificate itself go together.
      if (certificate > 0 !== Boolean(input.certificate)) fail('CERTIFICATE_REQUIRED')
      // Tips are money left in the registers: a certificate covers the appointment only (§5.4 p.6).
      if (amountOf(input.tipAmount) > total) fail('PAYMENT_TIP_INVALID')
      // Σentries + certificate = applied to the appointment + tip, the applied part is > 0.
      if (paymentAppliedAmount(input) <= 0) fail('LEDGER_SUM_INVALID')
      return
    }
    case 'certificate_sale':
      if (entries.length === 0 || entries.some((entry) => entry.amount <= 0))
        fail('LEDGER_ENTRIES_INVALID')
      if (!isBani(input.nominal) || input.nominal <= 0 || total !== input.nominal)
        fail('LEDGER_SUM_INVALID')
      if (!input.certificate) fail('CERTIFICATE_REQUIRED')
      return
    case 'expense':
      if (entries.length !== 1 || entries[0].amount >= 0) fail('LEDGER_ENTRIES_INVALID')
      if (!input.expenseCategory) fail('EXPENSE_CATEGORY_REQUIRED')
      return
    case 'transfer':
      if (entries.length !== 2) fail('LEDGER_ENTRIES_INVALID')
      if (total !== 0) fail('LEDGER_SUM_INVALID')
      return
    case 'adjustment':
      if (entries.length === 0) fail('LEDGER_ENTRIES_INVALID')
      if (!input.comment?.trim()) fail('COMMENT_REQUIRED')
      return
    case 'refund':
    case 'reversal':
      if (!input.reverses || !target || undoTypeFor(target.type) !== type)
        fail('REVERSAL_TARGET_INVALID')
      if (target?.reversed) fail('ALREADY_REVERSED')
      if (!sameEntries(entries, mirrorEntries(target?.entries ?? [])))
        fail('LEDGER_ENTRIES_INVALID')
      return
  }
}

/**
 * Part of an `appointment_payment` that goes to the appointment:
 * Σentries + certificateAmount − tipAmount (§5.8).
 */
export const paymentAppliedAmount = (
  input: Pick<TransactionInput, 'entries' | 'certificateAmount' | 'tipAmount'>,
): number =>
  sumBani(input.entries.map((entry) => entry.amount)) +
  amountOf(input.certificateAmount) -
  amountOf(input.tipAmount)

/** Balance change of each register caused by one operation. */
export const balanceDeltas = (entries: readonly LedgerEntry[]): Map<string, number> => {
  const deltas = new Map<string, number>()
  for (const { cashRegister, amount } of entries)
    deltas.set(cashRegister, (deltas.get(cashRegister) ?? 0) + amount)
  return deltas
}

/** Balances from scratch: Σ of all entries per register (what `crm:recalc-balances` computes). */
export const computeBalances = (
  transactions: readonly { entries: readonly LedgerEntry[] }[],
): Map<string, number> => {
  const balances = new Map<string, number>()
  for (const transaction of transactions)
    for (const [register, delta] of balanceDeltas(transaction.entries))
      balances.set(register, (balances.get(register) ?? 0) + delta)
  return balances
}
