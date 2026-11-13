/**
 * Barber working time (spec §4.4, §4.5, §5.2). Pure functions, no database access.
 * Dates are local `YYYY-MM-DD`, hours are local `HH:mm` (Europe/Chisinau); instants come out as UTC `Date`.
 */
import { isLocalDate, isLocalTime, isoWeekday, localToInstant, minutesToTime, timeToMinutes } from './time'

export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const
export type Weekday = (typeof WEEKDAYS)[number]

export const EXCEPTION_KINDS = ['day_off', 'vacation', 'sick', 'custom_hours'] as const
export type ExceptionKind = (typeof EXCEPTION_KINDS)[number]

/** Kinds that make the whole day non-working. */
export const DAY_OFF_KINDS: readonly ExceptionKind[] = ['day_off', 'vacation', 'sick']

type Id = string | number
/** A relationship as stored (`id`) or populated (`{ id }`). */
export type RelationValue = Id | { id: Id } | null | undefined

export const relationId = (value: RelationValue): string | null => {
  if (value === null || value === undefined || value === '') return null
  return typeof value === 'object' ? String(value.id) : String(value)
}

export type TimeRange = { start?: string | null; end?: string | null }

export type DaySchedule = {
  start: string
  end: string
  breaks?: TimeRange[] | null
}

export type WeeklyScheduleRow = DaySchedule & {
  weekday: number
  location: RelationValue
}

export type ScheduleException = {
  dateFrom: string
  dateTo: string
  kind: ExceptionKind
  location?: RelationValue
  start?: string | null
  end?: string | null
  breaks?: TimeRange[] | null
}

export type BarberSchedule = {
  weeklySchedule?: readonly WeeklyScheduleRow[] | null
  /** Barber locations; used as a fallback when a `custom_hours` exception has no location of its own. */
  locations?: readonly RelationValue[] | null
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type ScheduleError =
  | 'TIME_INVALID'
  | 'END_BEFORE_START'
  | 'BREAK_INVALID'
  | 'BREAK_OUTSIDE'
  | 'BREAKS_OVERLAP'
  | 'WEEKDAY_INVALID'
  | 'WEEKDAY_DUPLICATE'
  | 'LOCATION_NOT_ALLOWED'
  | 'DATE_INVALID'
  | 'DATE_RANGE_INVALID'

type Minutes = { start: number; end: number }

const toMinutes = (range: TimeRange): Minutes | null =>
  range.start && range.end && isLocalTime(range.start) && isLocalTime(range.end)
    ? { start: timeToMinutes(range.start), end: timeToMinutes(range.end) }
    : null

/** Working interval of a day: `start < end`. */
export const validateDayInterval = (range: TimeRange): ScheduleError | null => {
  const minutes = toMinutes(range)
  if (!minutes) return 'TIME_INVALID'
  return minutes.start < minutes.end ? null : 'END_BEFORE_START'
}

/** Breaks: each `start < end`, inside the working interval, no overlaps (touching is fine). */
export const validateBreaks = (
  day: TimeRange,
  breaks: readonly TimeRange[] | null | undefined,
): ScheduleError | null => {
  const work = toMinutes(day)
  const list: Minutes[] = []
  for (const item of breaks ?? []) {
    const minutes = toMinutes(item)
    if (!minutes || minutes.start >= minutes.end) return 'BREAK_INVALID'
    list.push(minutes)
  }
  if (!work) return null // the day interval reports its own error
  if (list.some((b) => b.start < work.start || b.end > work.end)) return 'BREAK_OUTSIDE'
  const sorted = [...list].sort((a, b) => a.start - b.start)
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].start < sorted[i - 1].end) return 'BREAKS_OVERLAP'
  }
  return null
}

/** Full check of a weekly template (spec §4.4): ≤ 7 rows, unique weekday 1–7, valid hours, location ∈ locations. */
export const validateWeeklySchedule = (
  rows: readonly Partial<WeeklyScheduleRow>[] | null | undefined,
  locations: readonly RelationValue[] | null | undefined,
): ScheduleError | null => {
  const allowedLocations = new Set((locations ?? []).map(relationId).filter(Boolean))
  const seen = new Set<number>()
  for (const row of rows ?? []) {
    const weekday = Number(row.weekday)
    if (!(WEEKDAYS as readonly number[]).includes(weekday)) return 'WEEKDAY_INVALID'
    if (seen.has(weekday)) return 'WEEKDAY_DUPLICATE'
    seen.add(weekday)
    const error = validateDayInterval(row) ?? validateBreaks(row, row.breaks)
    if (error) return error
    const location = relationId(row.location)
    if (!location || !allowedLocations.has(location)) return 'LOCATION_NOT_ALLOWED'
  }
  return null
}

export const validateDateRange = (dateFrom: unknown, dateTo: unknown): ScheduleError | null => {
  if (typeof dateFrom !== 'string' || typeof dateTo !== 'string') return 'DATE_INVALID'
  if (!isLocalDate(dateFrom) || !isLocalDate(dateTo)) return 'DATE_INVALID'
  return dateFrom <= dateTo ? null : 'DATE_RANGE_INVALID'
}

/** Inclusive date ranges overlap (`YYYY-MM-DD` compares lexicographically). */
export const dateRangesOverlap = (
  a: { dateFrom: string; dateTo: string },
  b: { dateFrom: string; dateTo: string },
): boolean => a.dateFrom <= b.dateTo && b.dateFrom <= a.dateTo

export const exceptionCovers = (exception: ScheduleException, date: string): boolean =>
  exception.dateFrom <= date && date <= exception.dateTo

// ---------------------------------------------------------------------------
// Working time on a date (spec §5.2)
// ---------------------------------------------------------------------------

export type WorkingInterval = {
  /** Local `HH:mm`. */
  startTime: string
  endTime: string
  /** UTC instants (DST-aware). */
  start: Date
  end: Date
}

export type WorkingDay =
  | {
      working: false
      /** Why the day is off: no template row for this weekday, or the exception kind. */
      reason: 'no_schedule' | 'day_off' | 'vacation' | 'sick'
      source: 'weekly' | 'exception'
    }
  | {
      working: true
      source: 'weekly' | 'exception'
      /** Location of the day: from the exception, otherwise from the template (spec §5.2 p.3). */
      locationId: string | null
      intervals: WorkingInterval[]
    }

/** [start, end] minus breaks, as sorted non-empty minute ranges. */
export const subtractBreaks = (
  day: Minutes,
  breaks: readonly TimeRange[] | null | undefined,
): Minutes[] => {
  const cuts = (breaks ?? [])
    .map(toMinutes)
    .filter((b): b is Minutes => b !== null && b.start < b.end)
    .sort((a, b) => a.start - b.start)
  const result: Minutes[] = []
  let cursor = day.start
  for (const cut of cuts) {
    const from = Math.max(cut.start, day.start)
    const to = Math.min(cut.end, day.end)
    if (to <= from) continue
    if (from > cursor) result.push({ start: cursor, end: from })
    cursor = Math.max(cursor, to)
  }
  if (cursor < day.end) result.push({ start: cursor, end: day.end })
  return result
}

const toIntervals = (date: string, day: DaySchedule): WorkingInterval[] => {
  const minutes = toMinutes(day)
  if (!minutes || minutes.start >= minutes.end) return []
  return subtractBreaks(minutes, day.breaks).map(({ start, end }) => {
    const startTime = minutesToTime(start)
    const endTime = minutesToTime(end)
    return {
      startTime,
      endTime,
      start: localToInstant(date, startTime),
      end: localToInstant(date, endTime),
    }
  })
}

/**
 * Working intervals of a barber on a local date (spec §5.2).
 * `exceptions` are the barber's schedule exceptions (any range; the one covering `date` is used).
 */
export const getWorkingIntervals = (
  barber: BarberSchedule,
  date: string,
  exceptions: readonly ScheduleException[] = [],
): WorkingDay => {
  if (!isLocalDate(date)) throw new RangeError(`Invalid date: ${date}`)
  const weekday = isoWeekday(date)
  const templateRow = (barber.weeklySchedule ?? []).find((row) => Number(row.weekday) === weekday)

  // Exceptions never overlap (enforced on write); if they somehow do, the first one wins.
  const exception = exceptions.find((item) => exceptionCovers(item, date))
  if (exception) {
    if (exception.kind !== 'custom_hours') {
      return { working: false, reason: exception.kind, source: 'exception' }
    }
    const day: DaySchedule = {
      start: exception.start ?? '',
      end: exception.end ?? '',
      breaks: exception.breaks,
    }
    const locations = (barber.locations ?? []).map(relationId).filter(Boolean)
    const locationId =
      relationId(exception.location) ??
      relationId(templateRow?.location) ??
      (locations.length === 1 ? locations[0] : null)
    return { working: true, source: 'exception', locationId, intervals: toIntervals(date, day) }
  }

  if (!templateRow) return { working: false, reason: 'no_schedule', source: 'weekly' }
  return {
    working: true,
    source: 'weekly',
    locationId: relationId(templateRow.location),
    intervals: toIntervals(date, templateRow),
  }
}
