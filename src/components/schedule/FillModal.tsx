'use client'
import { useState } from 'react'

import { eachLocalDate, isLocalDate } from '@/crm/time'

import { useCrmApi, useErrorText } from '../calendar/api'
import { Modal } from '../calendar/Modal'
import { useCrmT } from '../calendar/useCrmT'
import type { RosterBarber } from './shared'

/** Same limit as the server (`MAX_SCHEDULE_DAYS`). */
const MAX_DAYS = 62

type Props = {
  barbers: RosterBarber[]
  /** Default period: the shown month from today on (the whole month if it is in the future). */
  dateFrom: string
  dateTo: string
  onClose: () => void
  onSaved: () => void
}

type Result = { removed: number; updated: number; created: number }

/**
 * «Fill by pattern» (A44): removes manual changes of the period for the chosen barbers, so every
 * day follows the weekly pattern again. Vacations and sick leaves are kept unless unchecked.
 */
export const FillModal = ({ barbers, dateFrom: from, dateTo: to, onClose, onSaved }: Props) => {
  const t = useCrmT()
  const api = useCrmApi()
  const errorText = useErrorText()
  const [chosen, setChosen] = useState<string[]>(() => barbers.map((item) => item.id))
  const [dateFrom, setDateFrom] = useState(from)
  const [dateTo, setDateTo] = useState(to)
  const [keepAbsences, setKeepAbsences] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<Result | null>(null)

  const rangeValid =
    isLocalDate(dateFrom) &&
    isLocalDate(dateTo) &&
    dateFrom <= dateTo &&
    eachLocalDate(dateFrom, dateTo).length <= MAX_DAYS

  const toggle = (id: string, on: boolean) =>
    setChosen((current) => (on ? [...current, id] : current.filter((item) => item !== id)))

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const result = await api<Result>('/crm/schedule/fill', {
        method: 'POST',
        body: { barbers: chosen, dateFrom, dateTo, keepAbsences },
      })
      setDone(result)
      onSaved()
    } catch (caught) {
      setError(errorText(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={t('roster.fillModal.title')}
      onClose={onClose}
      footer={
        <div className="calendar-modal__actions">
          <button type="button" className="calendar__button" disabled={busy} onClick={onClose}>
            {done ? t('calendar.modal.close') : t('roster.day.cancel')}
          </button>
          {!done && (
            <button
              type="button"
              className="calendar__button calendar__button--dark"
              disabled={busy || !rangeValid || chosen.length === 0}
              onClick={() => void submit()}
            >
              {busy ? t('calendar.actions.working') : t('roster.fillModal.submit')}
            </button>
          )}
        </div>
      }
    >
      <div className="calendar-modal__form">
        <p className="schedule-note">{t('roster.fillModal.description')}</p>
        <div className="calendar-modal__grid">
          <label className="calendar-modal__field">
            <span>{t('roster.fillModal.dateFrom')}</span>
            <input
              type="date"
              value={dateFrom}
              onChange={(event) => {
                const value = event.target.value
                setDateFrom(value)
                if (value && dateTo < value) setDateTo(value)
              }}
            />
          </label>
          <label className="calendar-modal__field">
            <span>{t('roster.fillModal.dateTo')}</span>
            <input
              type="date"
              value={dateTo}
              min={dateFrom}
              onChange={(event) => setDateTo(event.target.value)}
            />
          </label>
        </div>
        {!rangeValid && <p role="alert">{t('roster.fillModal.rangeInvalid', { max: MAX_DAYS })}</p>}
        <fieldset className="calendar-modal__field calendar-modal__checks">
          <legend>{t('roster.fillModal.barbers')}</legend>
          {barbers.map((barber) => (
            <label key={barber.id} className="calendar-modal__check">
              <input
                type="checkbox"
                checked={chosen.includes(barber.id)}
                onChange={(event) => toggle(barber.id, event.target.checked)}
              />
              <span>
                {barber.name}
                {barber.pattern.length === 0 && (
                  <small className="schedule-note"> · {t('roster.fillModal.noPattern')}</small>
                )}
              </span>
            </label>
          ))}
        </fieldset>
        <label className="calendar-modal__check">
          <input
            type="checkbox"
            checked={keepAbsences}
            onChange={(event) => setKeepAbsences(event.target.checked)}
          />
          {t('roster.fillModal.keepAbsences')}
        </label>
        {done && <p role="status">{t('roster.fillModal.done', done)}</p>}
        {error && <p role="alert">{error}</p>}
      </div>
    </Modal>
  )
}
