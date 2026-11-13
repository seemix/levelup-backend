import { describe, expect, it } from 'vitest'

import {
  assignLanes,
  blockPosition,
  gridRows,
  minutesFromDayStart,
  nowLinePosition,
  offHoursSegments,
  offsetToLabel,
  readableTextColor,
  visibleRange,
} from '@/crm/calendar-layout'
import { localToInstant } from '@/crm/time'

const DATE = '2026-11-21'
const at = (time: string, date = DATE) => localToInstant(date, time).toISOString()
const PX = 2

describe('calendar layout helpers', () => {
  it('converts instants to minutes from the local midnight', () => {
    expect(minutesFromDayStart(DATE, at('09:00'))).toBe(540)
    expect(minutesFromDayStart(DATE, at('00:00'))).toBe(0)
    expect(minutesFromDayStart(DATE, at('09:00', '2026-11-22'))).toBe(1440 + 540)
  })

  it('keeps wall-clock labels on DST days (2026-03-29: 03:00 → 04:00)', () => {
    const date = '2026-03-29'
    // 05:00 local is only 4 elapsed hours after midnight.
    expect(minutesFromDayStart(date, at('05:00', date))).toBe(4 * 60)
    expect(offsetToLabel(date, 4 * 60)).toBe('05:00')
  })

  it('builds grid rows of 15 minutes with hour marks', () => {
    const rows = gridRows(DATE, 9 * 60, 10 * 60)
    expect(rows.map((row) => row.label)).toEqual(['09:00', '09:15', '09:30', '09:45'])
    expect(rows.map((row) => row.hour)).toEqual([true, false, false, false])
    expect(rows[1].offset).toBe(9 * 60 + 15)
  })

  it('positions blocks and clips them to the visible range', () => {
    const range = { from: 9 * 60, to: 14 * 60 }
    expect(blockPosition(DATE, { start: at('11:00'), end: at('12:00') }, range, PX)).toEqual({
      top: 240,
      height: 120,
    })
    expect(blockPosition(DATE, { start: at('08:00'), end: at('09:30') }, range, PX)).toEqual({
      top: 0,
      height: 60,
    })
    expect(blockPosition(DATE, { start: at('15:00'), end: at('16:00') }, range, PX)).toBeNull()
    expect(
      blockPosition(DATE, { start: at('10:00'), end: at('10:05') }, range, PX, 22)?.height,
    ).toBe(22)
  })

  it('returns hatched segments as the complement of the working intervals', () => {
    const range = { from: 9 * 60, to: 14 * 60 }
    const working = [
      { start: at('10:00'), end: at('12:00') },
      { start: at('12:30'), end: at('13:00') },
    ]
    expect(offHoursSegments(DATE, working, range, PX)).toEqual([
      { top: 0, height: 120 },
      { top: 360, height: 60 },
      { top: 480, height: 120 },
    ])
    expect(offHoursSegments(DATE, [], range, PX)).toEqual([{ top: 0, height: 600 }])
  })

  it('places the "now" line only inside the range of the shown date', () => {
    const range = { from: 9 * 60, to: 14 * 60 }
    expect(nowLinePosition(DATE, new Date(at('09:44')), range, PX)).toBe(88)
    expect(nowLinePosition(DATE, new Date(at('08:00')), range, PX)).toBeNull()
    expect(nowLinePosition(DATE, new Date(at('10:00', '2026-11-22')), range, PX)).toBeNull()
  })

  it('computes the visible range from content with a margin, in whole hours', () => {
    expect(visibleRange(DATE, [])).toEqual({ from: 540, to: 1200 })
    expect(visibleRange(DATE, [{ start: at('09:30'), end: at('18:15') }])).toEqual({
      from: 8 * 60,
      to: 20 * 60,
    })
    expect(visibleRange(DATE, [{ start: at('00:10'), end: at('23:50') }])).toEqual({
      from: 0,
      to: 1440,
    })
  })

  it('assigns lanes to overlapping blocks', () => {
    expect(
      assignLanes([
        { start: 600, end: 660 },
        { start: 630, end: 690 },
        { start: 700, end: 760 },
      ]),
    ).toEqual([
      { lane: 0, lanes: 2 },
      { lane: 1, lanes: 2 },
      { lane: 0, lanes: 1 },
    ])
  })

  it('picks a readable text color', () => {
    expect(readableTextColor('#FFFF00')).toBe('#000000')
    expect(readableTextColor('#1E3A8A')).toBe('#ffffff')
    expect(readableTextColor('bad')).toMatch(/^#/)
  })
})
