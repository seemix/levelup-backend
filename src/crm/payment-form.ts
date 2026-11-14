/**
 * Pure helpers of the finance UI (spec §5.8, §5.7, A35): "register + amount" rows → ledger entries,
 * the payment summary (to pay / change) that mirrors the server rules (`planPayment`), request
 * bodies. No database and no React: unit-tested in `tests/int/payment-form.int.spec.ts`.
 */
import type { LedgerEntry } from './ledger'
import { baniToLeiText, parseLeiInput, sumBani } from './money'
import {
  amountDue,
  PaymentError,
  planPayment,
  type AppointmentMoney,
  type PaymentErrorCode,
} from './payments'

/** One row of the form: the register and the amount in lei (text of the input). */
export type CashRow = { cashRegister: string; amount: string }

export type RowsErrorCode = 'AMOUNT_INVALID' | 'REGISTER_REQUIRED' | 'REGISTER_DUPLICATE'

export const emptyRow = (cashRegister = ''): CashRow => ({ cashRegister, amount: '' })

/**
 * Rows → entries. Rows without an amount are skipped (an empty extra row is not an error); an amount
 * needs a register, a register appears once, the amount is a positive whole number of bani.
 */
export const parseRows = (
  rows: readonly CashRow[],
): { entries: LedgerEntry[]; total: number; error: RowsErrorCode | null } => {
  const entries: LedgerEntry[] = []
  let error: RowsErrorCode | null = null
  const seen = new Set<string>()
  for (const row of rows) {
    if (row.amount.trim() === '') continue
    const amount = parseLeiInput(row.amount)
    if (amount === null || amount <= 0) {
      error ??= 'AMOUNT_INVALID'
      continue
    }
    if (!row.cashRegister) {
      error ??= 'REGISTER_REQUIRED'
      continue
    }
    if (seen.has(row.cashRegister)) error ??= 'REGISTER_DUPLICATE'
    seen.add(row.cashRegister)
    entries.push({ cashRegister: row.cashRegister, amount })
  }
  return { entries, total: sumBani(entries.map((entry) => entry.amount)), error }
}

export type PaymentDraft = {
  rows: readonly CashRow[]
  /** Lei text; empty = no tip. */
  tip: string
  /** Balance of the found certificate (`null` — no certificate). */
  certificateBalance: number | null
  /** Lei text; empty = the certificate covers what the money does not (§5.4 p.6). */
  certificateAmount: string
}

export type PaymentSummary = {
  entries: LedgerEntry[]
  /** Money put into the registers (tip included). */
  cash: number
  tip: number
  certificate: number
  /** Goes to the appointment: money − tip + certificate. */
  applied: number
  due: number
  /** Still due after this payment. */
  remaining: number
  /** The part that exceeds the amount due (the server refuses an overpayment). */
  change: number
  error: RowsErrorCode | PaymentErrorCode | null
  /** May be sent. */
  ready: boolean
}

/**
 * "To pay / change" summary of the payment tab. The numbers are always computed (also for an
 * overpayment, to show the change); the error is what `planPayment` / the rows rules would say.
 */
export const summarizePayment = (money: AppointmentMoney, draft: PaymentDraft): PaymentSummary => {
  const parsed = parseRows(draft.rows)
  const due = amountDue(money)
  const tipText = draft.tip.trim()
  const tipParsed = tipText === '' ? 0 : parseLeiInput(tipText)
  const certificateText = draft.certificateAmount.trim()
  const certificateParsed = certificateText === '' ? null : parseLeiInput(certificateText)
  const tip = tipParsed ?? 0
  const fromMoney = parsed.total - tip
  const balance = draft.certificateBalance
  const certificate =
    balance === null
      ? 0
      : certificateParsed !== null
        ? certificateParsed
        : Math.max(0, Math.min(balance, due - fromMoney))
  const applied = fromMoney + certificate

  let error: PaymentSummary['error'] = parsed.error
  if (!error && (tipParsed === null || (certificateText !== '' && certificateParsed === null)))
    error = 'AMOUNT_INVALID'
  if (!error) {
    try {
      planPayment(money, {
        entries: parsed.entries,
        tipAmount: tip,
        certificateAmount: certificateParsed,
        certificateBalance: balance,
      })
    } catch (caught) {
      if (!(caught instanceof PaymentError)) throw caught
      error = caught.code
    }
  }
  return {
    entries: parsed.entries,
    cash: parsed.total,
    tip,
    certificate,
    applied,
    due,
    remaining: Math.max(0, due - applied),
    change: Math.max(0, applied - due),
    error,
    ready: error === null,
  }
}

/** Body of `POST /crm/appointments/:id/payments` for a summary that is `ready`. */
export const paymentBody = (
  summary: Pick<PaymentSummary, 'entries' | 'tip' | 'certificate'>,
  certificateCode: string | null,
  comment: string,
) => ({
  entries: summary.entries,
  ...(summary.tip > 0 ? { tip: summary.tip } : {}),
  ...(certificateCode && summary.certificate > 0
    ? { certificateCode, certificateAmount: summary.certificate }
    : {}),
  ...(comment.trim() ? { comment: comment.trim() } : {}),
})

/** First active cash register (type `cash` preferred) pre-filled with the amount due. */
export const suggestedRows = (
  registers: readonly { id: string; type: string; active: boolean }[],
  due: number,
): CashRow[] => {
  const active = registers.filter((register) => register.active)
  const first = active.find((register) => register.type === 'cash') ?? active[0]
  return [{ cashRegister: first?.id ?? '', amount: due > 0 ? baniToLeiText(due) : '' }]
}
