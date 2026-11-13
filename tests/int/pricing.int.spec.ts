import { describe, expect, it } from 'vitest'

import {
  buildLines,
  calculatePrice,
  certificateCoverage,
  PricingError,
  type CatalogItem,
  type PriceInput,
  type PriceOverride,
  type PromoRule,
} from '@/crm/pricing'
import { resolveDuration } from '@/crm/slots'

const service: CatalogItem = { id: 's1', price: 30_000, durationMinutes: 45 }
const beard: CatalogItem = { id: 'e1', price: 10_000, durationMinutes: 15 }
const wash: CatalogItem = { id: 'e2', price: 5_000, durationMinutes: 10 }

const promo = (rule: Partial<PromoRule>): PromoRule => ({
  discountType: 'percent',
  value: 10,
  appliesToServices: [],
  appliesToExtras: [],
  ...rule,
})

const price = (input: Partial<PriceInput>) => calculatePrice({ service, ...input })

const expectCode = (fn: () => unknown, code: string) => {
  try {
    fn()
  } catch (error) {
    expect(error).toBeInstanceOf(PricingError)
    expect((error as PricingError).code).toBe(code)
    return
  }
  throw new Error(`expected ${code}`)
}

describe('calculatePrice: lines', () => {
  it('base prices and durations, service first', () => {
    const result = price({ extras: [beard, wash] })
    expect(result.lines).toEqual([
      { itemType: 'service', item: 's1', price: 30_000, durationMinutes: 45 },
      { itemType: 'extra', item: 'e1', price: 10_000, durationMinutes: 15 },
      { itemType: 'extra', item: 'e2', price: 5_000, durationMinutes: 10 },
    ])
    expect(result.subtotal).toBe(45_000)
    expect(result.durationMinutes).toBe(70)
    expect(result).toMatchObject({ promoDiscount: 0, manualDiscount: 0, total: 45_000 })
  })

  it('barber overrides replace price and duration; empty override keeps the base value', () => {
    const overrides: PriceOverride[] = [
      { itemType: 'services', itemId: 's1', price: 35_000, durationMinutes: null },
      { itemType: 'extras', itemId: 'e1', price: null, durationMinutes: 20 },
      // Same id under another type does not apply.
      { itemType: 'extras', itemId: 's1', price: 1, durationMinutes: 1 },
    ]
    const result = price({ extras: [beard], overrides })
    expect(result.lines.map((l) => [l.price, l.durationMinutes])).toEqual([
      [35_000, 45],
      [10_000, 20],
    ])
    expect(result.subtotal).toBe(45_000)
    expect(result.durationMinutes).toBe(
      resolveDuration(
        service,
        [beard],
        overrides.map(({ price: _p, ...o }) => o),
      ),
    )
  })

  it('an override price of 0 is a real (free) price, not "empty"', () => {
    const result = price({ overrides: [{ itemType: 'services', itemId: 's1', price: 0 }] })
    expect(result.subtotal).toBe(0)
    expect(result.total).toBe(0)
  })

  it('rejects non-integer prices (bani only)', () => {
    expect(() => buildLines({ ...service, price: 100.5 }, [], [])).toThrow(RangeError)
    expect(() => buildLines(service, [{ ...beard, price: -1 }], [])).toThrow(RangeError)
  })
})

describe('calculatePrice: promo code', () => {
  it('percent of all items when appliesTo lists are empty', () => {
    const result = price({ extras: [beard], promo: promo({ value: 10 }) })
    expect(result.promoBase).toBe(40_000)
    expect(result.promoDiscount).toBe(4_000)
    expect(result.total).toBe(36_000)
  })

  it('percent rounds half-up to a whole ban', () => {
    // 15% of 10 = 1.5 -> 2; 15% of 9 = 1.35 -> 1; 33% of 333 = 109.89 -> 110
    expect(
      calculatePrice({ service: { ...service, price: 10 }, promo: promo({ value: 15 }) })
        .promoDiscount,
    ).toBe(2)
    expect(
      calculatePrice({ service: { ...service, price: 9 }, promo: promo({ value: 15 }) })
        .promoDiscount,
    ).toBe(1)
    expect(
      calculatePrice({ service: { ...service, price: 333 }, promo: promo({ value: 33 }) })
        .promoDiscount,
    ).toBe(110)
  })

  it('100% makes the applicable part free', () => {
    const result = price({ extras: [beard], promo: promo({ value: 100 }) })
    expect(result.promoDiscount).toBe(40_000)
    expect(result.total).toBe(0)
  })

  it('applies only to the listed services/extras', () => {
    const onlyBeard = price({
      extras: [beard, wash],
      promo: promo({ appliesToExtras: ['e1'], value: 50 }),
    })
    expect(onlyBeard.promoBase).toBe(10_000)
    expect(onlyBeard.promoDiscount).toBe(5_000)
    expect(onlyBeard.total).toBe(40_000)

    const onlyService = price({
      extras: [beard],
      promo: promo({ appliesToServices: ['s1'], value: 10 }),
    })
    expect(onlyService.promoBase).toBe(30_000)
    expect(onlyService.promoDiscount).toBe(3_000)

    // A list for services only: extras are NOT included (the lists together define the scope).
    const both = price({
      extras: [beard, wash],
      promo: promo({ appliesToServices: ['s1'], appliesToExtras: ['e2'], value: 10 }),
    })
    expect(both.promoBase).toBe(35_000)
  })

  it('no applicable items -> no discount', () => {
    const result = price({ extras: [beard], promo: promo({ appliesToServices: ['other'] }) })
    expect(result.promoBase).toBe(0)
    expect(result.promoDiscount).toBe(0)
    expect(result.total).toBe(40_000)
  })

  it('applicability uses the barber price of the item', () => {
    const result = price({
      overrides: [{ itemType: 'services', itemId: 's1', price: 40_000 }],
      promo: promo({ value: 10 }),
    })
    expect(result.promoDiscount).toBe(4_000)
  })

  it('fixed amount is taken in full when it fits', () => {
    const result = price({ extras: [beard], promo: promo({ discountType: 'fixed', value: 5_000 }) })
    expect(result.promoDiscount).toBe(5_000)
    expect(result.total).toBe(35_000)
  })

  it('fixed amount larger than the applicable sum is capped by it', () => {
    const result = price({
      extras: [beard, wash],
      promo: promo({ discountType: 'fixed', value: 50_000, appliesToExtras: ['e1'] }),
    })
    expect(result.promoDiscount).toBe(10_000)
    expect(result.total).toBe(35_000)

    const all = price({ promo: promo({ discountType: 'fixed', value: 99_999 }) })
    expect(all.promoDiscount).toBe(30_000)
    expect(all.total).toBe(0)
  })

  it('zero price: any promo gives 0 and total stays 0', () => {
    const free = { ...service, price: 0 }
    for (const rule of [promo({ value: 50 }), promo({ discountType: 'fixed', value: 1_000 })]) {
      const result = calculatePrice({ service: free, promo: rule })
      expect(result).toMatchObject({ subtotal: 0, promoDiscount: 0, total: 0 })
    }
  })

  it('rejects malformed promo rules', () => {
    expect(() => price({ promo: promo({ value: 0 }) })).toThrow(RangeError)
    expect(() => price({ promo: promo({ value: 101 }) })).toThrow(RangeError)
    expect(() => price({ promo: promo({ value: 12.5 }) })).toThrow(RangeError)
    expect(() => price({ promo: promo({ discountType: 'fixed', value: 0 }) })).toThrow(RangeError)
    expect(() => price({ promo: promo({ discountType: 'fixed', value: 1.5 }) })).toThrow(RangeError)
  })
})

describe('calculatePrice: manual discount', () => {
  it('amount, from subtotal minus the promo discount', () => {
    const result = price({
      extras: [beard],
      promo: promo({ value: 10 }),
      manualDiscount: { type: 'amount', value: 6_000, reason: '  regular  ' },
    })
    expect(result).toMatchObject({
      subtotal: 40_000,
      promoDiscount: 4_000,
      manualDiscount: 6_000,
      manualDiscountReason: 'regular',
      total: 30_000,
    })
  })

  it('percent is taken from subtotal − promoDiscount, half-up', () => {
    const result = price({
      extras: [beard],
      promo: promo({ value: 10 }),
      manualDiscount: { type: 'percent', value: 15, reason: 'friend' },
    })
    // (40000 − 4000) × 15% = 5400
    expect(result.manualDiscount).toBe(5_400)
    expect(result.total).toBe(30_600)

    const rounding = calculatePrice({
      service: { ...service, price: 10 },
      manualDiscount: { type: 'percent', value: 15, reason: 'r' },
    })
    expect(rounding.manualDiscount).toBe(2)
  })

  it('boundaries: up to the whole remaining amount, 100%, zero', () => {
    const all = price({ manualDiscount: { type: 'amount', value: 30_000, reason: 'r' } })
    expect(all.total).toBe(0)
    const hundred = price({
      promo: promo({ discountType: 'fixed', value: 1_000 }),
      manualDiscount: { type: 'percent', value: 100, reason: 'r' },
    })
    expect(hundred).toMatchObject({ manualDiscount: 29_000, total: 0 })
    // Zero discount needs no reason and is stored as "no discount".
    const zero = price({ manualDiscount: { type: 'amount', value: 0, reason: '' } })
    expect(zero).toMatchObject({ manualDiscount: 0, manualDiscountReason: null, total: 30_000 })
  })

  it('more than the remaining amount -> DISCOUNT_TOO_LARGE', () => {
    expectCode(
      () => price({ manualDiscount: { type: 'amount', value: 30_001, reason: 'r' } }),
      'DISCOUNT_TOO_LARGE',
    )
    expectCode(
      () =>
        price({
          promo: promo({ value: 50 }),
          manualDiscount: { type: 'amount', value: 15_001, reason: 'r' },
        }),
      'DISCOUNT_TOO_LARGE',
    )
    // Zero price: any positive amount is too large.
    expectCode(
      () =>
        calculatePrice({
          service: { ...service, price: 0 },
          manualDiscount: { type: 'amount', value: 1, reason: 'r' },
        }),
      'DISCOUNT_TOO_LARGE',
    )
  })

  it('invalid values -> DISCOUNT_INVALID', () => {
    for (const manualDiscount of [
      { type: 'amount' as const, value: -1, reason: 'r' },
      { type: 'amount' as const, value: 10.5, reason: 'r' },
      { type: 'percent' as const, value: -5, reason: 'r' },
      { type: 'percent' as const, value: 100.01, reason: 'r' },
      { type: 'percent' as const, value: Number.NaN, reason: 'r' },
    ]) {
      expectCode(() => price({ manualDiscount }), 'DISCOUNT_INVALID')
    }
  })

  it('a reason is required for a non-zero discount', () => {
    for (const reason of [undefined, null, '', '   ']) {
      expectCode(
        () => price({ manualDiscount: { type: 'amount', value: 100, reason } }),
        'DISCOUNT_REASON_REQUIRED',
      )
    }
  })
})

describe('calculatePrice: invariants', () => {
  it('total = subtotal − promo − manual and never negative', () => {
    const rules = [
      null,
      promo({ value: 1 }),
      promo({ value: 100 }),
      promo({ discountType: 'fixed', value: 1 }),
      promo({ discountType: 'fixed', value: 1_000_000 }),
      promo({ appliesToExtras: ['e2'], value: 33 }),
    ]
    for (const basePrice of [0, 1, 99, 30_000]) {
      for (const rule of rules) {
        for (const percent of [0, 1, 33, 100]) {
          const result = calculatePrice({
            service: { ...service, price: basePrice },
            extras: [wash],
            promo: rule,
            manualDiscount: { type: 'percent', value: percent, reason: 'r' },
          })
          expect(result.total).toBeGreaterThanOrEqual(0)
          expect(Number.isInteger(result.total)).toBe(true)
          expect(result.total).toBe(result.subtotal - result.promoDiscount - result.manualDiscount)
          expect(result.promoDiscount).toBeLessThanOrEqual(result.promoBase)
        }
      }
    }
  })
})

describe('certificateCoverage', () => {
  it('a certificate does not change total; it covers min(balance, total − paid)', () => {
    const { total } = price({ extras: [beard] })
    expect(certificateCoverage({ total, balance: 10_000 })).toEqual({
      covered: 10_000,
      toPay: 30_000,
    })
    expect(certificateCoverage({ total, balance: 100_000 })).toEqual({ covered: 40_000, toPay: 0 })
    expect(certificateCoverage({ total, paidAmount: 35_000, balance: 10_000 })).toEqual({
      covered: 5_000,
      toPay: 0,
    })
  })

  it('works together with a promo code (decision 29)', () => {
    const { total } = price({ extras: [beard], promo: promo({ value: 25 }) })
    expect(total).toBe(30_000)
    expect(certificateCoverage({ total, balance: 20_000 })).toEqual({
      covered: 20_000,
      toPay: 10_000,
    })
  })

  it('boundaries: zero balance, zero total, already fully paid', () => {
    expect(certificateCoverage({ total: 10_000, balance: 0 })).toEqual({
      covered: 0,
      toPay: 10_000,
    })
    expect(certificateCoverage({ total: 0, balance: 5_000 })).toEqual({ covered: 0, toPay: 0 })
    expect(certificateCoverage({ total: 10_000, paidAmount: 10_000, balance: 5_000 })).toEqual({
      covered: 0,
      toPay: 0,
    })
  })

  it('rejects non-integer or negative amounts', () => {
    expect(() => certificateCoverage({ total: 10.5, balance: 1 })).toThrow(RangeError)
    expect(() => certificateCoverage({ total: 10, balance: -1 })).toThrow(RangeError)
  })
})
