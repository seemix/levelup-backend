import { describe, expect, it } from 'vitest'

import {
  CERTIFICATE_ALPHABET,
  certificateChargeError,
  certificateStatus,
  defaultExpiry,
  generateCertificateCode,
  isCertificateCode,
  normalizeCertificateCode,
} from '@/crm/certificates'
import {
  afterPayment,
  afterRefund,
  amountDue,
  PaymentError,
  planPayment,
  statusAfterPayment,
  type AppointmentMoney,
  type PaymentRequest,
} from '@/crm/payments'

const NOW = new Date('2026-11-14T12:00:00Z')

describe('gift certificate rules (§4.17, §5.7, A6)', () => {
  it('generates LU-XXXX-XXXX without look-alike characters', () => {
    expect(CERTIFICATE_ALPHABET).not.toMatch(/[0O1I]/)
    expect(CERTIFICATE_ALPHABET).toHaveLength(32)
    for (let i = 0; i < 200; i++) {
      const code = generateCertificateCode()
      expect(isCertificateCode(code)).toBe(true)
      expect(code).not.toMatch(/[0O1I]/)
    }
    // Every byte maps into the alphabet (no bias, no out-of-range).
    expect(generateCertificateCode(() => new Uint8Array([0, 31, 32, 255, 1, 2, 3, 4]))).toBe(
      'LU-A9A9-BCDE',
    )
  })

  it('normalizes typed codes', () => {
    expect(normalizeCertificateCode(' lu-abcd-efgh ')).toBe('LU-ABCD-EFGH')
    expect(normalizeCertificateCode('luabcd efgh')).toBe('LU-ABCD-EFGH')
    expect(normalizeCertificateCode('x')).toBe('X')
  })

  it('expires 12 months after the sale, local time (DST-safe)', () => {
    // 2026-03-29 10:00 local (after the spring switch) → 2027-03-29 10:00 local.
    expect(defaultExpiry(new Date('2026-03-29T07:00:00Z')).toISOString()).toBe(
      '2027-03-29T07:00:00.000Z',
    )
    // Winter → winter.
    expect(defaultExpiry(new Date('2026-11-14T10:00:00Z')).toISOString()).toBe(
      '2027-11-14T10:00:00.000Z',
    )
  })

  it('derives the status', () => {
    const future = '2027-01-01T00:00:00Z'
    expect(certificateStatus({ balance: 100, expiresAt: future }, NOW)).toBe('active')
    expect(certificateStatus({ balance: 0, expiresAt: future }, NOW)).toBe('depleted')
    expect(certificateStatus({ balance: 100, expiresAt: '2026-11-01T00:00:00Z' }, NOW)).toBe(
      'expired',
    )
    expect(certificateStatus({ balance: 100, expiresAt: future, voided: true }, NOW)).toBe('void')
  })

  it('checks a charge', () => {
    const cert = { balance: 5_000, expiresAt: '2027-01-01T00:00:00Z' }
    expect(certificateChargeError(cert, 5_000, NOW)).toBeNull()
    expect(certificateChargeError(cert, 5_001, NOW)).toBe('CERTIFICATE_INSUFFICIENT')
    expect(certificateChargeError(cert, 0, NOW)).toBe('CERTIFICATE_INSUFFICIENT')
    expect(certificateChargeError(null, 1, NOW)).toBe('CERTIFICATE_NOT_FOUND')
    expect(certificateChargeError({ ...cert, voided: true }, 1, NOW)).toBe('CERTIFICATE_VOID')
    expect(certificateChargeError({ ...cert, expiresAt: NOW }, 1, NOW)).toBe('CERTIFICATE_EXPIRED')
  })
})

describe('payment rules (§5.8, A34)', () => {
  const money = (patch: Partial<AppointmentMoney> = {}): AppointmentMoney => ({
    kind: 'appointment',
    status: 'completed',
    startAt: new Date('2026-11-14T10:00:00Z'),
    total: 30_000,
    paidAmount: 0,
    certificateAmount: 0,
    ...patch,
  })
  const entries = (...amounts: number[]) =>
    amounts.map((amount, i) => ({ cashRegister: `r${i}`, amount }))
  const codeOf = (m: AppointmentMoney, request: PaymentRequest) => {
    try {
      planPayment(m, request)
      return null
    } catch (error) {
      return error instanceof PaymentError ? error.code : String(error)
    }
  }

  it('split payment, partial payment', () => {
    expect(planPayment(money(), { entries: entries(20_000, 10_000) })).toEqual({
      applied: 30_000,
      certificateAmount: 0,
    })
    expect(planPayment(money(), { entries: entries(10_000) }).applied).toBe(10_000)
    expect(amountDue(money({ paidAmount: 10_000 }))).toBe(20_000)
  })

  it('refuses an overpayment, empty or invalid input', () => {
    expect(codeOf(money(), { entries: entries(30_001) })).toBe('PAYMENT_EXCEEDS_DUE')
    expect(codeOf(money({ paidAmount: 30_000, status: 'paid' }), { entries: entries(1) })).toBe(
      'PAYMENT_EXCEEDS_DUE',
    )
    expect(codeOf(money(), { entries: [] })).toBe('PAYMENT_EMPTY')
    expect(codeOf(money(), { entries: entries(-5) })).toBe('LEDGER_ENTRIES_INVALID')
    expect(codeOf(money(), { entries: entries(10.5) })).toBe('LEDGER_ENTRIES_INVALID')
    // A former tip field is ignored (A45): money above the due amount is an overpayment.
    expect(
      codeOf(money(), { entries: entries(30_000, 5_000), tipAmount: 5_000 } as PaymentRequest),
    ).toBe('PAYMENT_EXCEEDS_DUE')
  })

  it('only scheduled / completed / paid appointments take payments', () => {
    for (const status of ['cancelled_by_client', 'cancelled_by_salon', 'no_show'] as const)
      expect(codeOf(money({ status }), { entries: entries(100) })).toBe('APPOINTMENT_NOT_PAYABLE')
    expect(codeOf(money({ kind: 'block' }), { entries: entries(100) })).toBe(
      'APPOINTMENT_NOT_PAYABLE',
    )
    expect(codeOf(money({ status: 'scheduled' }), { entries: entries(100) })).toBeNull()
  })

  it('a certificate covers min(balance, due − money) by default; explicit ≤ balance', () => {
    expect(
      planPayment(money(), { entries: entries(10_000), certificateBalance: 50_000 }),
    ).toMatchObject({ certificateAmount: 20_000, applied: 30_000 })
    expect(planPayment(money(), { entries: [], certificateBalance: 12_000 })).toMatchObject({
      certificateAmount: 12_000,
      applied: 12_000,
    })
    expect(
      planPayment(money(), { entries: [], certificateBalance: 50_000, certificateAmount: 5_000 }),
    ).toMatchObject({ certificateAmount: 5_000, applied: 5_000 })
    expect(
      codeOf(money(), { entries: [], certificateBalance: 4_000, certificateAmount: 5_000 }),
    ).toBe('CERTIFICATE_INSUFFICIENT')
    expect(codeOf(money(), { entries: [], certificateBalance: 0 })).toBe('CERTIFICATE_INSUFFICIENT')
    expect(codeOf(money(), { entries: [], certificateAmount: 100 })).toBe(
      'CERTIFICATE_INSUFFICIENT',
    )
    // Certificate + money above the amount due.
    expect(
      codeOf(money(), {
        entries: entries(20_000),
        certificateBalance: 50_000,
        certificateAmount: 15_000,
      }),
    ).toBe('PAYMENT_EXCEEDS_DUE')
  })

  it('status after payment: completed → paid, started scheduled → paid, prepayment keeps scheduled', () => {
    const past = new Date('2026-11-14T10:00:00Z')
    const future = new Date('2026-11-20T10:00:00Z')
    expect(statusAfterPayment({ status: 'completed', startAt: past, total: 100 }, 100, NOW)).toBe(
      'paid',
    )
    expect(statusAfterPayment({ status: 'completed', startAt: past, total: 100 }, 99, NOW)).toBe(
      'completed',
    )
    expect(statusAfterPayment({ status: 'scheduled', startAt: past, total: 100 }, 100, NOW)).toBe(
      'paid',
    )
    expect(statusAfterPayment({ status: 'scheduled', startAt: future, total: 100 }, 100, NOW)).toBe(
      'scheduled',
    )
  })

  it('accumulates payments and undoes them by refund', () => {
    const paid = afterPayment(money(), { applied: 30_000, certificateAmount: 10_000 }, NOW)
    expect(paid).toEqual({
      paidAmount: 30_000,
      certificateAmount: 10_000,
      status: 'paid',
    })
    const state = money({ ...paid })
    expect(afterRefund(state, { applied: 30_000, certificateAmount: 10_000 })).toEqual({
      paidAmount: 0,
      certificateAmount: 0,
      status: 'completed',
    })
    // A refund of one of two payments of a scheduled (prepaid) visit keeps its status.
    expect(
      afterRefund(money({ status: 'scheduled', paidAmount: 30_000 }), {
        applied: 10_000,
        certificateAmount: 0,
      }),
    ).toMatchObject({ paidAmount: 20_000, status: 'scheduled' })
  })
})
