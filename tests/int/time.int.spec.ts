import { describe, expect, it } from 'vitest'
import {
  addLocalDays,
  eachLocalDate,
  gridTimes,
  isLocalDate,
  isoWeekday,
  localDayMinutes,
  localDayRange,
  localToInstant,
  minutesToTime,
  timeToMinutes,
  toLocalDate,
  toLocalTime,
} from '@/crm/time'

describe('time', () => {
  it('converts local time to UTC with winter (+2) and summer (+3) offsets', () => {
    expect(localToInstant('2026-01-15', '10:00').toISOString()).toBe('2026-01-15T08:00:00.000Z')
    expect(localToInstant('2026-07-15', '10:00').toISOString()).toBe('2026-07-15T07:00:00.000Z')
  })

  it('round-trips instant <-> local date/time', () => {
    const i = localToInstant('2026-05-02', '23:45')
    expect(toLocalDate(i)).toBe('2026-05-02')
    expect(toLocalTime(i)).toBe('23:45')
  })

  it('local date differs from UTC date around midnight', () => {
    expect(toLocalDate(new Date('2026-05-01T22:30:00Z'))).toBe('2026-05-02')
  })

  describe('DST 2026-03-29 (spring forward, 03:00 -> 04:00)', () => {
    it('day is 23 hours long', () => {
      expect(localDayMinutes('2026-03-29')).toBe(23 * 60)
      const { start, end } = localDayRange('2026-03-29')
      expect(start.toISOString()).toBe('2026-03-28T22:00:00.000Z')
      expect(end.toISOString()).toBe('2026-03-29T21:00:00.000Z')
    })

    it('offsets switch from +2 to +3', () => {
      expect(localToInstant('2026-03-29', '02:30').toISOString()).toBe('2026-03-29T00:30:00.000Z')
      expect(localToInstant('2026-03-29', '04:00').toISOString()).toBe('2026-03-29T01:00:00.000Z')
      expect(toLocalTime(new Date('2026-03-29T01:00:00Z'))).toBe('04:00')
    })

    it('nonexistent 03:30 maps forward to 04:30 local', () => {
      expect(toLocalTime(localToInstant('2026-03-29', '03:30'))).toBe('04:30')
    })
  })

  describe('DST 2026-10-25 (fall back, 04:00 -> 03:00)', () => {
    it('day is 25 hours long', () => {
      expect(localDayMinutes('2026-10-25')).toBe(25 * 60)
      const { start, end } = localDayRange('2026-10-25')
      expect(start.toISOString()).toBe('2026-10-24T21:00:00.000Z')
      expect(end.toISOString()).toBe('2026-10-25T22:00:00.000Z')
    })

    it('offsets switch from +3 to +2', () => {
      expect(localToInstant('2026-10-25', '02:30').toISOString()).toBe('2026-10-24T23:30:00.000Z')
      expect(localToInstant('2026-10-25', '05:00').toISOString()).toBe('2026-10-25T03:00:00.000Z')
      expect(toLocalTime(new Date('2026-10-25T03:00:00Z'))).toBe('05:00')
    })
  })

  it('normal days are 24 hours', () => {
    expect(localDayMinutes('2026-06-10')).toBe(24 * 60)
  })

  it('date arithmetic ignores DST', () => {
    expect(addLocalDays('2026-03-28', 1)).toBe('2026-03-29')
    expect(addLocalDays('2026-03-29', 1)).toBe('2026-03-30')
    expect(addLocalDays('2026-10-24', 2)).toBe('2026-10-26')
    expect(addLocalDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(eachLocalDate('2026-10-24', '2026-10-26')).toEqual([
      '2026-10-24',
      '2026-10-25',
      '2026-10-26',
    ])
  })

  it('isoWeekday: Monday=1, Sunday=7', () => {
    expect(isoWeekday('2026-03-29')).toBe(7)
    expect(isoWeekday('2026-10-26')).toBe(1)
  })

  it('validates dates and times', () => {
    expect(isLocalDate('2026-02-29')).toBe(false)
    expect(isLocalDate('2028-02-29')).toBe(true)
    expect(() => localToInstant('2026-13-01')).toThrow()
    expect(() => timeToMinutes('24:00')).toThrow()
    expect(timeToMinutes('09:30')).toBe(570)
    expect(minutesToTime(570)).toBe('09:30')
  })

  it('builds the 15-minute grid', () => {
    expect(gridTimes('09:00', '10:00')).toEqual(['09:00', '09:15', '09:30', '09:45'])
    expect(gridTimes()).toHaveLength(96)
  })
})
