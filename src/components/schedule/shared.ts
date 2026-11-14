import { isLocalTime, timeToMinutes } from '@/crm/time'
import { validateBreaks, validateDayInterval } from '@/crm/schedule'
import type { RosterBarber, RosterResponse } from '@/endpoints/crm/schedule'

export type { RosterBarber, RosterResponse }
export type RosterDay = RosterBarber['days'][number]

export type BreakRow = { start: string; end: string }

/** «10–19» / «10:30–19» — compact hours of a roster cell. */
export const shortHours = (start: string | null, end: string | null): string => {
  const part = (time: string | null) =>
    time ? time.replace(/^0(\d)/, '$1').replace(/:00$/, '') : '?'
  return `${part(start)}–${part(end)}`
}

/** Hours and breaks a user typed: the same rules the server applies (§4.4). */
export const hoursValid = (start: string, end: string, breaks: readonly BreakRow[]): boolean =>
  isLocalTime(start) &&
  isLocalTime(end) &&
  timeToMinutes(start) < timeToMinutes(end) &&
  validateDayInterval({ start, end }) === null &&
  validateBreaks({ start, end }, breaks) === null

/** Weekday names Monday…Sunday in the admin language (UTC dates: no zone shift). */
export const weekdayName = (weekday: number, language: string, width: 'short' | 'long') =>
  new Intl.DateTimeFormat(language, { timeZone: 'UTC', weekday: width }).format(
    // 2024-01-01 is a Monday.
    new Date(Date.UTC(2024, 0, weekday)),
  )

export const monthTitle = (month: string, language: string) =>
  new Intl.DateTimeFormat(language, { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(
    new Date(`${month}-15T12:00:00Z`),
  )

export const shiftMonth = (month: string, delta: number): string => {
  const [y, m] = month.split('-').map(Number)
  const index = y * 12 + (m - 1) + delta
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`
}

/** Short date «3 Nov» in the admin language. */
export const shortDate = (date: string, language: string) =>
  new Intl.DateTimeFormat(language, { timeZone: 'UTC', day: 'numeric', month: 'short' }).format(
    new Date(`${date}T12:00:00Z`),
  )
