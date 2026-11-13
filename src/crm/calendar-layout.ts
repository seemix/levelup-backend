/**
 * Pure layout helpers of the calendar grid (spec §9, A1). No DOM, no database.
 *
 * Positions are measured in *elapsed minutes since the local midnight* of the shown date
 * (`localDayRange(date).start`), so they stay correct on DST days (23/25-hour days).
 * `toLocalTime` turns an offset back into a wall-clock label.
 */
import {
  SLOT_STEP_MINUTES,
  addMinutes,
  localDayMinutes,
  localDayRange,
  minutesBetween,
  toLocalTime,
} from './time'

export type IsoInterval = { start: string; end: string }

/** Minutes from the local midnight of `date` to `instant` (not clamped). */
export const minutesFromDayStart = (date: string, instant: Date | string): number =>
  minutesBetween(localDayRange(date).start, new Date(instant))

/** Wall-clock `HH:mm` of an offset from the local midnight of `date`. */
export const offsetToLabel = (date: string, offset: number): string =>
  toLocalTime(addMinutes(localDayRange(date).start, offset))

export type GridRow = {
  /** Minutes from the day start. */
  offset: number
  /** Wall-clock label (`HH:mm`). */
  label: string
  /** The row starts a full hour (draws the stronger line and the time label). */
  hour: boolean
}

/** Grid rows (`step` minutes) of the visible range `[from, to)`, offsets from the day start. */
export const gridRows = (
  date: string,
  from: number,
  to: number,
  step: number = SLOT_STEP_MINUTES,
): GridRow[] => {
  const rows: GridRow[] = []
  for (let offset = from; offset < to; offset += step) {
    const label = offsetToLabel(date, offset)
    rows.push({ offset, label, hour: label.endsWith(':00') })
  }
  return rows
}

export type BlockPosition = { top: number; height: number }

/**
 * Vertical position (px) of an interval inside the visible range, clipped to it.
 * `null` when the interval is entirely outside. A minimum height keeps tiny blocks clickable.
 */
export const blockPosition = (
  date: string,
  interval: IsoInterval,
  range: { from: number; to: number },
  pxPerMinute: number,
  minHeight = 0,
): BlockPosition | null => {
  const start = Math.max(minutesFromDayStart(date, interval.start), range.from)
  const end = Math.min(minutesFromDayStart(date, interval.end), range.to)
  if (end <= start) return null
  return {
    top: (start - range.from) * pxPerMinute,
    height: Math.max((end - start) * pxPerMinute, minHeight),
  }
}

/** Hatched (non-working) parts of a column: the complement of the working intervals in the range. */
export const offHoursSegments = (
  date: string,
  intervals: readonly IsoInterval[],
  range: { from: number; to: number },
  pxPerMinute: number,
): BlockPosition[] => {
  const working = intervals
    .map((item) => ({
      start: Math.max(minutesFromDayStart(date, item.start), range.from),
      end: Math.min(minutesFromDayStart(date, item.end), range.to),
    }))
    .filter((item) => item.end > item.start)
    .sort((a, b) => a.start - b.start)
  const segments: BlockPosition[] = []
  let cursor = range.from
  const push = (from: number, to: number) => {
    if (to > from)
      segments.push({ top: (from - range.from) * pxPerMinute, height: (to - from) * pxPerMinute })
  }
  for (const item of working) {
    push(cursor, item.start)
    cursor = Math.max(cursor, item.end)
  }
  push(cursor, range.to)
  return segments
}

/** Position (px) of the "now" line, `null` if `now` is not on the shown date or outside the range. */
export const nowLinePosition = (
  date: string,
  now: Date,
  range: { from: number; to: number },
  pxPerMinute: number,
): number | null => {
  const offset = minutesFromDayStart(date, now)
  if (offset < 0 || offset >= localDayMinutes(date)) return null
  if (offset < range.from || offset > range.to) return null
  return (offset - range.from) * pxPerMinute
}

const DEFAULT_RANGE = { from: 9 * 60, to: 20 * 60 }

/**
 * Visible range of the day, whole hours: covers working intervals and appointments of all columns
 * with one hour of margin; a fixed default when the day is empty.
 */
export const visibleRange = (
  date: string,
  intervals: readonly IsoInterval[],
  margin = 60,
): { from: number; to: number } => {
  const dayMinutes = localDayMinutes(date)
  if (intervals.length === 0)
    return { ...DEFAULT_RANGE, to: Math.min(DEFAULT_RANGE.to, dayMinutes) }
  let from = Infinity
  let to = -Infinity
  for (const item of intervals) {
    from = Math.min(from, minutesFromDayStart(date, item.start))
    to = Math.max(to, minutesFromDayStart(date, item.end))
  }
  from = Math.max(0, Math.floor((from - margin) / 60) * 60)
  to = Math.min(dayMinutes, Math.ceil((to + margin) / 60) * 60)
  return { from, to }
}

export type Lane = { lane: number; lanes: number }

/** Side-by-side lanes for overlapping intervals of one column (start-sorted greedy packing). */
export const assignLanes = (items: readonly { start: number; end: number }[]): Lane[] => {
  const order = items.map((_, index) => index).sort((a, b) => items[a].start - items[b].start)
  const result: Lane[] = items.map(() => ({ lane: 0, lanes: 1 }))
  let group: number[] = []
  let groupEnd = -Infinity
  let laneEnds: number[] = []
  const flush = () => {
    for (const index of group) result[index].lanes = laneEnds.length
    group = []
    laneEnds = []
  }
  for (const index of order) {
    const { start, end } = items[index]
    if (start >= groupEnd) {
      flush()
      groupEnd = -Infinity
    }
    let lane = laneEnds.findIndex((laneEnd) => laneEnd <= start)
    if (lane === -1) lane = laneEnds.length
    laneEnds[lane] = end
    result[index].lane = lane
    group.push(index)
    groupEnd = Math.max(groupEnd, end)
  }
  flush()
  return result
}

/** `#000`/`#fff` — whichever reads better on the given `#RRGGBB` background. */
export const readableTextColor = (hex: string): '#000000' | '#ffffff' => {
  const value = /^#[0-9a-f]{6}$/i.test(hex) ? hex.slice(1) : '808080'
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16) / 255)
  const channel = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  const luminance = 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
  return luminance > 0.4 ? '#000000' : '#ffffff'
}
