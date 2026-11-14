/**
 * Client reports (spec §8 «Клієнти», §3.1, A37), admin and manager (a manager sees their locations only):
 * - `GET /api/crm/reports/clients?from&to&location&barber&q&sort&order&page&limit[&format=csv]`
 *   → `{ rows, total, page, limit }` or a CSV file (all matching rows, capped);
 * - `GET /api/crm/reports/clients/:id?page` → `{ client, stats, visits, page, hasNext }` — the card block.
 * `from`/`to` are local days (inclusive) filtering the appointment start.
 */
import type { PayloadRequest } from 'payload'

import { allowed, type StaffContext } from '@/access/policy'
import {
  CLIENT_REPORT_MAX_PAGE_SIZE,
  CLIENT_REPORT_PAGE_SIZE,
  CLIENT_REPORT_SEARCH_MAX,
  CLIENT_REPORT_SORTS,
  clientsToCsv,
  type ClientReportSort,
  type CsvLabels,
} from '@/crm/client-report'
import {
  clientStats,
  runClientReport,
  type ClientReportFilter,
  type ClientReportPage,
} from '@/crm/client-report.service'
import { relationId, type RelationValue } from '@/crm/schedule'
import { isLocalDate, localDayRange } from '@/crm/time'
import { crmTranslations } from '@/i18n'

import { SYSTEM_READ } from '../booking/context'
import { InputErrors, isId, localeOf, ok, type Locale } from '../booking/http'
import { locationScope } from './access'
import { crmEndpoint, crmError, routeParam } from './http'

const VISITS_PAGE_SIZE = 20

export type ClientReportQuery = {
  from: string | null
  to: string | null
  location: string | null
  barber: string | null
  q: string | null
  paging: ClientReportPage
  csv: boolean
}

const positiveInt = (value: string | null, fallback: number, max: number): number | null => {
  if (value === null || value === '') return fallback
  if (!/^\d{1,6}$/.test(value)) return null
  const number = Number(value)
  return number >= 1 && number <= max ? number : null
}

export const parseClientReportQuery = (params: URLSearchParams): ClientReportQuery => {
  const errors = new InputErrors()
  const from = params.get('from') || null
  const to = params.get('to') || null
  if (from && !isLocalDate(from)) errors.add('from')
  if (to && !isLocalDate(to)) errors.add('to')
  if (from && to && isLocalDate(from) && isLocalDate(to) && from > to) errors.add('to')
  const location = params.get('location') || null
  if (location && !isId(location)) errors.add('location')
  const barber = params.get('barber') || null
  if (barber && !isId(barber)) errors.add('barber')
  const q = (params.get('q') ?? '').trim()
  if (q.length > CLIENT_REPORT_SEARCH_MAX) errors.add('q')
  const sort = params.get('sort') || 'name'
  if (!CLIENT_REPORT_SORTS.includes(sort as ClientReportSort)) errors.add('sort')
  const order = params.get('order') || (sort === 'name' ? 'asc' : 'desc')
  if (order !== 'asc' && order !== 'desc') errors.add('order')
  const page = positiveInt(params.get('page'), 1, 100_000)
  if (page === null) errors.add('page')
  const limit = positiveInt(
    params.get('limit'),
    CLIENT_REPORT_PAGE_SIZE,
    CLIENT_REPORT_MAX_PAGE_SIZE,
  )
  if (limit === null) errors.add('limit')
  const format = params.get('format')
  if (format && format !== 'csv' && format !== 'json') errors.add('format')
  errors.throwIfAny()
  return {
    from,
    to,
    location,
    barber,
    q: q || null,
    paging: {
      sort: sort as ClientReportSort,
      order: order as 'asc' | 'desc',
      page: page ?? 1,
      limit: limit ?? CLIENT_REPORT_PAGE_SIZE,
      all: format === 'csv',
    },
    csv: format === 'csv',
  }
}

/** Allowed locations: `null` = all (admin); a manager is limited to their own, and a foreign one is 403. */
const allowedLocations = async (
  req: PayloadRequest,
  staff: StaffContext,
  requested: string | null,
): Promise<string[] | null> => {
  const scope = await locationScope(req, staff)
  if (scope === 'all') return requested ? [requested] : null
  if (requested) {
    if (!scope.has(requested)) throw crmError('FORBIDDEN', 403)
    return [requested]
  }
  return [...scope]
}

const csvLabels = (locale: Locale): CsvLabels => {
  const t = crmTranslations[locale].crm
  return {
    client: t['reports.clients.columns.client'],
    phone: t['reports.clients.columns.phone'],
    visits: t['reports.clients.columns.visits'],
    lastVisit: t['reports.clients.columns.lastVisit'],
    avgCheck: t['reports.clients.columns.avgCheck'],
    cancelledByClient: t['reports.clients.columns.cancelledByClient'],
    cancelledBySalon: t['reports.clients.columns.cancelledBySalon'],
    noShows: t['reports.clients.columns.noShows'],
  }
}

const dayBounds = (from: string | null, to: string | null) => ({
  from: from ? localDayRange(from).start : null,
  // `to` is an inclusive day: the range ends at the start of the next one.
  to: to ? localDayRange(to).end : null,
})

export const clientsReportEndpoint = crmEndpoint('get', '/reports/clients', async (req, staff) => {
  if (!allowed(req.user, 'read', 'reports.clients')) throw crmError('FORBIDDEN', 403)
  const query = parseClientReportQuery(req.searchParams)
  const filter: ClientReportFilter = {
    ...dayBounds(query.from, query.to),
    locations: await allowedLocations(req, staff, query.location),
    barber: query.barber,
    q: query.q,
  }
  const { rows, total } = await runClientReport(req, filter, query.paging)

  if (!query.csv) return ok({ rows, total, page: query.paging.page, limit: query.paging.limit })

  const name = `clients${query.from ? `_${query.from}` : ''}${query.to ? `_${query.to}` : ''}.csv`
  return new Response(clientsToCsv(rows, csvLabels(localeOf(req))), {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'no-store',
    },
  })
})

type VisitRow = {
  id: string | number
  status?: string | null
  startAt: string | Date
  location?: RelationValue
  barber?: RelationValue
  service?: RelationValue
  total?: number | null
  paidAmount?: number | null
}

export const clientCardReportEndpoint = crmEndpoint(
  'get',
  '/reports/clients/:id',
  async (req, staff) => {
    if (!allowed(req.user, 'read', 'reports.clients')) throw crmError('FORBIDDEN', 403)
    const id = routeParam(req, 'id')
    if (!isId(id)) throw crmError('NOT_FOUND', 404)
    const errors = new InputErrors()
    const page = positiveInt(req.searchParams.get('page'), 1, 100_000)
    if (page === null) errors.add('page')
    errors.throwIfAny()
    const locale = localeOf(req)

    // The card follows the user's rights on `clients`.
    const { docs: clients } = await req.payload.find({
      collection: 'clients',
      where: { id: { equals: id } },
      depth: 0,
      limit: 1,
      pagination: false,
      overrideAccess: false,
      user: req.user,
      req,
      select: { firstName: true, lastName: true, phone: true, blocked: true },
    })
    const client = clients[0]
    if (!client) throw crmError('NOT_FOUND', 404)

    const scope = await locationScope(req, staff)
    const stats = await clientStats(req, id, scope === 'all' ? null : [...scope])

    // Visits: the appointments rule of the collection cuts a manager to their locations.
    const visits = await req.payload.find({
      collection: 'appointments',
      where: { and: [{ client: { equals: id } }, { kind: { not_equals: 'block' } }] },
      sort: '-startAt',
      limit: VISITS_PAGE_SIZE,
      page: page ?? 1,
      depth: 0,
      overrideAccess: false,
      user: req.user,
      req,
      select: {
        status: true,
        startAt: true,
        location: true,
        barber: true,
        service: true,
        total: true,
        paidAmount: true,
      },
    })
    const rows = visits.docs as unknown as VisitRow[]

    const names = async (collection: 'barbers' | 'services' | 'locations', ids: string[]) => {
      const map = new Map<string, string>()
      if (ids.length === 0) return map
      const { docs } = await req.payload.find({
        collection,
        ...SYSTEM_READ,
        req,
        locale,
        where: { id: { in: ids } },
        select: { name: true },
      })
      for (const doc of docs) map.set(String(doc.id), (doc as { name?: string }).name ?? '')
      return map
    }
    const unique = (values: (string | null)[]) => [
      ...new Set(values.filter((value): value is string => Boolean(value))),
    ]
    // One after another: the request may carry a transaction session.
    const barbers = await names('barbers', unique(rows.map((row) => relationId(row.barber))))
    const services = await names('services', unique(rows.map((row) => relationId(row.service))))
    const locations = await names('locations', unique(rows.map((row) => relationId(row.location))))
    const label = (map: Map<string, string>, value: RelationValue) => {
      const key = relationId(value)
      return key ? (map.get(key) ?? '') : ''
    }

    return ok({
      client: {
        id,
        firstName: client.firstName,
        lastName: client.lastName ?? null,
        phone: client.phone,
        blocked: client.blocked === true,
      },
      stats,
      visits: rows.map((row) => ({
        id: String(row.id),
        start: new Date(row.startAt).toISOString(),
        status: row.status ?? 'scheduled',
        barber: label(barbers, row.barber),
        service: label(services, row.service),
        location: label(locations, row.location),
        total: row.total ?? 0,
        paidAmount: row.paidAmount ?? 0,
      })),
      page: visits.page ?? 1,
      hasNext: visits.hasNextPage,
    })
  },
)
