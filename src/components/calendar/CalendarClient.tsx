'use client'
import { useAuth, useConfig, useTranslation } from '@payloadcms/ui'
import { useEffect, useRef, useState } from 'react'

import { defaultNewStart } from '@/crm/appointment-form'
import { moveBody, moveInColumns } from '@/crm/calendar-move'
import type { CrmWarning } from '@/endpoints/crm/http'
import { addLocalDays, todayLocal } from '@/crm/time'

import './calendar.scss'
import { AppointmentModal, type ModalTarget } from './AppointmentModal'
import { CrmApiError, useCrmApi, useErrorText } from './api'
import { DayGrid } from './DayGrid'
import { Modal } from './Modal'
import { Toolbar } from './Toolbar'
import type { CalendarData } from './types'
import { useCrmT } from './useCrmT'
import { WarningsPanel } from './WarningsPanel'

type MoveState = {
  id: string
  start: { start: string }
  fromBarber: string
  toBarber: string
  delta: number
  snapshot: CalendarData
  busy: boolean
  pending: { warnings: CrmWarning[]; total: { from: number; to: number } | null } | null
}

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

  const api = useCrmApi()
  const errorText = useErrorText()
  const [moveError, setMoveError] = useState<string | null>(null)
  // A move in flight: the optimistic position is already shown; `snapshot` is the rollback point.
  const [move, setMove] = useState<MoveState | null>(null)
  const moveRef = useRef(false)

  const settled = result.key === key
  const error = settled && result.data === null
  const data = result.data

  const rollback = (snapshot: CalendarData) =>
    setResult((current) => ({ ...current, data: snapshot }))

  const sendMove = async (state: MoveState, confirm: boolean) => {
    setMove({ ...state, busy: true })
    try {
      await api(`/crm/appointments/${state.id}`, {
        method: 'PATCH',
        body: moveBody(state.start, state.fromBarber, state.toBarber, state.delta, confirm),
      })
      setMove(null)
      moveRef.current = false
      setAttempt((value) => value + 1) // reload the truth (price, status, neighbours)
    } catch (caught) {
      const confirmation = caught instanceof CrmApiError ? caught.confirmation : null
      if (confirmation && !confirm) {
        setMove({ ...state, busy: false, pending: confirmation })
        return
      }
      rollback(state.snapshot)
      setMove(null)
      moveRef.current = false
      setMoveError(errorText(caught))
    }
  }

  const onMove = (id: string, toBarber: string, delta: number) => {
    if (!data || moveRef.current) return
    const column = data.columns.find((item) =>
      item.appointments.some((appointment) => 'id' in appointment && appointment.id === id),
    )
    const item = column?.appointments.find(
      (appointment) => 'id' in appointment && appointment.id === id,
    )
    if (!column || !item || !('id' in item)) return
    const columns = moveInColumns(data.columns, id, toBarber, delta)
    if (!columns) return
    moveRef.current = true
    setMoveError(null)
    setResult((current) => ({ ...current, data: { ...data, columns } }))
    void sendMove(
      {
        id,
        start: { start: item.start },
        fromBarber: column.barber.id,
        toBarber,
        delta,
        snapshot: data,
        busy: true,
        pending: null,
      },
      false,
    )
  }

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
          canMove={(appointment, column) =>
            !move &&
            'id' in appointment &&
            appointment.status === 'scheduled' &&
            (isManager || column.barber.own)
          }
          canDropInto={(column) => isManager || column.barber.own}
          onMove={onMove}
        />
      )}
      {moveError && (
        <div className="calendar__toast" role="alert">
          <span>{moveError}</span>
          <button
            type="button"
            className="calendar__icon-button"
            aria-label={t('calendar.modal.close')}
            onClick={() => setMoveError(null)}
          >
            ×
          </button>
        </div>
      )}
      {move?.pending && (
        <Modal
          title={t('calendar.move.title')}
          onClose={() => {
            rollback(move.snapshot)
            setMove(null)
            moveRef.current = false
          }}
        >
          <WarningsPanel
            warnings={move.pending.warnings}
            total={move.pending.total}
            busy={move.busy}
            onBack={() => {
              rollback(move.snapshot)
              setMove(null)
              moveRef.current = false
            }}
            onConfirm={() => void sendMove(move, true)}
          />
        </Modal>
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
