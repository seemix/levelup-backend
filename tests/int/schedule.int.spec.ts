import { describe, expect, it } from 'vitest'

import {
  dateRangesOverlap,
  getWorkingIntervals,
  subtractBreaks,
  validateBreaks,
  validateDateRange,
  validateWeeklySchedule,
  type BarberSchedule,
  type ScheduleException,
} from '@/crm/schedule'

// 2026-11-16 is a Monday; Chisinau is UTC+2 in winter, UTC+3 in summer.
const MON = '2026-11-16'
const TUE = '2026-11-17'
const SUN = '2026-11-22'

const barber: BarberSchedule = {
  locations: ['locA', 'locB'],
  weeklySchedule: [
    {
      weekday: 1,
      location: 'locA',
      start: '09:00',
      end: '18:00',
      breaks: [{ start: '13:00', end: '14:00' }],
    },
    { weekday: 2, location: { id: 'locB' }, start: '10:00', end: '16:00' },
    { weekday: 7, location: 'locA', start: '09:00', end: '18:00' },
  ],
}

const simple = (day: ReturnType<typeof getWorkingIntervals>) =>
  day.working
    ? {
        location: day.locationId,
        source: day.source,
        local: day.intervals.map((i) => `${i.startTime}-${i.endTime}`),
        utc: day.intervals.map((i) => `${i.start.toISOString()}/${i.end.toISOString()}`),
      }
    : { off: day.reason, source: day.source }

describe('getWorkingIntervals: weekly template', () => {
  it('splits the working day by breaks and uses the template location', () => {
    expect(simple(getWorkingIntervals(barber, MON))).toEqual({
      location: 'locA',
      source: 'weekly',
      local: ['09:00-13:00', '14:00-18:00'],
      utc: [
        '2026-11-16T07:00:00.000Z/2026-11-16T11:00:00.000Z',
        '2026-11-16T12:00:00.000Z/2026-11-16T16:00:00.000Z',
      ],
    })
  })

  it('takes the location of the day from the row (populated relation too)', () => {
    expect(simple(getWorkingIntervals(barber, TUE))).toMatchObject({
      location: 'locB',
      local: ['10:00-16:00'],
    })
  })

  it('a weekday without a row is a day off', () => {
    expect(simple(getWorkingIntervals(barber, '2026-11-18'))).toEqual({
      off: 'no_schedule',
      source: 'weekly',
    })
    expect(getWorkingIntervals({ weeklySchedule: null }, MON).working).toBe(false)
  })

  it('handles DST days: spring forward 2026-03-29 and fall back 2026-10-25 (Sundays)', () => {
    expect(simple(getWorkingIntervals(barber, '2026-03-29')).utc).toEqual([
      '2026-03-29T06:00:00.000Z/2026-03-29T15:00:00.000Z',
    ])
    expect(simple(getWorkingIntervals(barber, '2026-10-25')).utc).toEqual([
      '2026-10-25T07:00:00.000Z/2026-10-25T16:00:00.000Z',
    ])
    expect(simple(getWorkingIntervals(barber, SUN)).utc).toEqual([
      '2026-11-22T07:00:00.000Z/2026-11-22T16:00:00.000Z',
    ])
  })

  it('rejects an invalid date', () => {
    expect(() => getWorkingIntervals(barber, '2026-02-30')).toThrow(RangeError)
  })
})

describe('getWorkingIntervals: exceptions', () => {
  const range = (kind: ScheduleException['kind'], extra: Partial<ScheduleException> = {}) => ({
    dateFrom: MON,
    dateTo: TUE,
    kind,
    ...extra,
  })

  it.each(['day_off', 'vacation', 'sick'] as const)(
    '%s makes every covered day non-working',
    (kind) => {
      for (const date of [MON, TUE]) {
        expect(simple(getWorkingIntervals(barber, date, [range(kind)]))).toEqual({
          off: kind,
          source: 'exception',
        })
      }
      // Outside the range the template applies again.
      expect(getWorkingIntervals(barber, SUN, [range(kind)]).working).toBe(true)
    },
  )

  it('custom_hours replaces the template with its own hours, breaks and location', () => {
    const exception = range('custom_hours', {
      location: 'locB',
      start: '12:00',
      end: '20:00',
      breaks: [{ start: '15:00', end: '15:30' }],
    })
    expect(simple(getWorkingIntervals(barber, MON, [exception]))).toEqual({
      location: 'locB',
      source: 'exception',
      local: ['12:00-15:00', '15:30-20:00'],
      utc: [
        '2026-11-16T10:00:00.000Z/2026-11-16T13:00:00.000Z',
        '2026-11-16T13:30:00.000Z/2026-11-16T18:00:00.000Z',
      ],
    })
  })

  it('custom_hours works on a day without a template row', () => {
    const wed = '2026-11-18'
    const exception = {
      dateFrom: wed,
      dateTo: wed,
      kind: 'custom_hours' as const,
      location: 'locA',
      start: '10:00',
      end: '12:00',
    }
    expect(simple(getWorkingIntervals(barber, wed, [exception]))).toMatchObject({
      location: 'locA',
      local: ['10:00-12:00'],
    })
  })

  it('custom_hours without a location falls back to the template, then to the only barber location', () => {
    const exception = range('custom_hours', { start: '10:00', end: '11:00' })
    expect(getWorkingIntervals(barber, TUE, [exception])).toMatchObject({ locationId: 'locB' })

    const single: BarberSchedule = { locations: [{ id: 'only' }], weeklySchedule: [] }
    expect(getWorkingIntervals(single, MON, [exception])).toMatchObject({ locationId: 'only' })
    expect(getWorkingIntervals({ locations: ['a', 'b'] }, MON, [exception])).toMatchObject({
      locationId: null,
    })
  })

  it('ignores exceptions that do not cover the date', () => {
    const later = { dateFrom: '2026-12-01', dateTo: '2026-12-05', kind: 'vacation' as const }
    expect(simple(getWorkingIntervals(barber, MON, [later]))).toMatchObject({ source: 'weekly' })
  })
})

describe('breaks', () => {
  it('subtracts unsorted, overlapping and edge breaks', () => {
    const day = { start: 9 * 60, end: 18 * 60 }
    expect(
      subtractBreaks(day, [
        { start: '14:00', end: '15:00' },
        { start: '09:00', end: '09:30' },
        { start: '14:30', end: '15:30' },
        { start: '17:30', end: '19:00' },
      ]),
    ).toEqual([
      { start: 9 * 60 + 30, end: 14 * 60 },
      { start: 15 * 60 + 30, end: 17 * 60 + 30 },
    ])
    expect(subtractBreaks(day, [{ start: '09:00', end: '18:00' }])).toEqual([])
    expect(subtractBreaks(day, null)).toEqual([day])
  })

  it('validateBreaks: inside the day, start < end, touching allowed, no overlaps', () => {
    const day = { start: '09:00', end: '18:00' }
    expect(validateBreaks(day, [])).toBeNull()
    expect(
      validateBreaks(day, [
        { start: '12:00', end: '13:00' },
        { start: '13:00', end: '13:30' },
      ]),
    ).toBeNull()
    expect(validateBreaks(day, [{ start: '13:00', end: '12:00' }])).toBe('BREAK_INVALID')
    expect(validateBreaks(day, [{ start: '8:00', end: '12:00' }])).toBe('BREAK_INVALID')
    expect(validateBreaks(day, [{ start: '08:30', end: '09:30' }])).toBe('BREAK_OUTSIDE')
    expect(validateBreaks(day, [{ start: '17:30', end: '18:30' }])).toBe('BREAK_OUTSIDE')
    expect(
      validateBreaks(day, [
        { start: '12:00', end: '13:00' },
        { start: '12:30', end: '14:00' },
      ]),
    ).toBe('BREAKS_OVERLAP')
  })
})

describe('validateWeeklySchedule', () => {
  const row = { weekday: 1, location: 'locA', start: '09:00', end: '18:00' }

  it('accepts a valid template', () => {
    expect(validateWeeklySchedule(barber.weeklySchedule, barber.locations)).toBeNull()
    expect(validateWeeklySchedule([], [])).toBeNull()
  })

  it('reports each kind of error', () => {
    const locs = ['locA']
    expect(validateWeeklySchedule([row, { ...row }], locs)).toBe('WEEKDAY_DUPLICATE')
    expect(validateWeeklySchedule([{ ...row, weekday: 8 }], locs)).toBe('WEEKDAY_INVALID')
    expect(validateWeeklySchedule([{ ...row, end: '09:00' }], locs)).toBe('END_BEFORE_START')
    expect(validateWeeklySchedule([{ ...row, start: '9' }], locs)).toBe('TIME_INVALID')
    expect(
      validateWeeklySchedule([{ ...row, breaks: [{ start: '18:00', end: '19:00' }] }], locs),
    ).toBe('BREAK_OUTSIDE')
    expect(validateWeeklySchedule([{ ...row, location: 'locB' }], locs)).toBe(
      'LOCATION_NOT_ALLOWED',
    )
    // Select values arrive as strings.
    expect(validateWeeklySchedule([{ ...row, weekday: '3' as never }], locs)).toBeNull()
  })
})

describe('date ranges', () => {
  it('validateDateRange', () => {
    expect(validateDateRange('2026-11-16', '2026-11-16')).toBeNull()
    expect(validateDateRange('2026-11-17', '2026-11-16')).toBe('DATE_RANGE_INVALID')
    expect(validateDateRange('2026-11-31', '2026-12-01')).toBe('DATE_INVALID')
    expect(validateDateRange(undefined, '2026-12-01')).toBe('DATE_INVALID')
  })

  it('dateRangesOverlap is inclusive', () => {
    const a = { dateFrom: '2026-11-10', dateTo: '2026-11-15' }
    expect(dateRangesOverlap(a, { dateFrom: '2026-11-15', dateTo: '2026-11-20' })).toBe(true)
    expect(dateRangesOverlap(a, { dateFrom: '2026-11-01', dateTo: '2026-11-30' })).toBe(true)
    expect(dateRangesOverlap(a, { dateFrom: '2026-11-16', dateTo: '2026-11-20' })).toBe(false)
  })
})
