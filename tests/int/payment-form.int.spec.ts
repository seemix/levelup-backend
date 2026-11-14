import { describe, expect, it } from 'vitest'

import { normalizeCertificateCode } from '@/crm/certificate-code'
import {
  canOfferRefund,
  canOfferReversal,
  emptyFilters,
  operationAmount,
  operationsQuery,
} from '@/crm/finance'
import {
  paymentBody,
  parseRows,
  suggestedRows,
  summarizePayment,
  type PaymentDraft,
} from '@/crm/payment-form'
import type { AppointmentMoney } from '@/crm/payments'

const money = (patch: Partial<AppointmentMoney> = {}): AppointmentMoney => ({
  kind: 'appointment',
  status: 'completed',
  startAt: new Date('2026-11-10T08:00:00Z'),
  total: 10000,
  paidAmount: 0,
  certificateAmount: 0,
  ...patch,
})

const draft = (patch: Partial<PaymentDraft> = {}): PaymentDraft => ({
  rows: [{ cashRegister: 'cash', amount: '' }],
  certificateBalance: null,
  certificateAmount: '',
  ...patch,
})

describe('parseRows', () => {
  it('skips blank rows and converts lei to bani', () => {
    const result = parseRows([
      { cashRegister: 'a', amount: '12,5' },
      { cashRegister: 'b', amount: '' },
    ])
    expect(result).toEqual({
      entries: [{ cashRegister: 'a', amount: 1250 }],
      total: 1250,
      error: null,
    })
  })

  it('reports invalid amount, missing and repeated register', () => {
    expect(parseRows([{ cashRegister: 'a', amount: '1.234' }]).error).toBe('AMOUNT_INVALID')
    expect(parseRows([{ cashRegister: 'a', amount: '0' }]).error).toBe('AMOUNT_INVALID')
    expect(parseRows([{ cashRegister: '', amount: '5' }]).error).toBe('REGISTER_REQUIRED')
    expect(
      parseRows([
        { cashRegister: 'a', amount: '5' },
        { cashRegister: 'a', amount: '6' },
      ]).error,
    ).toBe('REGISTER_DUPLICATE')
  })
})

describe('summarizePayment', () => {
  it('an empty form is not ready and nothing is paid', () => {
    const summary = summarizePayment(money(), draft())
    expect(summary).toMatchObject({ ready: false, error: 'PAYMENT_EMPTY', remaining: 10000 })
  })

  it('a partial payment leaves the rest', () => {
    const summary = summarizePayment(
      money(),
      draft({ rows: [{ cashRegister: 'cash', amount: '40' }] }),
    )
    expect(summary).toMatchObject({ ready: true, applied: 4000, remaining: 6000, change: 0 })
  })

  it('an overpayment shows the change and is not ready', () => {
    const summary = summarizePayment(
      money({ paidAmount: 2000 }),
      draft({ rows: [{ cashRegister: 'cash', amount: '100' }] }),
    )
    expect(summary).toMatchObject({
      ready: false,
      error: 'PAYMENT_EXCEEDS_DUE',
      change: 2000,
      remaining: 0,
    })
  })

  it('all the money goes to the appointment (no tips, A45): the excess is an overpayment', () => {
    const summary = summarizePayment(
      money(),
      draft({ rows: [{ cashRegister: 'cash', amount: '110' }] }),
    )
    expect(summary).toMatchObject({
      ready: false,
      applied: 11000,
      change: 1000,
      error: 'PAYMENT_EXCEEDS_DUE',
    })
    expect(summary).not.toHaveProperty('tip')
  })

  it('a certificate covers what the money does not', () => {
    const summary = summarizePayment(
      money(),
      draft({ rows: [{ cashRegister: 'cash', amount: '30' }], certificateBalance: 50000 }),
    )
    expect(summary).toMatchObject({ ready: true, certificate: 7000, applied: 10000, remaining: 0 })
  })

  it('a certificate alone pays the visit, a depleted one is refused', () => {
    expect(summarizePayment(money(), draft({ certificateBalance: 6000 }))).toMatchObject({
      ready: true,
      certificate: 6000,
      remaining: 4000,
    })
    expect(summarizePayment(money(), draft({ certificateBalance: 0 })).ready).toBe(false)
  })

  it('an explicit certificate amount above the balance is refused', () => {
    const summary = summarizePayment(
      money(),
      draft({ certificateBalance: 3000, certificateAmount: '50' }),
    )
    expect(summary.error).toBe('CERTIFICATE_INSUFFICIENT')
  })

  it('a block or a cancelled visit is not payable', () => {
    expect(
      summarizePayment(
        money({ status: 'cancelled_by_salon' }),
        draft({ rows: [{ cashRegister: 'cash', amount: '10' }] }),
      ).error,
    ).toBe('APPOINTMENT_NOT_PAYABLE')
  })

  it('builds the request body', () => {
    const summary = summarizePayment(
      money(),
      draft({
        rows: [{ cashRegister: 'cash', amount: '35' }],
        certificateBalance: 50000,
      }),
    )
    expect(paymentBody(summary, 'LU-ABCD-EFGH', ' thanks ')).toEqual({
      entries: [{ cashRegister: 'cash', amount: 3500 }],
      certificateCode: 'LU-ABCD-EFGH',
      certificateAmount: 6500,
      comment: 'thanks',
    })
  })
})

describe('suggestedRows', () => {
  it('prefers an active cash register and fills the amount due', () => {
    const rows = suggestedRows(
      [
        { id: 'card', type: 'account', active: true },
        { id: 'old', type: 'cash', active: false },
        { id: 'cash', type: 'cash', active: true },
      ],
      12050,
    )
    expect(rows).toEqual([{ cashRegister: 'cash', amount: '120.50' }])
  })
})

describe('finance helpers', () => {
  it('builds the operations query in local days', () => {
    const params = operationsQuery(
      {
        ...emptyFilters(),
        from: '2026-11-01',
        to: '2026-11-02',
        type: 'expense',
        cashRegister: 'c1',
      },
      { page: 2, locale: 'ro' },
    )
    expect(params.get('page')).toBe('2')
    expect(params.get('locale')).toBe('ro')
    expect(params.get('where[and][0][occurredAt][greater_than_equal]')).toBe(
      '2026-10-31T22:00:00.000Z',
    )
    expect(params.get('where[and][1][occurredAt][less_than]')).toBe('2026-11-02T22:00:00.000Z')
    expect(params.get('where[and][2][type][equals]')).toBe('expense')
    expect(params.get('where[and][3][entries.cashRegister][equals]')).toBe('c1')
  })

  it('shows the net amount, a transfer — the moved sum', () => {
    expect(operationAmount([{ cashRegister: 'a', amount: -4500 }])).toBe(-4500)
    expect(
      operationAmount([
        { cashRegister: 'a', amount: -3000 },
        { cashRegister: 'b', amount: 3000 },
      ]),
    ).toBe(3000)
  })

  const now = new Date('2026-11-14T10:00:00Z')
  it('offers a reversal by role, type, day and state', () => {
    const base = { occurredAt: '2026-11-14T06:00:00Z', isAdmin: false, isManager: true, now }
    expect(canOfferReversal({ ...base, type: 'expense' })).toBe(true)
    expect(canOfferReversal({ ...base, type: 'expense', occurredAt: '2026-11-13T06:00:00Z' })).toBe(
      false,
    )
    expect(canOfferReversal({ ...base, type: 'adjustment' })).toBe(false)
    expect(canOfferReversal({ ...base, type: 'expense', reversed: true })).toBe(false)
    expect(canOfferReversal({ ...base, type: 'adjustment', isAdmin: true, isManager: false })).toBe(
      true,
    )
    expect(
      canOfferReversal({ ...base, type: 'certificate_sale', isAdmin: true, isManager: false }),
    ).toBe(false)
  })

  it('offers a refund to admin for a live payment only', () => {
    expect(canOfferRefund({ type: 'appointment_payment' }, true)).toBe(true)
    expect(canOfferRefund({ type: 'appointment_payment' }, false)).toBe(false)
    expect(canOfferRefund({ type: 'appointment_payment', reversed: true }, true)).toBe(false)
    expect(canOfferRefund({ type: 'expense' }, true)).toBe(false)
  })

  it('normalizes a typed certificate code', () => {
    expect(normalizeCertificateCode(' lu abcd-efgh ')).toBe('LU-ABCD-EFGH')
  })
})
