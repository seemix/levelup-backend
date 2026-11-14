import { describe, expect, it } from 'vitest'

import { calculateSalary, fixedSalaryForPeriod } from '@/crm/salary'

describe('fixed monthly salary (A45)', () => {
  it('a whole month gives exactly the monthly amount, whatever its length', () => {
    expect(fixedSalaryForPeriod(600_000, '2026-02-01', '2026-02-28')).toBe(600_000)
    expect(fixedSalaryForPeriod(600_000, '2026-11-01', '2026-11-30')).toBe(600_000)
    expect(fixedSalaryForPeriod(600_000, '2026-12-01', '2026-12-31')).toBe(600_000)
    expect(fixedSalaryForPeriod(600_000, '2026-01-01', '2026-12-31')).toBe(12 * 600_000)
  })

  it('part of a month: in proportion to its calendar days, rounded half up per month', () => {
    // 15 of 30 days.
    expect(fixedSalaryForPeriod(600_000, '2026-11-01', '2026-11-15')).toBe(300_000)
    // 1 of 31 days: 100 000 / 31 = 3 225.8… → 3 226.
    expect(fixedSalaryForPeriod(100_000, '2026-12-31', '2026-12-31')).toBe(3_226)
    // Across months: 2 of 30 (Nov) + 3 of 31 (Dec) = 6 667 + 9 677.
    expect(fixedSalaryForPeriod(100_000, '2026-11-29', '2026-12-03')).toBe(6_667 + 9_677)
  })

  it('no rate, a non-positive rate or an empty period → 0', () => {
    expect(fixedSalaryForPeriod(0, '2026-11-01', '2026-11-30')).toBe(0)
    expect(fixedSalaryForPeriod(-1, '2026-11-01', '2026-11-30')).toBe(0)
    expect(fixedSalaryForPeriod(100_000, '2026-11-02', '2026-11-01')).toBe(0)
  })

  it('the salary row adds the fixed part; a barber with a rate gets a row without operations', () => {
    const appointments = new Map([
      [
        'a1',
        {
          subtotal: 30_000,
          total: 30_000,
          lines: [{ itemType: 'service' as const, item: 's', price: 30_000 }],
        },
      ],
    ])
    const payment = {
      id: 't1',
      type: 'appointment_payment' as const,
      occurredAt: new Date('2026-11-10T10:00:00Z'),
      barber: 'b1',
      appointment: 'a1',
      cash: 30_000,
      certificateAmount: 0,
    }
    const { rows, totals } = calculateSalary(
      [payment],
      appointments,
      new Map([['b1', { servicesPercent: 50 }]]),
      ['b1', 'b2'],
      new Map([
        ['b1', 200_000],
        ['b2', 300_000],
        ['b3', 0],
      ]),
    )
    expect(
      rows.map((row) => [row.barber, row.servicesCommission, row.fixedSalary, row.total]),
    ).toEqual([
      ['b1', 15_000, 200_000, 215_000],
      ['b2', 0, 300_000, 300_000],
    ])
    expect(totals).toMatchObject({ fixedSalary: 500_000, total: 515_000 })
  })
})
