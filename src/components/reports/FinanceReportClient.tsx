'use client'
import { useAuth, useConfig } from '@payloadcms/ui'
import { useMemo, useState } from 'react'

import { formatMoney } from '@/crm/money'
import type { CrmKey } from '@/i18n'

import '../calendar/calendar.scss'
import './reports.scss'
import { useLanguage } from '../calendar/api'
import { useCrmT } from '../calendar/useCrmT'
import { listQuery, useRestList } from '../finance/useRestList'
import { currentMonth, ReportTable, Section, Stat, useReport } from './shared'
import type { FinanceResponse } from './types'

type Filters = { from: string; to: string; location: string; barber: string }

const idOf = (value: unknown): string =>
  String(value && typeof value === 'object' ? (value as { id: unknown }).id : value)

/**
 * Admin view «Reports → Finance» (spec §8, A38): income by location / register / barber, revenue by
 * service, expenses, register movement, promo codes, certificates and — for admin — profit. The data
 * come from `GET /api/crm/reports/finance`, which cuts a manager to their locations and drops profit.
 */
export const FinanceReportClient = () => {
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
    const result = new URLSearchParams({ locale: language })
    for (const [name, value] of Object.entries(filters)) if (value) result.set(name, value)
    return result
  }, [filters, language])
  const valid = Boolean(filters.from && filters.to && filters.from <= filters.to)
  const { current, data, busy } = useReport<FinanceResponse>(
    valid ? `/crm/reports/finance?${params}` : null,
  )
  const csvHref = `${config.routes.api}/crm/reports/finance?${params}&format=csv`

  const money = (bani: number) => formatMoney(bani, language)
  const c = (key: string) => t(`reports.finance.columns.${key}` as CrmKey)
  const name = (map: Record<string, string> | undefined, id: string | null, fallback?: string) =>
    (id && map?.[id]) || fallback || t('reports.finance.unknown')
  const setFilter = (patch: Partial<Filters>) =>
    setFilters((previous) => ({ ...previous, ...patch }))

  return (
    <div className="reports">
      <div className="reports__toolbar">
        <h1 className="reports__title">{t('reports.finance.title')}</h1>
        {valid && (
          <a className="calendar__button" href={csvHref} download>
            {t('reports.clients.exportCsv')}
          </a>
        )}
      </div>
      <p className="reports__hint">{t('reports.finance.hint')}</p>

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
      </div>

      {current?.error ? (
        <p className="calendar__state" role="alert">
          {t('reports.finance.loadError')}: {current.error}
        </p>
      ) : !data ? (
        <p className="calendar__state">{t('calendar.loading')}</p>
      ) : (
        <div className="reports__sections" aria-busy={busy}>
          <Section title={t('reports.finance.sections.income')}>
            <dl className="reports__stats">
              <Stat label={c('payments')} value={money(data.income.totals.payments)} />
              <Stat label={c('refunds')} value={money(data.income.totals.refunds)} />
              <Stat
                label={c('certificateSales')}
                value={money(data.income.totals.certificateSales)}
              />
              <Stat label={c('tips')} value={money(data.income.totals.tips)} />
              <Stat label={c('net')} value={money(data.income.totals.net)} />
            </dl>
          </Section>

          {data.profit && (
            <Section
              title={t('reports.finance.sections.profit')}
              hint={t('reports.finance.profit.hint')}
            >
              <dl className="reports__stats">
                {(['income', 'expenses', 'salary', 'profit'] as const).map((key) => (
                  <Stat
                    key={key}
                    label={t(`reports.finance.profit.${key}`)}
                    value={money(data.profit![key])}
                  />
                ))}
              </dl>
            </Section>
          )}

          <Section title={t('reports.finance.sections.byLocation')}>
            <IncomeTable
              first={c('location')}
              rows={data.income.byLocation.map((row) => ({
                ...row,
                label: name(data.names.locations, row.id),
              }))}
              totals={data.income.totals}
              c={c}
              money={money}
              empty={t('reports.finance.empty')}
              total={t('reports.finance.totalRow')}
            />
          </Section>

          <Section title={t('reports.finance.sections.byRegister')}>
            <IncomeTable
              first={c('register')}
              showTips={false}
              rows={data.income.byRegister.map((row) => ({
                ...row,
                label: name(data.names.registers, row.id),
              }))}
              c={c}
              money={money}
              empty={t('reports.finance.empty')}
            />
          </Section>

          <Section title={t('reports.finance.sections.byBarber')}>
            {data.income.byBarber.length === 0 ? (
              <p className="reports__hint">{t('reports.finance.empty')}</p>
            ) : (
              <ReportTable
                columns={[
                  { label: c('barber') },
                  { label: c('payments'), numeric: true },
                  { label: c('refunds'), numeric: true },
                  { label: c('net'), numeric: true },
                  { label: c('certificate'), numeric: true },
                  { label: c('tips'), numeric: true },
                  { label: c('revenue'), numeric: true },
                ]}
                rows={data.income.byBarber.map((row) => [
                  name(data.names.barbers, row.barber),
                  money(row.payments),
                  money(row.refunds),
                  money(row.net),
                  money(row.certificate),
                  money(row.tips),
                  money(row.revenue),
                ])}
              />
            )}
          </Section>

          <Section
            title={t('reports.finance.sections.revenue')}
            hint={t('reports.finance.sections.revenueHint')}
          >
            {data.revenue.items.length === 0 ? (
              <p className="reports__hint">{t('reports.finance.empty')}</p>
            ) : (
              <ReportTable
                columns={[
                  { label: c('item') },
                  { label: c('itemType') },
                  { label: c('appointments'), numeric: true },
                  { label: c('amount'), numeric: true },
                ]}
                rows={data.revenue.items.map((row) => [
                  name(
                    row.itemType === 'extra' ? data.names.extras : data.names.services,
                    row.item,
                    t('reports.finance.deletedItem'),
                  ),
                  t(`appointments.itemTypes.${row.itemType}`),
                  row.appointments,
                  money(row.amount),
                ])}
                footer={[
                  t('reports.finance.totalRow'),
                  `${c('certificate')}: ${money(data.revenue.certificate)}`,
                  '',
                  money(data.revenue.total),
                ]}
              />
            )}
          </Section>

          <Section title={t('reports.finance.sections.expensesByCategory')}>
            {data.expenses.byCategory.length === 0 ? (
              <p className="reports__hint">{t('reports.finance.empty')}</p>
            ) : (
              <ReportTable
                columns={[
                  { label: c('category') },
                  { label: c('count'), numeric: true },
                  { label: c('amount'), numeric: true },
                ]}
                rows={data.expenses.byCategory.map((row) => [
                  name(data.names.categories, row.id, t('reports.finance.noCategory')),
                  row.count,
                  money(row.amount),
                ])}
                footer={[t('reports.finance.totalRow'), '', money(data.expenses.total)]}
              />
            )}
          </Section>

          {data.expenses.byRegister.length > 0 && (
            <Section title={t('reports.finance.sections.expensesByRegister')}>
              <ReportTable
                columns={[
                  { label: c('register') },
                  { label: c('count'), numeric: true },
                  { label: c('amount'), numeric: true },
                ]}
                rows={data.expenses.byRegister.map((row) => [
                  name(data.names.registers, row.id),
                  row.count,
                  money(row.amount),
                ])}
              />
            </Section>
          )}

          <Section title={t('reports.finance.sections.registers')}>
            <ReportTable
              columns={[
                { label: c('register') },
                { label: c('location') },
                { label: c('opening'), numeric: true },
                { label: c('inflow'), numeric: true },
                { label: c('outflow'), numeric: true },
                { label: c('closing'), numeric: true },
                { label: c('balance'), numeric: true },
              ]}
              rows={data.registers.rows.map((row) => [
                name(data.names.registers, row.register),
                name(data.names.locations, row.location),
                money(row.opening),
                money(row.inflow),
                money(row.outflow),
                money(row.closing),
                <span key="balance" className={row.balance < 0 ? 'reports__negative' : undefined}>
                  {money(row.balance)}
                </span>,
              ])}
              footer={[
                t('reports.finance.totalRow'),
                '',
                money(data.registers.totals.opening),
                money(data.registers.totals.inflow),
                money(data.registers.totals.outflow),
                money(data.registers.totals.closing),
                money(data.registers.totals.balance),
              ]}
            />
          </Section>

          <Section
            title={t('reports.finance.sections.promo')}
            hint={t('reports.finance.sections.promoHint')}
          >
            {data.promo.codes.length === 0 ? (
              <p className="reports__hint">{t('reports.finance.empty')}</p>
            ) : (
              <ReportTable
                columns={[
                  { label: c('code') },
                  { label: c('uses'), numeric: true },
                  { label: c('discount'), numeric: true },
                ]}
                rows={data.promo.codes.map((row) => [
                  name(data.names.promoCodes, row.promoCode),
                  row.uses,
                  money(row.discount),
                ])}
                footer={[
                  t('reports.finance.totalRow'),
                  data.promo.uses,
                  money(data.promo.discount),
                ]}
              />
            )}
          </Section>

          <Section title={t('reports.finance.sections.certificates')}>
            <ReportTable
              columns={[
                { label: c('name') },
                { label: c('count'), numeric: true },
                { label: c('amount'), numeric: true },
              ]}
              rows={[
                [
                  t('reports.finance.certificates.sold'),
                  data.certificates.sold.count,
                  money(data.certificates.sold.amount),
                ],
                [t('reports.finance.certificates.redeemed'), '', money(data.certificates.redeemed)],
                [
                  t('reports.finance.certificates.outstanding'),
                  data.certificates.outstanding.count,
                  money(data.certificates.outstanding.amount),
                ],
                [
                  t('reports.finance.certificates.expired'),
                  data.certificates.expired.count,
                  money(data.certificates.expired.amount),
                ],
              ]}
            />
          </Section>
        </div>
      )}
    </div>
  )
}

type IncomeValues = FinanceResponse['income']['totals']

const IncomeTable = ({
  first,
  rows,
  totals,
  c,
  money,
  empty,
  total,
  showTips = true,
}: {
  first: string
  rows: (IncomeValues & { id: string; label: string })[]
  totals?: IncomeValues
  c: (key: string) => string
  money: (bani: number) => string
  empty: string
  total?: string
  showTips?: boolean
}) => {
  if (rows.length === 0) return <p className="reports__hint">{empty}</p>
  const cells = (row: IncomeValues) => [
    money(row.payments),
    money(row.refunds),
    money(row.certificateSales),
    ...(showTips ? [money(row.tips)] : []),
    money(row.net),
  ]
  return (
    <ReportTable
      columns={[
        { label: first },
        { label: c('payments'), numeric: true },
        { label: c('refunds'), numeric: true },
        { label: c('certificateSales'), numeric: true },
        ...(showTips ? [{ label: c('tips'), numeric: true }] : []),
        { label: c('net'), numeric: true },
      ]}
      rows={rows.map((row) => [row.label, ...cells(row)])}
      footer={totals && total ? [total, ...cells(totals)] : undefined}
    />
  )
}
