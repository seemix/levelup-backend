import { describe, expect, it } from 'vitest'

import {
  moveBody,
  moveInColumns,
  movedStart,
  snapDeltaMinutes,
  snapDeltaPx,
} from '@/crm/calendar-move'
import { localToInstant } from '@/crm/time'

const at = (time: string, date = '2026-11-21') => localToInstant(date, time).toISOString()
const columns = [
  { barber: { id: 'b1' }, appointments: [{ id: 'a', start: at('10:00'), end: at('10:45') }] },
  { barber: { id: 'b2' }, appointments: [{ id: 'c', start: at('11:00'), end: at('12:00') }] },
]

describe('calendar drag-n-drop helpers', () => {
  it('snaps the vertical delta to the grid step', () => {
    expect(snapDeltaMinutes(0, 2, 15)).toBe(0)
    expect(snapDeltaMinutes(14, 2, 15)).toBe(0) // 7 min → stays
    expect(snapDeltaMinutes(16, 2, 15)).toBe(15) // 8 min → next step
    expect(snapDeltaMinutes(-46, 2, 15)).toBe(-30) // -23 min
    expect(Object.is(snapDeltaMinutes(-1, 2, 15), -0)).toBe(false)
    expect(snapDeltaPx(16, 2, 15)).toBe(30)
  })

  it('moves in time and keeps the duration', () => {
    const next = moveInColumns(columns, 'a', 'b1', 30)!
    expect(next[0].appointments[0]).toMatchObject({ start: at('10:30'), end: at('11:15') })
    expect(next[1]).toBe(columns[1])
  })

  it('moves between columns and does not mutate the input', () => {
    const next = moveInColumns(columns, 'a', 'b2', -15)!
    expect(next[0].appointments).toEqual([])
    expect(next[1].appointments.map((item) => item.id)).toEqual(['c', 'a'])
    expect(columns[0].appointments).toHaveLength(1)
  })

  it('returns null for no-op or unknown targets', () => {
    expect(moveInColumns(columns, 'a', 'b1', 0)).toBeNull()
    expect(moveInColumns(columns, 'zzz', 'b1', 15)).toBeNull()
    expect(moveInColumns(columns, 'a', 'nope', 15)).toBeNull()
    // same time but another barber is a move
    expect(moveInColumns(columns, 'a', 'b2', 0)).not.toBeNull()
  })

  it('builds the PATCH body: barber only when it changes, confirm on retry', () => {
    expect(moveBody({ start: at('10:00') }, 'b1', 'b1', 15)).toEqual({ start: at('10:15') })
    expect(moveBody({ start: at('10:00') }, 'b1', 'b2', 0, true)).toEqual({
      start: at('10:00'),
      barber: 'b2',
      confirm: true,
    })
  })

  it('week view: moves to another day of the same barber keeping the time and duration', () => {
    const week = [
      {
        barber: { id: 'b1' },
        date: '2026-11-21',
        appointments: [{ id: 'a', start: at('10:00'), end: at('10:45') }],
      },
      { barber: { id: 'b1' }, date: '2026-11-22', appointments: [] },
    ]
    // Same time, next day column.
    const next = moveInColumns(week, 'a', 'b1', 0, '2026-11-22')!
    expect(next[0].appointments).toEqual([])
    expect(next[1].appointments[0]).toMatchObject({
      start: at('10:00', '2026-11-22'),
      end: at('10:45', '2026-11-22'),
    })
    // Next day and 30 minutes later.
    expect(moveInColumns(week, 'a', 'b1', 30, '2026-11-22')![1].appointments[0].start).toBe(
      at('10:30', '2026-11-22'),
    )
    // Dropping into the own day column without a shift is not a move.
    expect(moveInColumns(week, 'a', 'b1', 0, '2026-11-21')).toBeNull()
    expect(moveInColumns(week, 'a', 'b1', 0, '2026-12-01')).toBeNull()
  })

  it('week view: the PATCH start is the same wall-clock position in the target day (DST too)', () => {
    expect(
      moveBody({ start: at('10:00') }, 'b1', 'b1', 15, false, {
        from: '2026-11-21',
        to: '2026-11-24',
      }),
    ).toEqual({ start: at('10:15', '2026-11-24') })
    // 2026-10-24 → 2026-10-25 (25-hour day): elapsed minutes from the midnight, as in the grid.
    const target = movedStart(at('01:00', '2026-10-24'), 0, {
      from: '2026-10-24',
      to: '2026-10-25',
    })
    expect(target.getTime()).toBe(localToInstant('2026-10-25', '00:00').getTime() + 60 * 60_000)
  })

  it('works across DST (instants, not wall-clock)', () => {
    const date = '2026-10-25' // 04:00 → 03:00
    const next = moveInColumns(
      [
        {
          barber: { id: 'b1' },
          appointments: [{ id: 'a', start: at('02:00', date), end: at('03:00', date) }],
        },
      ],
      'a',
      'b1',
      60,
    )!
    expect(
      new Date(next[0].appointments[0].start).getTime() - new Date(at('02:00', date)).getTime(),
    ).toBe(3_600_000)
  })
})
