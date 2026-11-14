/**
 * Client report (spec §8 «Клієнти», A37). Pure functions: parameters, search, row shaping, CSV.
 * The aggregation itself lives in `client-report.service.ts`.
 */
import { baniToLeiText } from './money'
import { toLocalDate } from './time'

/** Statuses that count as a visit (spec §8). */
export const VISIT_STATUSES = ['completed', 'paid'] as const

export const CLIENT_REPORT_SORTS = [
  'name',
  'visits',
  'lastVisit',
  'avgCheck',
  'cancelledByClient',
  'cancelledBySalon',
  'noShows',
] as const
export type ClientReportSort = (typeof CLIENT_REPORT_SORTS)[number]

export const CLIENT_REPORT_PAGE_SIZE = 30
export const CLIENT_REPORT_MAX_PAGE_SIZE = 100
/** CSV export is capped, so one request cannot read the whole database. */
export const CLIENT_REPORT_CSV_LIMIT = 10_000
export const CLIENT_REPORT_SEARCH_MAX = 64

/** Statistics of one client over the filtered appointments. Money in bani. */
export type ClientStats = {
  visits: number
  /** ISO instant of the latest visit or `null`. */
  lastVisit: string | null
  /** Average `total` of paid visits, rounded to bani; `null` without paid visits. */
  avgCheck: number | null
  cancelledByClient: number
  cancelledBySalon: number
  noShows: number
}

export type ClientReportRow = ClientStats & {
  id: string
  firstName: string
  lastName: string | null
  phone: string
  blocked: boolean
}

export const emptyStats = (): ClientStats => ({
  visits: 0,
  lastVisit: null,
  avgCheck: null,
  cancelledByClient: 0,
  cancelledBySalon: 0,
  noShows: 0,
})

export const escapeRegex = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Search by name or phone → regex sources (lower-case matching is done by the `i` flag).
 * Name: any part of «first last». Phone: the digits typed, without the national `0` / `373` prefix
 * (`069 123` finds `+37369123456`); fewer than three digits do not search by phone.
 */
export const searchPatterns = (raw: string): { name: string; phone: string | null } | null => {
  const text = raw.trim().replace(/\s+/g, ' ')
  if (text === '') return null
  let digits = text.replace(/\D/g, '')
  if (digits.startsWith('373')) digits = digits.slice(3)
  else if (digits.startsWith('0')) digits = digits.slice(1)
  return {
    name: escapeRegex(text),
    phone: digits.length >= 3 && /^[\d\s+()-]+$/.test(text) ? escapeRegex(digits) : null,
  }
}

/** Mongo shape of one aggregated row (see the service). */
export type RawReportRow = {
  _id: unknown
  firstName?: string | null
  lastName?: string | null
  phone?: string | null
  blocked?: boolean | null
  visits?: number | null
  lastVisit?: Date | string | null
  avgCheck?: number | null
  cancelledByClient?: number | null
  cancelledBySalon?: number | null
  noShows?: number | null
}

export const toStats = (raw: Partial<RawReportRow>): ClientStats => ({
  visits: raw.visits ?? 0,
  lastVisit: raw.lastVisit ? new Date(raw.lastVisit).toISOString() : null,
  avgCheck: typeof raw.avgCheck === 'number' ? Math.round(raw.avgCheck) : null,
  cancelledByClient: raw.cancelledByClient ?? 0,
  cancelledBySalon: raw.cancelledBySalon ?? 0,
  noShows: raw.noShows ?? 0,
})

export const toReportRow = (raw: RawReportRow): ClientReportRow => ({
  id: String(raw._id),
  firstName: raw.firstName ?? '',
  lastName: raw.lastName ?? null,
  phone: raw.phone ?? '',
  blocked: raw.blocked === true,
  ...toStats(raw),
})

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/** Semicolon: the separator Excel expects in the ru/ro locales (A37). */
export const CSV_SEPARATOR = ';'

/**
 * One CSV cell. Quotes cells with separator/quote/newline; free text starting with `= + - @` (or a tab /
 * CR) is prefixed with `'` so a spreadsheet never evaluates it as a formula.
 */
export const csvCell = (value: string | number | null | undefined, text = false): string => {
  let cell = value === null || value === undefined ? '' : String(value)
  if (text && /^[=+\-@\t\r]/.test(cell)) cell = `'${cell}`
  return /[";\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell
}

export type CsvLabels = {
  client: string
  phone: string
  visits: string
  lastVisit: string
  avgCheck: string
  cancelledByClient: string
  cancelledBySalon: string
  noShows: string
}

/** UTF-8 BOM first: Excel opens the file in the right encoding. Rows end with CRLF. */
export const clientsToCsv = (rows: readonly ClientReportRow[], labels: CsvLabels): string => {
  const line = (cells: string[]) => cells.join(CSV_SEPARATOR)
  const lines = [
    line(
      [
        labels.client,
        labels.phone,
        labels.visits,
        labels.lastVisit,
        labels.avgCheck,
        labels.cancelledByClient,
        labels.cancelledBySalon,
        labels.noShows,
      ].map((label) => csvCell(label)),
    ),
    ...rows.map((row) =>
      line([
        csvCell([row.firstName, row.lastName].filter(Boolean).join(' '), true),
        csvCell(row.phone),
        csvCell(row.visits),
        csvCell(row.lastVisit ? toLocalDate(new Date(row.lastVisit)) : ''),
        csvCell(row.avgCheck === null ? '' : baniToLeiText(row.avgCheck)),
        csvCell(row.cancelledByClient),
        csvCell(row.cancelledBySalon),
        csvCell(row.noShows),
      ]),
    ),
  ]
  return `﻿${lines.join('\r\n')}\r\n`
}
