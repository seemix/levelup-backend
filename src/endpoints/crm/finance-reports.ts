/**
 * Finance and salary reports (spec §8, §3.1, decision 35, A38):
 * - `GET /api/crm/reports/finance?from&to&location&barber[&format=csv]` — admin and manager (own
 *   locations); the profit block (with salaries) only for admin;
 * - `GET /api/crm/reports/salary?from&to&location&barber[&format=csv]` — admin (every barber) and a
 *   barber (their own only; another barber → 403); a manager gets 403.
 * `from`/`to` are required local days (inclusive, Europe/Chisinau), at most 731 days apart.
 */

import { allowed } from '@/access/policy'
import { financeToCsv, salaryToCsv, type ReportNames, type Translate } from '@/crm/finance-csv'
import { cashProfit } from '@/crm/finance-report'
import { runFinanceReport, runSalaryReport } from '@/crm/finance-report.service'
import { addLocalDays, isLocalDate } from '@/crm/time'
import { crmTranslations, type CrmKey } from '@/i18n'

import { InputErrors, isId, localeOf, ok, type Locale } from '../booking/http'
import { crmEndpoint, crmError } from './http'
import { allowedLocations, dayBounds } from './reports'

export const REPORT_MAX_DAYS = 731

export type PeriodQuery = {
  from: string
  to: string
  location: string | null
  barber: string | null
  csv: boolean
}

export const parsePeriodQuery = (params: URLSearchParams): PeriodQuery => {
  const errors = new InputErrors()
  const from = params.get('from') ?? ''
  const to = params.get('to') ?? ''
  if (!isLocalDate(from)) errors.add('from')
  if (!isLocalDate(to)) errors.add('to')
  if (isLocalDate(from) && isLocalDate(to))
    if (from > to || addLocalDays(from, REPORT_MAX_DAYS) < to) errors.add('to')
  const location = params.get('location') || null
  if (location && !isId(location)) errors.add('location')
  const barber = params.get('barber') || null
  if (barber && !isId(barber)) errors.add('barber')
  const format = params.get('format')
  if (format && format !== 'csv' && format !== 'json') errors.add('format')
  errors.throwIfAny()
  return { from, to, location, barber, csv: format === 'csv' }
}

const translator = (locale: Locale): Translate => {
  const dictionary = crmTranslations[locale].crm
  return (key: CrmKey) => dictionary[key] ?? key
}

const csvResponse = (body: string, name: string): Response =>
  new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'no-store',
    },
  })

const period = (query: PeriodQuery) => {
  const bounds = dayBounds(query.from, query.to)
  return { from: bounds.from as Date, to: bounds.to as Date }
}

export const financeReportEndpoint = crmEndpoint('get', '/reports/finance', async (req, staff) => {
  if (!allowed(req.user, 'read', 'reports.finance')) throw crmError('FORBIDDEN', 403)
  const query = parsePeriodQuery(req.searchParams)
  const locale = localeOf(req)
  const { report, salaryTotal, names } = await runFinanceReport(
    req,
    {
      ...period(query),
      locations: await allowedLocations(req, staff, query.location),
      barber: query.barber,
    },
    locale,
  )
  // Decision 35: a manager sees operational figures only — no salaries, no profit.
  const profit = allowed(req.user, 'read', 'reports.profit')
    ? cashProfit(report, salaryTotal)
    : null

  if (query.csv)
    return csvResponse(
      financeToCsv(report, names, translator(locale), profit),
      `finance_${query.from}_${query.to}.csv`,
    )
  return ok({ from: query.from, to: query.to, ...report, profit, names })
})

/** The barber whose salary is read: any (or the requested one) for admin, the own one for a barber. */
const salaryBarber = (
  staff: { isAdmin: boolean; barberId: string | null },
  requested: string | null,
): string | null => {
  if (staff.isAdmin) return requested
  if (!staff.barberId) throw crmError('FORBIDDEN', 403)
  if (requested && requested !== staff.barberId) throw crmError('FORBIDDEN', 403)
  return staff.barberId
}

export const salaryReportEndpoint = crmEndpoint('get', '/reports/salary', async (req, staff) => {
  if (!allowed(req.user, 'read', 'reports.salary')) throw crmError('FORBIDDEN', 403)
  const query = parsePeriodQuery(req.searchParams)
  const barber = salaryBarber(staff, query.barber)
  // Admin: every location or the requested one. A barber's own salary covers every location they
  // were paid in; the location only narrows it.
  const locations = staff.isAdmin
    ? await allowedLocations(req, staff, query.location)
    : query.location
      ? [query.location]
      : null
  const locale = localeOf(req)
  const salary = await runSalaryReport(req, { ...period(query), locations, barber }, locale)
  // Operation details only for one barber (the barber's own report or a filtered admin report).
  const items = barber ? salary.items : []

  if (query.csv)
    return csvResponse(
      salaryToCsv(salary, salary.names as ReportNames, translator(locale), Boolean(barber)),
      `salary_${query.from}_${query.to}.csv`,
    )
  return ok({
    from: query.from,
    to: query.to,
    barber,
    rows: salary.rows,
    totals: salary.totals,
    items: items.map((item) => ({ ...item, occurredAt: item.occurredAt.toISOString() })),
    names: salary.names,
  })
})
