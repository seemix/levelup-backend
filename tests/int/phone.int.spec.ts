import { describe, expect, it } from 'vitest'
import { formatPhone, normalizePhone, PhoneError, tryNormalizePhone } from '@/crm/phone'

describe('phone', () => {
  it.each(['069123456', '+373 69 123 456', '+37369123456', '0037369123456', '(069) 12-34-56'])(
    'normalizes %s to E.164',
    (input) => {
      expect(normalizePhone(input)).toBe('+37369123456')
    },
  )

  it.each(['', '   ', 'abc', '123', '069', '+373 69 12', '+999 123'])('rejects %j', (input) => {
    expect(tryNormalizePhone(input)).toBeNull()
    expect(() => normalizePhone(input)).toThrow(PhoneError)
  })

  it('exposes PHONE_INVALID code', () => {
    expect(() => normalizePhone('x')).toThrow(/PHONE_INVALID/)
    try {
      normalizePhone('x')
    } catch (e) {
      expect((e as PhoneError).code).toBe('PHONE_INVALID')
    }
  })

  it('keeps foreign numbers given with +', () => {
    expect(normalizePhone('+40 721 234 567')).toBe('+40721234567')
  })

  it('formats for display', () => {
    expect(formatPhone('+37369123456')).toBe('+373 691 23 456')
  })
})
