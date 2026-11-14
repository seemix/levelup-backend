'use client'
import { useTranslation } from '@payloadcms/ui'
import { useState } from 'react'

import type { DayValueKind } from '@/crm/schedule-edit'

import { CrmApiError, useCrmApi, useErrorText } from '../calendar/api'
import { Modal } from '../calendar/Modal'
import { useCrmT } from '../calendar/useCrmT'
import { BreaksEditor } from './BreaksEditor'
import { hoursValid, shortDate, type BreakRow, type RosterBarber } from './shared'

const KINDS: DayValueKind[] = ['custom_hours', 'day_off', 'vacation', 'sick', 'pattern']

type Props = {
  barber: RosterBarber
  dates: string[]
  /** Location of the roster: the default for working hours. */
  locationId: string
  onClose: () => void
  onSaved: () => void
}

/** Collapses sorted dates into «3–5 Nov, 8 Nov» for the header of the dialog. */
const describeDates = (dates: string[], language: string): string => {
  const runs: string[][] = []
  for (const date of dates) {
    const last = runs[runs.length - 1]
    const previous = last?.[last.length - 1]
    const next = previous ? new Date(`${previous}T12:00:00Z`) : null
    next?.setUTCDate(next.getUTCDate() + 1)
    if (last && next && next.toISOString().slice(0, 10) === date) last.push(date)
    else runs.push([date])
  }
  return runs
    .map((run) =>
      run.length === 1
        ? shortDate(run[0], language)
        : `${shortDate(run[0], language)} – ${shortDate(run[run.length - 1], language)}`,
    )
    .join(', ')
}

/**
 * Changes one or several days of a barber (A44): working hours, day off, vacation, sick leave, or
 * back to the weekly pattern. Saved as schedule exceptions by `POST /api/crm/schedule/days`.
 */
export const DayModal = ({ barber, dates, locationId, onClose, onSaved }: Props) => {
  const t = useCrmT()
  const { i18n } = useTranslation()
  const api = useCrmApi()
  const errorText = useErrorText()
  const days = barber.days.filter((day) => dates.includes(day.date))
  const first = days[0]
  const fallbackLocation = barber.locations.some((item) => item.id === locationId)
    ? locationId
    : (barber.locations[0]?.id ?? '')
  const template = barber.pattern[0]

  const [kind, setKind] = useState<DayValueKind>(() => {
    if (!first?.override || first.status === 'work') return 'custom_hours'
    return first.status === 'off' ? 'custom_hours' : first.status
  })
  const [start, setStart] = useState(first?.start ?? template?.start ?? '09:00')
  const [end, setEnd] = useState(first?.end ?? template?.end ?? '18:00')
  const [location, setLocation] = useState(first?.location ?? fallbackLocation)
  const [breaks, setBreaks] = useState<BreakRow[]>(
    first?.status === 'work' ? first.breaks : (template?.breaks ?? []),
  )
  const [comment, setComment] = useState(first?.override ? (first.comment ?? '') : '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const valid = kind !== 'custom_hours' || hoursValid(start, end, breaks)
  const appointments = days.reduce((total, day) => total + day.appointments, 0)

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      await api('/crm/schedule/days', {
        method: 'POST',
        body: {
          barber: barber.id,
          dates,
          kind,
          ...(kind === 'custom_hours' ? { location, start, end, breaks } : {}),
          ...(kind !== 'pattern' && comment.trim() ? { comment: comment.trim() } : {}),
        },
      })
      onSaved()
      onClose()
    } catch (caught) {
      const messages = caught instanceof CrmApiError ? caught.details.messages : null
      setError(
        Array.isArray(messages) && messages.length > 0 ? messages.join('; ') : errorText(caught),
      )
      setBusy(false)
    }
  }

  return (
    <Modal
      title={t('roster.day.title', { name: barber.name })}
      onClose={onClose}
      footer={
        <div className="calendar-modal__actions">
          <button type="button" className="calendar__button" disabled={busy} onClick={onClose}>
            {t('roster.day.cancel')}
          </button>
          <button
            type="button"
            className="calendar__button calendar__button--dark"
            disabled={busy || !valid || !location}
            onClick={() => void save()}
          >
            {busy ? t('calendar.actions.working') : t('roster.day.save')}
          </button>
        </div>
      }
    >
      <div className="calendar-modal__form">
        <dl className="calendar-modal__list">
          <div className="calendar-modal__row">
            <dt>{t('roster.day.dates')}</dt>
            <dd>{describeDates(dates, i18n.language)}</dd>
          </div>
        </dl>
        <fieldset className="calendar-modal__field">
          <legend>{t('roster.day.kind')}</legend>
          <div className="schedule-kinds" role="radiogroup">
            {KINDS.map((item) => (
              <button
                key={item}
                type="button"
                role="radio"
                aria-checked={kind === item}
                className={`calendar-modal__tab${kind === item ? ' calendar-modal__tab--active' : ''}`}
                onClick={() => setKind(item)}
              >
                {t(`roster.day.kinds.${item}`)}
              </button>
            ))}
          </div>
        </fieldset>
        {kind === 'pattern' && <p className="schedule-note">{t('roster.day.patternHint')}</p>}
        {kind === 'custom_hours' && (
          <>
            <div className="calendar-modal__grid">
              <label className="calendar-modal__field">
                <span>{t('roster.day.start')}</span>
                <input
                  type="time"
                  value={start}
                  onChange={(event) => setStart(event.target.value)}
                />
              </label>
              <label className="calendar-modal__field">
                <span>{t('roster.day.end')}</span>
                <input type="time" value={end} onChange={(event) => setEnd(event.target.value)} />
              </label>
              {barber.locations.length > 1 && (
                <label className="calendar-modal__field">
                  <span>{t('roster.day.location')}</span>
                  <select value={location} onChange={(event) => setLocation(event.target.value)}>
                    {barber.locations.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            <div className="calendar-modal__field">
              <span>{t('roster.day.breaks')}</span>
              <BreaksEditor
                breaks={breaks}
                onChange={setBreaks}
                suggest={{ start: '13:00', end: '14:00' }}
              />
            </div>
          </>
        )}
        {kind !== 'pattern' && (
          <label className="calendar-modal__field">
            <span>{t('roster.day.comment')}</span>
            <textarea
              rows={2}
              value={comment}
              onChange={(event) => setComment(event.target.value)}
            />
          </label>
        )}
        {!valid && <p role="alert">{t('roster.day.hoursInvalid')}</p>}
        {appointments > 0 && (
          <div className="calendar-warnings" role="alert">
            <p>{t('roster.day.appointmentsWarning', { count: appointments })}</p>
          </div>
        )}
        {error && <p role="alert">{error}</p>}
      </div>
    </Modal>
  )
}
