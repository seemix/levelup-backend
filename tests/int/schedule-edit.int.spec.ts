import { describe, expect, it } from 'vitest'

import type { BarberSchedule } from '@/crm/schedule'
import {
  contiguousRuns,
  matchesPattern,
  monthRange,
  parseDates,
  parseDayValue,
  planClear,
  planDays,
  planFill,
  rosterDay,
  type StoredException,
} from '@/crm/schedule-edit'

// 2026-11-16 is a Monday.
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
    { weekday: 2, location: 'locB', start: '10:00', end: '16:00' },
  ],
}

const exception = (
  id: string,
  dateFrom: string,
  dateTo: string,
  kind: StoredException['kind'] = 'day_off',
  extra: Partial<StoredException> = {},
): StoredException => ({ id, dateFrom, dateTo, kind, comment: null, ...extra })

describe('month and date helpers', () => {
  it('monthRange covers leap years and December', () => {
    expect(monthRange('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' })
    expect(monthRange('2026-12')).toEqual({ from: '2026-12-01', to: '2026-12-31' })
    expect(() => monthRange('2026-13')).toThrow(RangeError)
  })

  it('contiguousRuns groups consecutive dates across month ends', () => {
    expect(contiguousRuns(['2026-12-01', '2026-11-30', '2026-11-28', '2026-11-30'])).toEqual([
      { dateFrom: '2026-11-28', dateTo: '2026-11-28' },
      { dateFrom: '2026-11-30', dateTo: '2026-12-01' },
    ])
    expect(contiguousRuns([])).toEqual([])
  })

  it('parseDates: valid, unique, sorted, limited', () => {
    expect(parseDates(['2026-11-17', '2026-11-16', '2026-11-17'], 5)).toEqual([
      '2026-11-16',
      '2026-11-17',
    ])
    expect(parseDates([], 5)).toBeNull()
    expect(parseDates(['2026-02-30'], 5)).toBeNull()
    expect(parseDates(['2026-11-16', '2026-11-17'], 1)).toBeNull()
    expect(parseDates('2026-11-16', 5)).toBeNull()
  })

  it('parseDayValue checks the shape', () => {
    expect(parseDayValue({ kind: 'pattern' })).toEqual({ kind: 'pattern' })
    expect(parseDayValue({ kind: 'vacation', comment: 'sea' })).toEqual({
      kind: 'vacation',
      comment: 'sea',
    })
    expect(parseDayValue({ kind: 'custom_hours', start: '9:00', end: '18:00' })).toBeNull()
    expect(
      parseDayValue({ kind: 'custom_hours', start: '09:00', end: '18:00', breaks: 'x' }),
    ).toBeNull()
    expect(parseDayValue({ kind: 'nope' })).toBeNull()
    expect(
      parseDayValue({
        kind: 'custom_hours',
        location: 'locA',
        start: '09:00',
        end: '18:00',
        breaks: [{ start: '12:00' }],
      }),
    ).toMatchObject({ breaks: [{ start: '12:00', end: '' }] })
  })
})

describe('rosterDay', () => {
  it('pattern days: working with hours and location, or off', () => {
    expect(rosterDay(barber, '2026-11-16', [])).toMatchObject({
      status: 'work',
      override: false,
      location: 'locA',
      start: '09:00',
      end: '18:00',
      breaks: [{ start: '13:00', end: '14:00' }],
    })
    expect(rosterDay(barber, '2026-11-18', [])).toMatchObject({ status: 'off', override: false })
  })

  it('exceptions override the pattern; custom hours without a location take the template one', () => {
    const list = [
      exception('e1', '2026-11-16', '2026-11-16', 'vacation', { comment: 'sea' }),
      exception('e2', '2026-11-17', '2026-11-17', 'custom_hours', { start: '12:00', end: '20:00' }),
    ]
    expect(rosterDay(barber, '2026-11-16', list)).toMatchObject({
      status: 'vacation',
      override: true,
      exceptionId: 'e1',
      comment: 'sea',
    })
    expect(rosterDay(barber, '2026-11-17', list)).toMatchObject({
      status: 'work',
      override: true,
      location: 'locB',
      start: '12:00',
      end: '20:00',
    })
  })
})

describe('planClear', () => {
  const list = [
    exception('inside', '2026-11-03', '2026-11-04'),
    exception('left', '2026-10-30', '2026-11-01', 'vacation'),
    exception('right', '2026-11-29', '2026-12-02', 'sick'),
    exception('around', '2026-11-10', '2026-11-12', 'custom_hours', {
      start: '10:00',
      end: '12:00',
    }),
    exception('outside', '2026-12-10', '2026-12-11'),
  ]

  it('removes, shrinks and splits exceptions around the cleared dates', () => {
    const plan = planClear(list, [
      '2026-11-01',
      '2026-11-03',
      '2026-11-04',
      '2026-11-11',
      '2026-11-29',
      '2026-11-30',
    ])
    expect(plan.remove).toEqual(['inside'])
    expect(plan.update).toEqual([
      { id: 'left', dateFrom: '2026-10-30', dateTo: '2026-10-31' },
      { id: 'right', dateFrom: '2026-12-01', dateTo: '2026-12-02' },
      { id: 'around', dateFrom: '2026-11-10', dateTo: '2026-11-10' },
    ])
    expect(plan.create).toEqual([
      {
        dateFrom: '2026-11-12',
        dateTo: '2026-11-12',
        kind: 'custom_hours',
        start: '10:00',
        end: '12:00',
        comment: null,
      },
    ])
  })

  it('does nothing when no exception touches the dates', () => {
    expect(planClear(list, ['2026-11-20'])).toEqual({ remove: [], update: [], create: [] })
  })
})

describe('planDays', () => {
  it('a vacation over a week: one exception per run of consecutive dates', () => {
    const plan = planDays(barber, [], ['2026-11-16', '2026-11-17', '2026-11-19'], {
      kind: 'vacation',
    })
    expect(plan.create).toEqual([
      { dateFrom: '2026-11-16', dateTo: '2026-11-17', kind: 'vacation', comment: null },
      { dateFrom: '2026-11-19', dateTo: '2026-11-19', kind: 'vacation', comment: null },
    ])
  })

  it('replaces the overrides of the edited dates', () => {
    const list = [exception('v', '2026-11-16', '2026-11-20', 'vacation')]
    const plan = planDays(barber, list, ['2026-11-18'], {
      kind: 'custom_hours',
      location: 'locA',
      start: '11:00',
      end: '15:00',
    })
    expect(plan.update).toEqual([{ id: 'v', dateFrom: '2026-11-16', dateTo: '2026-11-17' }])
    expect(plan.create).toEqual([
      { dateFrom: '2026-11-19', dateTo: '2026-11-20', kind: 'vacation', comment: null },
      {
        dateFrom: '2026-11-18',
        dateTo: '2026-11-18',
        kind: 'custom_hours',
        location: 'locA',
        start: '11:00',
        end: '15:00',
        breaks: [],
        comment: null,
      },
    ])
  })

  it('a value equal to the pattern needs no exception (the day just follows the pattern)', () => {
    const value = {
      kind: 'custom_hours' as const,
      location: 'locA',
      start: '09:00',
      end: '18:00',
      breaks: [{ start: '13:00', end: '14:00' }],
    }
    expect(matchesPattern(barber, '2026-11-16', value)).toBe(true)
    expect(matchesPattern(barber, '2026-11-16', { ...value, breaks: [] })).toBe(false)
    expect(matchesPattern(barber, '2026-11-16', { ...value, comment: 'note' })).toBe(false)
    expect(matchesPattern(barber, '2026-11-18', { kind: 'day_off' })).toBe(true)
    expect(matchesPattern(barber, '2026-11-16', { kind: 'day_off' })).toBe(false)

    const list = [exception('d', '2026-11-16', '2026-11-16')]
    expect(planDays(barber, list, ['2026-11-16'], value)).toEqual({
      remove: ['d'],
      update: [],
      create: [],
    })
    expect(planDays(barber, list, ['2026-11-16'], { kind: 'pattern' })).toEqual({
      remove: ['d'],
      update: [],
      create: [],
    })
  })
})

describe('planFill', () => {
  const list = [
    exception('off', '2026-11-02', '2026-11-02'),
    exception('vac', '2026-11-09', '2026-11-13', 'vacation'),
    exception('hours', '2026-10-28', '2026-11-03', 'custom_hours', {
      start: '10:00',
      end: '14:00',
    }),
  ]
  const november = Array.from({ length: 30 }, (_, i) => `2026-11-${String(i + 1).padStart(2, '0')}`)

  it('removes manual changes of the period, keeps vacations and sick leaves by default', () => {
    expect(planFill(list, november)).toEqual({
      remove: ['off'],
      update: [{ id: 'hours', dateFrom: '2026-10-28', dateTo: '2026-10-31' }],
      create: [],
    })
  })

  it('clears absences too when asked', () => {
    expect(planFill(list, november, false).remove).toEqual(['off', 'vac'])
  })
})
