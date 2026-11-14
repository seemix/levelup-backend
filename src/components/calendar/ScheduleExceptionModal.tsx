'use client'
import { useTranslation } from '@payloadcms/ui'
import { useEffect, useState } from 'react'

import { validateDateRange } from '@/crm/schedule'
import { formatDateTime, isLocalTime, timeToMinutes } from '@/crm/time'

import { CrmApiError, useCrmApi, useErrorText } from './api'
import { Modal } from './Modal'
import type { CalendarColumn } from './types'
import { useCrmT } from './useCrmT'

export type ExceptionKind = 'custom_hours' | 'day_off' | 'vacation'

export type ExceptionTarget = { column: CalendarColumn; kind: ExceptionKind }

type Preview = { count: number; appointments: { id: string; start: string }[] }

const TITLES = {
  custom_hours: 'titleHours',
  day_off: 'titleDayOff',
  vacation: 'titleVacation',
} as const

const LISTED = 5

type Props = {
  target: ExceptionTarget
  /** Calendar location: a custom-hours exception works in it. */
  locationId: string
  onClose: () => void
  /** The exception was created: reload the calendar. */
  onSaved: () => void
}

/**
 * Creates a schedule exception from a calendar column (spec §4.5, stage 20): day off, vacation or
 * custom hours. Before saving, the server is asked which scheduled appointments fall into the range
 * — they are shown as a warning and are not cancelled automatically.
 */
export const ScheduleExceptionModal = ({ target, locationId, onClose, onSaved }: Props) => {
  const { column, kind } = target
  const t = useCrmT()
  const { i18n } = useTranslation()
  const api = useCrmApi()
  const errorText = useErrorText()
  const [dateFrom, setDateFrom] = useState(column.date)
  const [dateTo, setDateTo] = useState(column.date)
  const [start, setStart] = useState('09:00')
  const [end, setEnd] = useState('18:00')
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ key: string; value: Preview | null }>({
    key: '',
    value: null,
  })

  const barberId = column.barber.id
  const rangeValid = validateDateRange(dateFrom, dateTo) === null
  const hoursValid =
    kind !== 'custom_hours' ||
    (isLocalTime(start) && isLocalTime(end) && timeToMinutes(start) < timeToMinutes(end))
  const previewKey = `${barberId}|${dateFrom}|${dateTo}`

  useEffect(() => {
    if (!rangeValid) return
    const controller = new AbortController()
    const params = new URLSearchParams({ barber: barberId, dateFrom, dateTo })
    api<Preview>(`/crm/schedule-exceptions/preview?${params}`, { signal: controller.signal })
      .then((value) => setPreview({ key: previewKey, value }))
      .catch((caught: unknown) => {
        if ((caught as { name?: string }).name !== 'AbortError')
          setPreview({ key: previewKey, value: null })
      })
    return () => controller.abort()
  }, [api, barberId, dateFrom, dateTo, previewKey, rangeValid])

  const checking = rangeValid && preview.key !== previewKey
  const found = preview.key === previewKey ? preview.value : null

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      await api('/schedule-exceptions', {
        method: 'POST',
        body: {
          barber: barberId,
          kind,
          dateFrom,
          dateTo,
          ...(kind === 'custom_hours' ? { location: locationId, start, end } : {}),
          ...(comment.trim() ? { comment: comment.trim() } : {}),
        },
      })
      onSaved()
      onClose()
    } catch (caught) {
      // Validation of the collection (e.g. overlapping exceptions) comes with a translated message.
      const messages = caught instanceof CrmApiError ? caught.details.messages : null
      setError(
        Array.isArray(messages) && messages.length > 0 ? messages.join('; ') : errorText(caught),
      )
      setBusy(false)
    }
  }

  return (
    <Modal
      title={`${t(`calendar.schedule.${TITLES[kind]}`)} · ${column.barber.name}`}
      onClose={onClose}
      footer={
        <div className="calendar-modal__actions">
          <button type="button" className="calendar__button" disabled={busy} onClick={onClose}>
            {t('calendar.actions.back')}
          </button>
          <button
            type="button"
            className="calendar__button calendar__button--dark"
            disabled={busy || !rangeValid || !hoursValid}
            onClick={() => void save()}
          >
            {busy ? t('calendar.actions.working') : t('calendar.schedule.save')}
          </button>
        </div>
      }
    >
      <div className="calendar-modal__form">
        <div className="calendar-modal__grid">
          <label className="calendar-modal__field">
            <span>{t('calendar.schedule.dateFrom')}</span>
            <input
              type="date"
              value={dateFrom}
              onChange={(event) => {
                const value = event.target.value
                setDateFrom(value)
                // Keep the range valid while the start moves forward.
                if (value && dateTo < value) setDateTo(value)
              }}
            />
          </label>
          <label className="calendar-modal__field">
            <span>{t('calendar.schedule.dateTo')}</span>
            <input
              type="date"
              value={dateTo}
              min={dateFrom}
              onChange={(event) => setDateTo(event.target.value)}
            />
          </label>
        </div>
        {kind === 'custom_hours' && (
          <div className="calendar-modal__grid">
            <label className="calendar-modal__field">
              <span>{t('calendar.schedule.start')}</span>
              <input type="time" value={start} onChange={(event) => setStart(event.target.value)} />
            </label>
            <label className="calendar-modal__field">
              <span>{t('calendar.schedule.end')}</span>
              <input type="time" value={end} onChange={(event) => setEnd(event.target.value)} />
            </label>
          </div>
        )}
        <label className="calendar-modal__field">
          <span>{t('calendar.schedule.comment')}</span>
          <textarea rows={2} value={comment} onChange={(event) => setComment(event.target.value)} />
        </label>
        {!rangeValid && <p role="alert">{t('calendar.schedule.rangeInvalid')}</p>}
        {rangeValid && !hoursValid && <p role="alert">{t('calendar.schedule.hoursInvalid')}</p>}
        {checking && <p>{t('calendar.schedule.checking')}</p>}
        {found && found.count > 0 && (
          <div className="calendar-warnings" role="alert">
            <p>{t('calendar.schedule.appointmentsWarning', { count: found.count })}</p>
            <ul>
              {found.appointments.slice(0, LISTED).map((item) => (
                <li key={item.id}>{formatDateTime(new Date(item.start), i18n.language)}</li>
              ))}
              {found.count > LISTED && (
                <li>{t('calendar.schedule.appointmentsMore', { count: found.count - LISTED })}</li>
              )}
            </ul>
          </div>
        )}
        {error && <p role="alert">{error}</p>}
      </div>
    </Modal>
  )
}
