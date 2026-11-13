/**
 * Time helpers. Instants are `Date` (UTC); schedule dates are `YYYY-MM-DD`
 * and hours are `HH:mm`, both in salon-local time (Europe/Chisinau, DST-aware).
 */
import { TZDate } from '@date-fns/tz'
import { addDays, format } from 'date-fns'

export const TIME_ZONE = 'Europe/Chisinau'
export const SLOT_STEP_MINUTES = 15

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

export const isLocalDate = (value: string): boolean => {
  const m = DATE_RE.exec(value)
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const probe = new Date(Date.UTC(y, mo - 1, d))
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === mo - 1 && probe.getUTCDate() === d
}

export const isLocalTime = (value: string): boolean => TIME_RE.test(value)

const parseDate = (date: string): [number, number, number] => {
  if (!isLocalDate(date)) throw new RangeError(`Invalid date: ${date}`)
  const m = DATE_RE.exec(date)!
  return [Number(m[1]), Number(m[2]) - 1, Number(m[3])]
}

/** "HH:mm" -> minutes since local midnight. */
export const timeToMinutes = (time: string): number => {
  const m = TIME_RE.exec(time)
  if (!m) throw new RangeError(`Invalid time: ${time}`)
  return Number(m[1]) * 60 + Number(m[2])
}

/** Minutes since local midnight -> "HH:mm" (0..1439). */
export const minutesToTime = (minutes: number): string => {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes >= 24 * 60) {
    throw new RangeError(`Minutes out of range: ${minutes}`)
  }
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

/** Local salon date + "HH:mm" -> UTC instant. Nonexistent (spring-forward gap) times shift forward. */
export const localToInstant = (date: string, time: string = '00:00'): Date => {
  const [y, mo, d] = parseDate(date)
  const minutes = timeToMinutes(time)
  return new Date(
    new TZDate(y, mo, d, Math.floor(minutes / 60), minutes % 60, 0, 0, TIME_ZONE).getTime(),
  )
}

/** UTC instant -> local salon date `YYYY-MM-DD`. */
export const toLocalDate = (instant: Date): string =>
  format(new TZDate(instant.getTime(), TIME_ZONE), 'yyyy-MM-dd')

/** UTC instant -> local salon time `HH:mm`. */
export const toLocalTime = (instant: Date): string =>
  format(new TZDate(instant.getTime(), TIME_ZONE), 'HH:mm')

/** Pure calendar arithmetic on `YYYY-MM-DD` strings (unaffected by DST). */
export const addLocalDays = (date: string, days: number): string => {
  const [y, mo, d] = parseDate(date)
  return format(addDays(new Date(Date.UTC(y, mo, d)), days), 'yyyy-MM-dd')
}

/** Start of the local day (inclusive) and start of the next one (exclusive), as UTC instants. */
export const localDayRange = (date: string): { start: Date; end: Date } => ({
  start: localToInstant(date),
  end: localToInstant(addLocalDays(date, 1)),
})

/** Real length of the local day in minutes (1380 / 1440 / 1500 on DST changes). */
export const localDayMinutes = (date: string): number => {
  const { start, end } = localDayRange(date)
  return Math.round((end.getTime() - start.getTime()) / 60_000)
}

/** Inclusive list of local dates between two dates. */
export const eachLocalDate = (from: string, to: string): string[] => {
  const dates: string[] = []
  for (let d = from; d <= to; d = addLocalDays(d, 1)) dates.push(d)
  return dates
}

/** ISO weekday of a local date: 1 = Monday ... 7 = Sunday. */
export const isoWeekday = (date: string): number => {
  const [y, mo, d] = parseDate(date)
  const day = new Date(Date.UTC(y, mo, d)).getUTCDay()
  return day === 0 ? 7 : day
}

export const todayLocal = (now: Date = new Date()): string => toLocalDate(now)

/** Rounds minutes up to the slot grid (default 15 min). */
export const ceilToGrid = (minutes: number, step: number = SLOT_STEP_MINUTES): number =>
  Math.ceil(minutes / step) * step

/** Grid of "HH:mm" labels for a local day between two times (end exclusive; "24:00" allowed). */
export const gridTimes = (
  from: string = '00:00',
  to: string = '24:00',
  step: number = SLOT_STEP_MINUTES,
): string[] => {
  const start = timeToMinutes(from)
  const end = to === '24:00' ? 24 * 60 : timeToMinutes(to)
  const times: string[] = []
  for (let m = start; m < end; m += step) times.push(minutesToTime(m))
  return times
}

/** Localized, human-readable date+time in the salon time zone. */
export const formatDateTime = (instant: Date, locale: string = 'ru'): string =>
  new Intl.DateTimeFormat(locale, {
    timeZone: TIME_ZONE,
    dateStyle: 'long',
    timeStyle: 'short',
  }).format(instant)
