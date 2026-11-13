'use client'
import { useAuth, useConfig, useTranslation } from '@payloadcms/ui'
import { useEffect, useState } from 'react'

import { defaultNewStart } from '@/crm/appointment-form'
import { addLocalDays, todayLocal } from '@/crm/time'

import './calendar.scss'
import { AppointmentModal, type ModalTarget } from './AppointmentModal'
import { DayGrid } from './DayGrid'
import { Toolbar } from './Toolbar'
import type { CalendarData } from './types'
import { useCrmT } from './useCrmT'

/** Day calendar: loads `/api/crm/calendar` and keeps date, location and the cancelled toggle. */
export const CalendarClient = () => {
  const { config } = useConfig()
  const { i18n } = useTranslation()
  const t = useCrmT()
  const [date, setDate] = useState(() => todayLocal())
  const [location, setLocation] = useState<string | null>(null)
  const [cancelled, setCancelled] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [modal, setModal] = useState<ModalTarget | null>(null)
  const { user } = useAuth()
  const roles = ((user as { roles?: string[] } | null)?.roles ?? []) as string[]
  // Convenience only: the server checks every request (decisions 30, 36, 37).
  const isManager = roles.includes('admin') || roles.includes('manager')
  // The result is stored with the key of its request: "loading" = the key of the screen differs.
  const [result, setResult] = useState<{ key: string; data: CalendarData | null }>({
    key: '',
    data: null,
  })
  const key = [date, location ?? '', cancelled ? 1 : 0, i18n.language, attempt].join('|')

  useEffect(() => {
    const controller = new AbortController()
    const params = new URLSearchParams({ date, view: 'day', locale: i18n.language })
    if (location) params.set('location', location)
    if (cancelled) params.set('cancelled', '1')
    fetch(`${config.routes.api}/crm/calendar?${params}`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status))
        return response.json() as Promise<CalendarData>
      })
      .then((data) => setResult({ key, data }))
      .catch((error: unknown) => {
        if ((error as { name?: string }).name !== 'AbortError') setResult({ key, data: null })
      })
    return () => controller.abort()
  }, [key, date, location, cancelled, i18n.language, config.routes.api])

  const settled = result.key === key
  const error = settled && result.data === null
  const data = result.data

  return (
    <div className="calendar">
      <h1 className="visually-hidden">{t('calendar.title')}</h1>
      <Toolbar
        date={date}
        locations={data?.locations ?? []}
        location={data?.location ?? location}
        cancelled={cancelled}
        onDate={setDate}
        onToday={() => setDate(todayLocal())}
        onShift={(days) => setDate((current) => addLocalDays(current, days))}
        onLocation={setLocation}
        onCancelled={setCancelled}
        onNew={() => {
          const columns = data?.columns ?? []
          const column =
            columns.find((item) => item.barber.own) ?? (isManager ? columns[0] : undefined)
          if (!data || !column) return
          setModal({
            type: 'create',
            barberId: column.barber.id,
            start: defaultNewStart(date, new Date(), data.slotStepMinutes),
          })
        }}
      />
      {error ? (
        <div className="calendar__state" role="alert">
          <p>{t('calendar.loadError')}</p>
          <button
            type="button"
            className="calendar__button"
            onClick={() => setAttempt((value) => value + 1)}
          >
            {t('calendar.retry')}
          </button>
        </div>
      ) : !data ? (
        <div className="calendar__state">{t('calendar.loading')}</div>
      ) : data.columns.length === 0 ? (
        <div className="calendar__state">{t('calendar.noBarbers')}</div>
      ) : (
        <DayGrid
          data={data}
          busy={!settled}
          canCreate={(column) => isManager || column.barber.own}
          onOpen={(id) => setModal({ type: 'view', id })}
          onCreate={(barberId, start) => setModal({ type: 'create', barberId, start })}
        />
      )}
      {modal && data && (
        <AppointmentModal
          target={modal}
          data={data}
          isManager={isManager}
          onClose={() => setModal(null)}
          onChanged={() => setAttempt((value) => value + 1)}
        />
      )}
    </div>
  )
}
