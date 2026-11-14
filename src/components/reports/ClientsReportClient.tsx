'use client'
import { useAuth, useConfig } from '@payloadcms/ui'
import { useEffect, useMemo, useState } from 'react'

import type { ClientReportSort } from '@/crm/client-report'
import { formatMoney } from '@/crm/money'
import { formatDateTime } from '@/crm/time'
import type { CrmKey } from '@/i18n'

import '../calendar/calendar.scss'
import './reports.scss'
import { useCrmApi, useErrorText, useLanguage } from '../calendar/api'
import { useCrmT } from '../calendar/useCrmT'
import { listQuery, useRestList } from '../finance/useRestList'
import type { ReportResponse } from './types'

type Filters = { from: string; to: string; location: string; barber: string; q: string }
const emptyFilters: Filters = { from: '', to: '', location: '', barber: '', q: '' }

type Loaded = { key: string; data: ReportResponse | null; error: string | null } | null

type Column = { sort: ClientReportSort; key: CrmKey; numeric: boolean }
const NAME_COLUMN: Column = { sort: 'name', key: 'reports.clients.columns.client', numeric: false }
const OTHER_COLUMNS: Column[] = [
  { sort: 'visits', key: 'reports.clients.columns.visits', numeric: true },
  { sort: 'lastVisit', key: 'reports.clients.columns.lastVisit', numeric: false },
  { sort: 'avgCheck', key: 'reports.clients.columns.avgCheck', numeric: true },
  { sort: 'cancelledByClient', key: 'reports.clients.columns.cancelledByClient', numeric: true },
  { sort: 'cancelledBySalon', key: 'reports.clients.columns.cancelledBySalon', numeric: true },
  { sort: 'noShows', key: 'reports.clients.columns.noShows', numeric: true },
]

const idOf = (value: unknown): string =>
  String(value && typeof value === 'object' ? (value as { id: unknown }).id : value)

/**
 * Admin view «Reports → Clients» (spec §8, A37): filters, search with a short delay, sortable columns,
 * server-side paging and the CSV export. The data come from `GET /api/crm/reports/clients`, which cuts
 * a manager to their locations; the UI only offers those locations.
 */
export const ClientsReportClient = () => {
  const t = useCrmT()
  const api = useCrmApi()
  const language = useLanguage()
  const errorText = useErrorText()
  const { config } = useConfig()
  const { user } = useAuth()
  const roles = ((user as { roles?: string[] } | null)?.roles ?? []) as string[]
  const isAdmin = roles.includes('admin')

  const [filters, setFilters] = useState<Filters>(emptyFilters)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<ClientReportSort>('name')
  const [order, setOrder] = useState<'asc' | 'desc'>('asc')
  const [page, setPage] = useState(1)

  // Search is sent 300 ms after the last keystroke.
  useEffect(() => {
    const timer = setTimeout(() => {
      setFilters((previous) => {
        if (previous.q === search) return previous
        setPage(1)
        return { ...previous, q: search }
      })
    }, 300)
    return () => clearTimeout(timer)
  }, [search])

  const locationsList = useRestList<{ id: string | number; name: string }>(
    `/locations?${listQuery(language, { sort: 'name' })}`,
  )
  const barbersList = useRestList<{ id: string | number; name: string }>(
    `/barbers?${listQuery(language, { sort: 'name' })}`,
  )
  const managed = useMemo(
    () => new Set(((user as { locations?: unknown[] } | null)?.locations ?? []).map(idOf)),
    [user],
  )
  const locations = (locationsList.docs ?? [])
    .map((doc) => ({ id: String(doc.id), name: doc.name }))
    .filter((location) => isAdmin || managed.has(location.id))

  const params = useMemo(() => {
    const result = new URLSearchParams({ locale: language, sort, order })
    for (const [name, value] of Object.entries(filters)) if (value) result.set(name, value)
    return result
  }, [filters, language, order, sort])

  const query = `${params}&page=${page}`
  const [loaded, setLoaded] = useState<Loaded>(null)
  useEffect(() => {
    const controller = new AbortController()
    api<ReportResponse>(`/crm/reports/clients?${query}`, { signal: controller.signal })
      .then((data) => setLoaded({ key: query, data, error: null }))
      .catch((caught: unknown) => {
        if ((caught as { name?: string }).name !== 'AbortError')
          setLoaded({ key: query, data: null, error: errorText(caught) })
      })
    return () => controller.abort()
    // `errorText` is recreated on every render; the request depends on the query only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, query])
  const current = loaded?.key === query ? loaded : null
  const data = (current ?? loaded)?.data ?? null

  const setFilter = (patch: Partial<Filters>) => {
    setFilters((previous) => ({ ...previous, ...patch }))
    setPage(1)
  }
  const toggleSort = (next: ClientReportSort) => {
    if (next === sort) setOrder((value) => (value === 'asc' ? 'desc' : 'asc'))
    else {
      setSort(next)
      setOrder(next === 'name' ? 'asc' : 'desc')
    }
    setPage(1)
  }
  const reset = () => {
    setFilters(emptyFilters)
    setSearch('')
    setPage(1)
  }

  const pages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1
  const adminRoute = config.routes.admin === '/' ? '' : config.routes.admin
  const csvHref = `${config.routes.api}/crm/reports/clients?${params}&format=csv`
  const filtered = Object.values(filters).some(Boolean) || search !== ''
  const money = (bani: number) => formatMoney(bani, language)

  const header = (column: Column) => (
    <SortHeader
      key={column.sort}
      label={t(column.key)}
      active={sort === column.sort}
      order={order}
      numeric={column.numeric}
      onClick={() => toggleSort(column.sort)}
    />
  )

  return (
    <div className="reports">
      <div className="reports__toolbar">
        <h1 className="reports__title">{t('reports.clients.title')}</h1>
        <a className="calendar__button" href={csvHref} download>
          {t('reports.clients.exportCsv')}
        </a>
      </div>
      <p className="reports__hint">{t('reports.clients.hint')}</p>

      <div className="reports__filters">
        <label className="calendar-modal__field">
          <span>{t('reports.clients.filters.from')}</span>
          <input
            type="date"
            value={filters.from}
            max={filters.to || undefined}
            onChange={(event) => setFilter({ from: event.target.value })}
          />
        </label>
        <label className="calendar-modal__field">
          <span>{t('reports.clients.filters.to')}</span>
          <input
            type="date"
            value={filters.to}
            min={filters.from || undefined}
            onChange={(event) => setFilter({ to: event.target.value })}
          />
        </label>
        {(isAdmin || locations.length > 1) && (
          <label className="calendar-modal__field">
            <span>{t('reports.clients.filters.location')}</span>
            <select
              value={filters.location}
              onChange={(event) => setFilter({ location: event.target.value })}
            >
              <option value="">{t('reports.clients.filters.all')}</option>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="calendar-modal__field">
          <span>{t('reports.clients.filters.barber')}</span>
          <select
            value={filters.barber}
            onChange={(event) => setFilter({ barber: event.target.value })}
          >
            <option value="">{t('reports.clients.filters.all')}</option>
            {(barbersList.docs ?? []).map((barber) => (
              <option key={String(barber.id)} value={String(barber.id)}>
                {barber.name}
              </option>
            ))}
          </select>
        </label>
        <label className="calendar-modal__field">
          <span>{t('reports.clients.filters.search')}</span>
          <input
            type="search"
            value={search}
            maxLength={64}
            placeholder={t('reports.clients.filters.searchPlaceholder')}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        {filtered && (
          <button type="button" className="calendar__button" onClick={reset}>
            {t('reports.clients.filters.reset')}
          </button>
        )}
      </div>

      {current?.error ? (
        <p className="calendar__state" role="alert">
          {t('reports.clients.loadError')}: {current.error}
        </p>
      ) : !data ? (
        <p className="calendar__state">{t('calendar.loading')}</p>
      ) : data.rows.length === 0 ? (
        <p className="calendar__state">{t('reports.clients.empty')}</p>
      ) : (
        <>
          <div className="reports__scroll" aria-busy={!current}>
            <table className="reports__table">
              <thead>
                <tr>
                  {header(NAME_COLUMN)}
                  <th scope="col">{t('reports.clients.columns.phone')}</th>
                  {OTHER_COLUMNS.map(header)}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <a href={`${adminRoute}/collections/clients/${row.id}`}>
                        {[row.firstName, row.lastName].filter(Boolean).join(' ')}
                      </a>
                      {row.blocked && (
                        <span className="reports__badge">{t('reports.clients.blocked')}</span>
                      )}
                    </td>
                    <td>{row.phone}</td>
                    <td className="reports__table-num">{row.visits}</td>
                    <td>
                      {row.lastVisit
                        ? formatDateTime(new Date(row.lastVisit), language)
                        : t('reports.clients.never')}
                    </td>
                    <td className="reports__table-num">
                      {row.avgCheck === null ? t('reports.clients.never') : money(row.avgCheck)}
                    </td>
                    <td className="reports__table-num">{row.cancelledByClient}</td>
                    <td className="reports__table-num">{row.cancelledBySalon}</td>
                    <td className="reports__table-num">{row.noShows}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="reports__pager">
            <span>{t('reports.clients.total', { count: data.total })}</span>
            <span className="reports__hint">
              {t('reports.clients.page', { page: data.page, pages })}
            </span>
            <span className="reports__actions">
              <button
                type="button"
                className="calendar__button"
                disabled={page <= 1}
                onClick={() => setPage((value) => value - 1)}
              >
                {t('reports.clients.prev')}
              </button>
              <button
                type="button"
                className="calendar__button"
                disabled={page >= pages}
                onClick={() => setPage((value) => value + 1)}
              >
                {t('reports.clients.next')}
              </button>
            </span>
          </div>
        </>
      )}
    </div>
  )
}

const SortHeader = ({
  label,
  active,
  order,
  numeric,
  onClick,
}: {
  label: string
  active: boolean
  order: 'asc' | 'desc'
  numeric: boolean
  onClick: () => void
}) => (
  <th
    scope="col"
    className={numeric ? 'reports__table-num' : undefined}
    aria-sort={active ? (order === 'asc' ? 'ascending' : 'descending') : 'none'}
  >
    <button type="button" className="reports__sort" onClick={onClick}>
      {label}
      {active && (order === 'asc' ? ' ↑' : ' ↓')}
    </button>
  </th>
)
