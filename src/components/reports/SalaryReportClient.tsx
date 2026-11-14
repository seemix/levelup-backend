'use client'
import { useAuth, useConfig } from '@payloadcms/ui'
import { useMemo, useState } from 'react'

import { formatMoney } from '@/crm/money'
import { formatDateTime } from '@/crm/time'
import type { CrmKey } from '@/i18n'

import '../calendar/calendar.scss'
import './reports.scss'
import { useLanguage } from '../calendar/api'
import { useCrmT } from '../calendar/useCrmT'
import { listQuery, useRestList } from '../finance/useRestList'
import { currentMonth, ReportTable, Section, useReport } from './shared'
import type { SalaryResponse } from './types'

type Filters = { from: string; to: string; location: string; barber: string }

/**
 * Admin view «Reports → Salary» (spec §8, A13, A38). Admin sees every barber (and filters by
 * location / barber); a barber sees only their own salary — the server forces it
 * (`GET /api/crm/reports/salary`). With one barber the operations of the period are listed too.
 */
export const SalaryReportClient = () => {
  const t = useCrmT()
  const language = useLanguage()
  const { config } = useConfig()
  const { user } = useAuth()
  const roles = ((user as { roles?: string[] } | null)?.roles ?? []) as string[]
  const isAdmin = roles.includes('admin')
  const [filters, setFilters] = useState<Filters>(() => ({
    ...currentMonth(),
    location: '',
    barber: '',
  }))

  const locationsList = useRestList<{ id: string | number; name: string }>(
    isAdmin ? `/locations?${listQuery(language, { sort: 'name' })}` : null,
  )
  const barbersList = useRestList<{ id: string | number; name: string }>(
    isAdmin ? `/barbers?${listQuery(language, { sort: 'name' })}` : null,
  )

  const params = useMemo(() => {
    const result = new URLSearchParams({ locale: language })
    for (const [name, value] of Object.entries(filters)) if (value) result.set(name, value)
    return result
  }, [filters, language])
  const valid = Boolean(filters.from && filters.to && filters.from <= filters.to)
  const { current, data, busy } = useReport<SalaryResponse>(
    valid ? `/crm/reports/salary?${params}` : null,
  )
  const csvHref = `${config.routes.api}/crm/reports/salary?${params}&format=csv`

  const money = (bani: number) => formatMoney(bani, language)
  const c = (key: string) => t(`reports.salary.columns.${key}` as CrmKey)
  const barberName = (id: string) => data?.names.barbers[id] || t('reports.finance.unknown')
  const setFilter = (patch: Partial<Filters>) =>
    setFilters((previous) => ({ ...previous, ...patch }))

  return (
    <div className="reports">
      <div className="reports__toolbar">
        <h1 className="reports__title">{t('reports.salary.title')}</h1>
        {valid && (
          <a className="calendar__button" href={csvHref} download>
            {t('reports.clients.exportCsv')}
          </a>
        )}
      </div>
      <p className="reports__hint">{t('reports.salary.hint')}</p>

      <div className="reports__filters">
        <label className="calendar-modal__field">
          <span>{t('reports.clients.filters.from')}</span>
          <input
            type="date"
            required
            value={filters.from}
            max={filters.to || undefined}
            onChange={(event) => setFilter({ from: event.target.value })}
          />
        </label>
        <label className="calendar-modal__field">
          <span>{t('reports.clients.filters.to')}</span>
          <input
            type="date"
            required
            value={filters.to}
            min={filters.from || undefined}
            onChange={(event) => setFilter({ to: event.target.value })}
          />
        </label>
        {isAdmin && (
          <>
            <label className="calendar-modal__field">
              <span>{t('reports.clients.filters.location')}</span>
              <select
                value={filters.location}
                onChange={(event) => setFilter({ location: event.target.value })}
              >
                <option value="">{t('reports.clients.filters.all')}</option>
                {(locationsList.docs ?? []).map((location) => (
                  <option key={String(location.id)} value={String(location.id)}>
                    {location.name}
                  </option>
                ))}
              </select>
            </label>
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
          </>
        )}
      </div>

      {current?.error ? (
        <p className="calendar__state" role="alert">
          {t('reports.salary.loadError')}: {current.error}
        </p>
      ) : !data ? (
        <p className="calendar__state">{t('calendar.loading')}</p>
      ) : data.rows.length === 0 ? (
        <p className="calendar__state">{t('reports.salary.empty')}</p>
      ) : (
        <div className="reports__sections" aria-busy={busy}>
          <ReportTable
            columns={[
              { label: c('barber') },
              { label: c('payments'), numeric: true },
              { label: c('refunds'), numeric: true },
              { label: c('servicesBase'), numeric: true },
              { label: c('servicesPercent'), numeric: true },
              { label: c('servicesCommission'), numeric: true },
              { label: c('extrasBase'), numeric: true },
              { label: c('extrasPercent'), numeric: true },
              { label: c('extrasCommission'), numeric: true },
              { label: c('tips'), numeric: true },
              { label: c('total'), numeric: true },
            ]}
            rows={data.rows.map((row) => [
              barberName(row.barber),
              row.payments,
              row.refunds,
              money(row.servicesBase),
              `${row.servicesPercent}%`,
              money(row.servicesCommission),
              money(row.extrasBase),
              `${row.extrasPercent}%`,
              money(row.extrasCommission),
              money(row.tips),
              <strong key="total">{money(row.total)}</strong>,
            ])}
            footer={
              data.rows.length > 1
                ? [
                    t('reports.finance.totalRow'),
                    data.totals.payments,
                    data.totals.refunds,
                    money(data.totals.servicesBase),
                    '',
                    money(data.totals.servicesCommission),
                    money(data.totals.extrasBase),
                    '',
                    money(data.totals.extrasCommission),
                    money(data.totals.tips),
                    money(data.totals.total),
                  ]
                : undefined
            }
          />

          {data.items.length > 0 && (
            <Section title={t('reports.salary.details')}>
              <ReportTable
                columns={[
                  { label: c('date') },
                  { label: c('type') },
                  { label: c('servicesBase'), numeric: true },
                  { label: c('extrasBase'), numeric: true },
                  { label: c('tips'), numeric: true },
                ]}
                rows={data.items.map((item) => [
                  formatDateTime(new Date(item.occurredAt), language),
                  t(`transactions.types.${item.type}`),
                  money(item.servicesBase),
                  money(item.extrasBase),
                  money(item.tips),
                ])}
              />
            </Section>
          )}
        </div>
      )}
    </div>
  )
}
