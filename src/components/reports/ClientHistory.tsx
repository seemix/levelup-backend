'use client'
import { useAuth, useDocumentInfo } from '@payloadcms/ui'
import { useEffect, useState } from 'react'

import { formatMoney } from '@/crm/money'
import { formatDateTime } from '@/crm/time'
import type { CrmKey } from '@/i18n'

import '../calendar/calendar.scss'
import './reports.scss'
import { useCrmApi, useErrorText, useLanguage } from '../calendar/api'
import { useCrmT } from '../calendar/useCrmT'
import type { CardResponse, CardVisit } from './types'

type State = { key: string; data: CardResponse | null; error: string | null } | null

/**
 * Block in the client card (spec §8, A37): statistics and visit history from
 * `GET /api/crm/reports/clients/:id`. A UI field of `clients`, shown only for a saved client; a manager
 * sees the visits of their locations only (the server cuts the rows).
 */
export const ClientHistory = () => {
  const { id } = useDocumentInfo()
  const { user } = useAuth()
  const roles = ((user as { roles?: string[] } | null)?.roles ?? []) as string[]
  if (!id || !roles.some((role) => role === 'admin' || role === 'manager')) return null
  return <ClientHistoryBlock clientId={String(id)} />
}

const ClientHistoryBlock = ({ clientId }: { clientId: string }) => {
  const t = useCrmT()
  const api = useCrmApi()
  const language = useLanguage()
  const errorText = useErrorText()
  const [state, setState] = useState<State>(null)
  const [more, setMore] = useState<{ visits: CardVisit[]; page: number; hasNext: boolean } | null>(
    null,
  )
  const [moreBusy, setMoreBusy] = useState(false)

  const path = `/crm/reports/clients/${clientId}?locale=${language}`
  useEffect(() => {
    const controller = new AbortController()
    api<CardResponse>(path, { signal: controller.signal })
      .then((data) => {
        setMore(null)
        setState({ key: path, data, error: null })
      })
      .catch((caught: unknown) => {
        if ((caught as { name?: string }).name !== 'AbortError')
          setState({ key: path, data: null, error: errorText(caught) })
      })
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, path])

  const current = state?.key === path ? state : null
  if (!current) return <p className="calendar__state">{t('calendar.loading')}</p>
  if (!current.data)
    return (
      <p className="calendar__state" role="alert">
        {t('reports.clients.card.loadError')}: {current.error}
      </p>
    )

  const { stats } = current.data
  const visits = [...current.data.visits, ...(more?.visits ?? [])]
  const hasNext = more ? more.hasNext : current.data.hasNext
  const page = more?.page ?? current.data.page
  const money = (bani: number) => formatMoney(bani, language)

  const loadMore = async () => {
    setMoreBusy(true)
    try {
      const next = await api<CardResponse>(`${path}&page=${page + 1}`)
      setMore({
        visits: [...(more?.visits ?? []), ...next.visits],
        page: next.page,
        hasNext: next.hasNext,
      })
    } catch {
      // The button stays: the user may retry.
    } finally {
      setMoreBusy(false)
    }
  }

  const never = t('reports.clients.never')
  const items: [CrmKey, string | number][] = [
    ['reports.clients.columns.visits', stats.visits],
    [
      'reports.clients.columns.lastVisit',
      stats.lastVisit ? formatDateTime(new Date(stats.lastVisit), language) : never,
    ],
    ['reports.clients.columns.avgCheck', stats.avgCheck === null ? never : money(stats.avgCheck)],
    ['reports.clients.columns.cancelledByClient', stats.cancelledByClient],
    ['reports.clients.columns.cancelledBySalon', stats.cancelledBySalon],
    ['reports.clients.columns.noShows', stats.noShows],
  ]

  return (
    <section className="client-history reports" aria-label={t('reports.clients.card.title')}>
      <h3 className="reports__subtitle">{t('reports.clients.card.title')}</h3>
      <dl className="reports__stats">
        {items.map(([key, value]) => (
          <div key={key} className="reports__stat">
            <dt>{t(key)}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <h4 className="reports__subtitle">{t('reports.clients.card.history')}</h4>
      {visits.length === 0 ? (
        <p className="calendar__state">{t('reports.clients.card.noVisits')}</p>
      ) : (
        <div className="reports__scroll">
          <table className="reports__table">
            <thead>
              <tr>
                <th scope="col">{t('reports.clients.card.date')}</th>
                <th scope="col">{t('reports.clients.card.barber')}</th>
                <th scope="col">{t('reports.clients.card.service')}</th>
                <th scope="col">{t('reports.clients.card.status')}</th>
                <th scope="col" className="reports__table-num">
                  {t('reports.clients.card.total')}
                </th>
              </tr>
            </thead>
            <tbody>
              {visits.map((visit) => (
                <tr key={visit.id}>
                  <td>{formatDateTime(new Date(visit.start), language)}</td>
                  <td>{visit.barber}</td>
                  <td>{visit.service}</td>
                  <td>{t(`appointments.statuses.${visit.status}` as CrmKey)}</td>
                  <td className="reports__table-num">{money(visit.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {hasNext && (
        <button type="button" className="calendar__button" disabled={moreBusy} onClick={loadMore}>
          {t('reports.clients.card.loadMore')}
        </button>
      )}
    </section>
  )
}
