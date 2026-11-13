// @vitest-environment node
import { describe, expect, it } from 'vitest'

import {
  balanceDeltas,
  computeBalances,
  LedgerError,
  mirrorEntries,
  paymentAppliedAmount,
  undoTypeFor,
  validateTransaction,
  type LedgerEntry,
  type ReversalTarget,
  type TransactionInput,
} from '@/crm/ledger'

const A = 'register-a'
const B = 'register-b'

const codeOf = (input: TransactionInput, target?: ReversalTarget): string | null => {
  try {
    validateTransaction(input, target)
    return null
  } catch (error) {
    if (error instanceof LedgerError) return error.code
    throw error
  }
}

const entry = (cashRegister: string, amount: number): LedgerEntry => ({ cashRegister, amount })

describe('ledger invariants (§4.15)', () => {
  describe('common', () => {
    it('rejects zero, fractional and missing-register entries', () => {
      for (const entries of [
        [entry(A, 0)],
        [entry(A, -10.5)],
        [entry('', -100)],
        [entry(A, Number.NaN)],
      ])
        expect(codeOf({ type: 'adjustment', entries, comment: 'x' })).toBe('LEDGER_ENTRIES_INVALID')
    })

    it('one entry per register', () => {
      expect(
        codeOf({ type: 'adjustment', entries: [entry(A, 100), entry(A, 200)], comment: 'x' }),
      ).toBe('LEDGER_SAME_REGISTER')
    })

    it('links of other types are not allowed', () => {
      const base = { entries: [entry(A, -100)], expenseCategory: 'c' }
      expect(codeOf({ type: 'expense', ...base, reverses: 't' })).toBe('REVERSAL_TARGET_INVALID')
      expect(codeOf({ type: 'expense', ...base, appointment: 'a' })).toBe('LEDGER_AMOUNT_INVALID')
      expect(codeOf({ type: 'expense', ...base, tipAmount: 100 })).toBe('LEDGER_AMOUNT_INVALID')
      expect(
        codeOf({ type: 'transfer', entries: [entry(A, -1), entry(B, 1)], expenseCategory: 'c' }),
      ).toBe('EXPENSE_CATEGORY_NOT_ALLOWED')
    })
  })

  describe('expense', () => {
    it('exactly one negative entry and a category', () => {
      expect(
        codeOf({ type: 'expense', entries: [entry(A, -500)], expenseCategory: 'c' }),
      ).toBeNull()
      expect(codeOf({ type: 'expense', entries: [entry(A, 500)], expenseCategory: 'c' })).toBe(
        'LEDGER_ENTRIES_INVALID',
      )
      expect(
        codeOf({
          type: 'expense',
          entries: [entry(A, -500), entry(B, -100)],
          expenseCategory: 'c',
        }),
      ).toBe('LEDGER_ENTRIES_INVALID')
      expect(codeOf({ type: 'expense', entries: [], expenseCategory: 'c' })).toBe(
        'LEDGER_ENTRIES_INVALID',
      )
      expect(codeOf({ type: 'expense', entries: [entry(A, -500)] })).toBe(
        'EXPENSE_CATEGORY_REQUIRED',
      )
    })
  })

  describe('transfer', () => {
    it('two different registers with a zero sum', () => {
      expect(codeOf({ type: 'transfer', entries: [entry(A, -700), entry(B, 700)] })).toBeNull()
      expect(codeOf({ type: 'transfer', entries: [entry(A, -700), entry(B, 600)] })).toBe(
        'LEDGER_SUM_INVALID',
      )
      expect(codeOf({ type: 'transfer', entries: [entry(A, -700), entry(A, 700)] })).toBe(
        'LEDGER_SAME_REGISTER',
      )
      expect(codeOf({ type: 'transfer', entries: [entry(A, -700)] })).toBe('LEDGER_ENTRIES_INVALID')
      expect(
        codeOf({ type: 'transfer', entries: [entry(A, -700), entry(B, 400), entry('c', 300)] }),
      ).toBe('LEDGER_ENTRIES_INVALID')
    })
  })

  describe('adjustment', () => {
    it('any non-zero entries with a comment', () => {
      expect(
        codeOf({ type: 'adjustment', entries: [entry(A, 1000), entry(B, -5)], comment: 'Start' }),
      ).toBeNull()
      expect(codeOf({ type: 'adjustment', entries: [entry(A, 1000)], comment: '  ' })).toBe(
        'COMMENT_REQUIRED',
      )
      expect(codeOf({ type: 'adjustment', entries: [], comment: 'x' })).toBe(
        'LEDGER_ENTRIES_INVALID',
      )
    })
  })

  describe('appointment_payment', () => {
    const payment = (patch: Partial<TransactionInput> = {}): TransactionInput => ({
      type: 'appointment_payment',
      appointment: 'ap',
      entries: [entry(A, 20_000), entry(B, 10_000)],
      ...patch,
    })

    it('positive entries; Σentries + certificate = applied + tip', () => {
      expect(codeOf(payment())).toBeNull()
      expect(paymentAppliedAmount(payment({ certificateAmount: 5_000, tipAmount: 3_000 }))).toBe(
        32_000,
      )
      expect(codeOf(payment({ entries: [entry(A, -100)] }))).toBe('LEDGER_ENTRIES_INVALID')
      expect(codeOf(payment({ appointment: null }))).toBe('APPOINTMENT_REQUIRED')
      expect(codeOf(payment({ tipAmount: -1 }))).toBe('LEDGER_AMOUNT_INVALID')
      // The whole amount as a tip leaves nothing for the appointment.
      expect(codeOf(payment({ tipAmount: 30_000 }))).toBe('LEDGER_SUM_INVALID')
    })

    it('may be paid by a certificate only', () => {
      expect(
        codeOf(payment({ entries: [], certificateAmount: 15_000, certificate: 'gc' })),
      ).toBeNull()
      expect(codeOf(payment({ entries: [] }))).toBe('LEDGER_ENTRIES_INVALID')
    })

    it('certificate amount and certificate go together; tips only from money', () => {
      expect(codeOf(payment({ certificateAmount: 5_000 }))).toBe('CERTIFICATE_REQUIRED')
      expect(codeOf(payment({ certificate: 'gc' }))).toBe('CERTIFICATE_REQUIRED')
      expect(
        codeOf(
          payment({ entries: [], certificateAmount: 15_000, certificate: 'gc', tipAmount: 1 }),
        ),
      ).toBe('PAYMENT_TIP_INVALID')
      // A certificate link is not allowed on other types.
      expect(
        codeOf({
          type: 'adjustment',
          entries: [entry(A, 1)],
          comment: 'x',
          certificate: 'gc',
        }),
      ).toBe('LEDGER_AMOUNT_INVALID')
    })
  })

  describe('certificate_sale', () => {
    it('positive entries summing to the nominal', () => {
      const sale = (entries: LedgerEntry[], nominal: number | null = 50_000): TransactionInput => ({
        type: 'certificate_sale',
        entries,
        nominal,
        certificate: 'gc',
      })
      expect(codeOf(sale([entry(A, 30_000), entry(B, 20_000)]))).toBeNull()
      expect(codeOf(sale([entry(A, 30_000)]))).toBe('LEDGER_SUM_INVALID')
      expect(codeOf(sale([entry(A, 50_000)], null))).toBe('LEDGER_SUM_INVALID')
      expect(codeOf(sale([entry(A, 60_000), entry(B, -10_000)]))).toBe('LEDGER_ENTRIES_INVALID')
      expect(
        codeOf({ type: 'certificate_sale', entries: [entry(A, 50_000)], nominal: 50_000 }),
      ).toBe('CERTIFICATE_REQUIRED')
    })
  })

  describe('reversal / refund', () => {
    const expense: ReversalTarget = { type: 'expense', entries: [entry(A, -500)] }

    it('mirrors the original', () => {
      expect(mirrorEntries([entry(A, -500), entry(B, 300)])).toEqual([
        entry(A, 500),
        entry(B, -300),
      ])
      expect(
        codeOf(
          { type: 'reversal', reverses: 't', entries: mirrorEntries(expense.entries) },
          expense,
        ),
      ).toBeNull()
      expect(codeOf({ type: 'reversal', reverses: 't', entries: [entry(A, 400)] }, expense)).toBe(
        'LEDGER_ENTRIES_INVALID',
      )
    })

    it('needs a reversible target of the matching type, once', () => {
      const entries = mirrorEntries(expense.entries)
      expect(codeOf({ type: 'reversal', entries }, expense)).toBe('REVERSAL_TARGET_INVALID')
      expect(codeOf({ type: 'reversal', reverses: 't', entries })).toBe('REVERSAL_TARGET_INVALID')
      expect(codeOf({ type: 'refund', reverses: 't', entries }, expense)).toBe(
        'REVERSAL_TARGET_INVALID',
      )
      expect(
        codeOf({ type: 'reversal', reverses: 't', entries }, { ...expense, reversed: true }),
      ).toBe('ALREADY_REVERSED')
    })

    it('undo types by original type', () => {
      expect(undoTypeFor('expense')).toBe('reversal')
      expect(undoTypeFor('transfer')).toBe('reversal')
      expect(undoTypeFor('adjustment')).toBe('reversal')
      expect(undoTypeFor('appointment_payment')).toBe('refund')
      expect(undoTypeFor('certificate_sale')).toBeNull()
      expect(undoTypeFor('reversal')).toBeNull()
      expect(undoTypeFor('refund')).toBeNull()
    })
  })

  describe('balances', () => {
    it('deltas and from-scratch balances', () => {
      expect([...balanceDeltas([entry(A, -700), entry(B, 700)])]).toEqual([
        [A, -700],
        [B, 700],
      ])
      const balances = computeBalances([
        { entries: [entry(A, 10_000)] },
        { entries: [entry(A, -700), entry(B, 700)] },
        { entries: [entry(B, -1_000)] },
      ])
      expect(Object.fromEntries(balances)).toEqual({ [A]: 9_300, [B]: -300 })
    })
  })
})
