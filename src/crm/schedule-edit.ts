/**
 * Schedule roster and day editing (spec A44). Pure functions, no database access.
 *
 * The model stays «weekly pattern + exceptions» (§4.4, §4.5, §5.2): a day follows the barber's weekly
 * pattern unless a schedule exception covers it. Editing days in the roster turns into a plan of
 * exception changes (delete, shrink, split, create) that keeps exceptions of one barber disjoint;
 * «fill by pattern» removes the overrides of a period so the weekly pattern applies again.
 */
import {
  exceptionCovers,
  relationId,
  type BarberSchedule,
  type ExceptionKind,
  type ScheduleException,
  type TimeRange,
} from './schedule'
import { addLocalDays, eachLocalDate, isLocalDate, isoWeekday, isLocalTime } from './time'

/** An exception as stored: with its id and comment. */
export type StoredException = ScheduleException & { id: string; comment?: string | null }

/** What a day of the roster shows. `work`/`off` without `override` come from the weekly pattern. */
export type RosterStatus = 'work' | 'off' | 'day_off' | 'vacation' | 'sick'

export type RosterDay = {
  date: string
  status: RosterStatus
  /** The day is set by a schedule exception, not by the weekly pattern. */
  override: boolean
  exceptionId: string | null
  location: string | null
  start: string | null
  end: string | null
  breaks: { start: string; end: string }[]
  comment: string | null
}

/** New value of edited days. `pattern` removes the overrides: the weekly pattern applies again. */
export type DayValue =
  | { kind: 'pattern' }
  | { kind: 'day_off' | 'vacation' | 'sick'; comment?: string | null }
  | {
      kind: 'custom_hours'
      location: string
      start: string
      end: string
      breaks?: TimeRange[] | null
      comment?: string | null
    }

export const DAY_VALUE_KINDS = ['pattern', 'custom_hours', 'day_off', 'vacation', 'sick'] as const
export type DayValueKind = (typeof DAY_VALUE_KINDS)[number]

/** Absences kept by «fill by pattern» unless asked otherwise. */
export const ABSENCE_KINDS: readonly ExceptionKind[] = ['vacation', 'sick']

/**
 * `req.context` flag of a roster edit: the overlap check of `schedule-exceptions` reads committed
 * data (outside the transaction), so it would see the exceptions the plan is replacing. The plan
 * keeps exceptions disjoint itself (computed from data read inside the transaction, under a lock).
 */
export const SCHEDULE_EDIT_CONTEXT = 'scheduleEdit'

/** A new exception (without id). */
export type ExceptionDraft = Omit<StoredException, 'id'>

/** Changes to apply to `schedule-exceptions` (in this order: remove, update, create). */
export type ExceptionPlan = {
  remove: string[]
  update: { id: string; dateFrom: string; dateTo: string }[]
  create: ExceptionDraft[]
}

const cleanBreaks = (breaks: readonly TimeRange[] | null | undefined) =>
  (breaks ?? [])
    .filter((item): item is { start: string; end: string } => !!item.start && !!item.end)
    .map(({ start, end }) => ({ start, end }))
    .sort((a, b) => a.start.localeCompare(b.start))

// ---------------------------------------------------------------------------
// Month and date helpers
// ---------------------------------------------------------------------------

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/

export const isMonth = (value: string): boolean => MONTH_RE.test(value)

/** `YYYY-MM` → first and last local date of the month. */
export const monthRange = (month: string): { from: string; to: string } => {
  if (!isMonth(month)) throw new RangeError(`Invalid month: ${month}`)
  const from = `${month}-01`
  const [y, m] = month.split('-').map(Number)
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
  return { from, to: addLocalDays(next, -1) }
}

/** Sorted unique dates grouped into inclusive runs of consecutive days. */
export const contiguousRuns = (
  dates: readonly string[],
): { dateFrom: string; dateTo: string }[] => {
  const sorted = [...new Set(dates)].sort()
  const runs: { dateFrom: string; dateTo: string }[] = []
  for (const date of sorted) {
    const last = runs[runs.length - 1]
    if (last && addLocalDays(last.dateTo, 1) === date) last.dateTo = date
    else runs.push({ dateFrom: date, dateTo: date })
  }
  return runs
}

// ---------------------------------------------------------------------------
// Roster
// ---------------------------------------------------------------------------

/** What the roster shows for a barber on a date (§5.2, without turning hours into instants). */
export const rosterDay = (
  barber: BarberSchedule,
  date: string,
  exceptions: readonly StoredException[],
): RosterDay => {
  const exception = exceptions.find((item) => exceptionCovers(item, date))
  if (exception) {
    const base = {
      date,
      override: true,
      exceptionId: exception.id,
      comment: exception.comment ?? null,
    }
    if (exception.kind !== 'custom_hours')
      return {
        ...base,
        status: exception.kind,
        location: null,
        start: null,
        end: null,
        breaks: [],
      }
    const templateRow = (barber.weeklySchedule ?? []).find(
      (row) => Number(row.weekday) === isoWeekday(date),
    )
    const locations = (barber.locations ?? []).map(relationId).filter(Boolean)
    return {
      ...base,
      status: 'work',
      location:
        relationId(exception.location) ??
        relationId(templateRow?.location) ??
        (locations.length === 1 ? locations[0] : null),
      start: exception.start ?? null,
      end: exception.end ?? null,
      breaks: cleanBreaks(exception.breaks),
    }
  }
  const row = (barber.weeklySchedule ?? []).find(
    (item) => Number(item.weekday) === isoWeekday(date),
  )
  if (!row)
    return {
      date,
      status: 'off',
      override: false,
      exceptionId: null,
      location: null,
      start: null,
      end: null,
      breaks: [],
      comment: null,
    }
  return {
    date,
    status: 'work',
    override: false,
    exceptionId: null,
    location: relationId(row.location),
    start: row.start,
    end: row.end,
    breaks: cleanBreaks(row.breaks),
    comment: null,
  }
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

/**
 * Frees `dates` from the given exceptions: an exception inside the dates is removed, one that
 * sticks out is shrunk to the part outside, and one with a hole in the middle is split in two
 * (the original keeps the first part, a copy gets the rest).
 */
export const planClear = (
  exceptions: readonly StoredException[],
  dates: readonly string[],
): ExceptionPlan => {
  const cleared = new Set(dates)
  const plan: ExceptionPlan = { remove: [], update: [], create: [] }
  for (const exception of exceptions) {
    const days = eachLocalDate(exception.dateFrom, exception.dateTo)
    if (!days.some((date) => cleared.has(date))) continue
    const rest = contiguousRuns(days.filter((date) => !cleared.has(date)))
    if (rest.length === 0) {
      plan.remove.push(exception.id)
      continue
    }
    const [first, ...others] = rest
    plan.update.push({ id: exception.id, ...first })
    const { id: _id, ...copy } = exception
    for (const run of others) plan.create.push({ ...copy, ...run })
  }
  return plan
}

/** Does the weekly pattern already give `value` on `date` (then no exception is needed)? */
export const matchesPattern = (barber: BarberSchedule, date: string, value: DayValue): boolean => {
  const row = (barber.weeklySchedule ?? []).find(
    (item) => Number(item.weekday) === isoWeekday(date),
  )
  if (value.kind === 'pattern') return true
  if (value.kind === 'day_off') return !row && !value.comment
  if (value.kind !== 'custom_hours' || !row || value.comment) return false
  return (
    relationId(row.location) === value.location &&
    row.start === value.start &&
    row.end === value.end &&
    JSON.stringify(cleanBreaks(row.breaks)) === JSON.stringify(cleanBreaks(value.breaks))
  )
}

/**
 * Sets `dates` of one barber to `value`: overrides of those dates are cleared, then one exception
 * per run of consecutive dates is created — except for dates where the weekly pattern already
 * gives the same day (they simply follow the pattern).
 */
export const planDays = (
  barber: BarberSchedule,
  exceptions: readonly StoredException[],
  dates: readonly string[],
  value: DayValue,
): ExceptionPlan => {
  const plan = planClear(exceptions, dates)
  if (value.kind === 'pattern') return plan
  const needed = dates.filter((date) => !matchesPattern(barber, date, value))
  for (const run of contiguousRuns(needed)) {
    const comment = value.comment?.trim() || null
    plan.create.push(
      value.kind === 'custom_hours'
        ? {
            ...run,
            kind: 'custom_hours',
            location: value.location,
            start: value.start,
            end: value.end,
            breaks: cleanBreaks(value.breaks),
            comment,
          }
        : { ...run, kind: value.kind, comment },
    )
  }
  return plan
}

/**
 * «Fill by pattern» for a period: overrides of the dates are removed, so the weekly pattern applies.
 * Vacations and sick leaves stay unless `keepAbsences` is `false`.
 */
export const planFill = (
  exceptions: readonly StoredException[],
  dates: readonly string[],
  keepAbsences = true,
): ExceptionPlan =>
  planClear(
    keepAbsences ? exceptions.filter((item) => !ABSENCE_KINDS.includes(item.kind)) : exceptions,
    dates,
  )

export const isPlanEmpty = (plan: ExceptionPlan): boolean =>
  plan.remove.length === 0 && plan.update.length === 0 && plan.create.length === 0

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

/** Parses a day value of the API; `null` = invalid shape (hours themselves are validated separately). */
export const parseDayValue = (body: Record<string, unknown>): DayValue | null => {
  const kind = body.kind
  const comment = typeof body.comment === 'string' ? body.comment : null
  if (kind === 'pattern') return { kind }
  if (kind === 'day_off' || kind === 'vacation' || kind === 'sick') return { kind, comment }
  if (kind !== 'custom_hours') return null
  const { location, start, end } = body
  if (typeof start !== 'string' || typeof end !== 'string') return null
  if (!isLocalTime(start) || !isLocalTime(end)) return null
  if (body.breaks !== undefined && body.breaks !== null && !Array.isArray(body.breaks)) return null
  const breaks = ((body.breaks as unknown[] | null | undefined) ?? []).map((item) => {
    const row = (item ?? {}) as { start?: unknown; end?: unknown }
    return {
      start: typeof row.start === 'string' ? row.start : '',
      end: typeof row.end === 'string' ? row.end : '',
    }
  })
  return {
    kind,
    location: typeof location === 'string' ? location : '',
    start,
    end,
    breaks,
    comment,
  }
}

/** A list of distinct valid local dates, at most `max`; `null` when invalid. */
export const parseDates = (value: unknown, max: number): string[] | null => {
  if (!Array.isArray(value) || value.length === 0) return null
  if (!value.every((item) => typeof item === 'string' && isLocalDate(item))) return null
  const dates = [...new Set(value as string[])].sort()
  return dates.length <= max ? dates : null
}
