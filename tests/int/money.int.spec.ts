import { describe, expect, it } from 'vitest'
import {
  baniToLei,
  baniToLeiText,
  formatMoney,
  leiToBani,
  parseLeiInput,
  percentOf,
  sumBani,
} from '@/crm/money'

describe('money input helpers', () => {
  it('formats bani as an input string', () => {
    expect(baniToLeiText(1250)).toBe('12.50')
    expect(baniToLeiText(5)).toBe('0.05')
    expect(baniToLeiText(0)).toBe('0.00')
    expect(baniToLeiText(-350)).toBe('-3.50')
  })

  it('parses input strictly', () => {
    expect(parseLeiInput('12')).toBe(1200)
    expect(parseLeiInput(' 12,5 ')).toBe(1250)
    expect(parseLeiInput('0.05')).toBe(5)
    for (const bad of ['', 'abc', '1.234', '-1', '1,2,3', '1e3']) {
      expect(parseLeiInput(bad)).toBeNull()
    }
  })

  it('round-trips bani -> text -> bani', () => {
    for (const bani of [0, 1, 99, 100, 12345, 99999]) {
      expect(parseLeiInput(baniToLeiText(bani))).toBe(bani)
    }
  })
})

describe('money', () => {
  it('converts lei to bani', () => {
    expect(leiToBani(12.5)).toBe(1250)
    expect(leiToBani('12,50')).toBe(1250)
    expect(leiToBani('0.29')).toBe(29)
    expect(leiToBani(1.005)).toBe(101)
    expect(leiToBani('-3.5')).toBe(-350)
    expect(() => leiToBani('abc')).toThrow()
  })

  it('converts bani to lei', () => {
    expect(baniToLei(1250)).toBe(12.5)
    expect(() => baniToLei(10.5)).toThrow()
  })

  it('percentOf rounds half-up', () => {
    expect(percentOf(10_000, 10)).toBe(1000)
    expect(percentOf(5, 50)).toBe(3) // 2.5 -> 3
    expect(percentOf(1, 50)).toBe(1) // 0.5 -> 1
    expect(percentOf(3, 50)).toBe(2) // 1.5 -> 2
    expect(percentOf(9990, 12.5)).toBe(1249) // 1248.75
    expect(percentOf(0, 30)).toBe(0)
    expect(percentOf(333, 100)).toBe(333)
  })

  it('percentOf has no float drift', () => {
    expect(percentOf(29, 100)).toBe(29)
    expect(percentOf(1000, 0.1)).toBe(1)
  })

  it('sums bani and rejects non-integers', () => {
    expect(sumBani([100, 250, 5])).toBe(355)
    expect(() => sumBani([1.5])).toThrow()
  })

  it('formats MDL in each locale', () => {
    for (const locale of ['ru', 'ro', 'en']) {
      const out = formatMoney(123450, locale)
      expect(out).toMatch(/234[.,]50/)
      expect(out).toMatch(/MDL|L|лей|lei/)
    }
  })
})
