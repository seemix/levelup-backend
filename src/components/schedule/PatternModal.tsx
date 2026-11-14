'use client'
import { useTranslation } from '@payloadcms/ui'
import { useState } from 'react'

import { WEEKDAYS } from '@/crm/schedule'

import { CrmApiError, useCrmApi, useErrorText } from '../calendar/api'
import { Modal } from '../calendar/Modal'
import { useCrmT } from '../calendar/useCrmT'
import { BreaksEditor } from './BreaksEditor'
import { hoursValid, weekdayName, type BreakRow, type RosterBarber } from './shared'

type Row = {
  weekday: number
  works: boolean
  location: string
  start: string
  end: string
  breaks: BreakRow[]
}

type Props = {
  barber: RosterBarber
  /** Location of the roster: the default for a newly enabled day. */
  locationId: string
  onClose: () => void
  onSaved: () => void
}

/**
 * Weekly pattern of a barber (§4.4): which weekdays they work, hours, breaks and location.
 * Saved through the standard `PATCH /api/barbers/:id` (`weeklySchedule`, field rule `barbers.schedule`).
 */
export const PatternModal = ({ barber, locationId, onClose, onSaved }: Props) => {
  const t = useCrmT()
  const { i18n } = useTranslation()
  const api = useCrmApi()
  const errorText = useErrorText()
  const defaultLocation = barber.locations.some((item) => item.id === locationId)
    ? locationId
    : (barber.locations[0]?.id ?? '')
  const [rows, setRows] = useState<Row[]>(() =>
    WEEKDAYS.map((weekday) => {
      const row = barber.pattern.find((item) => item.weekday === weekday)
      return row
        ? {
            weekday,
            works: true,
            location: row.location ?? defaultLocation,
            start: row.start,
            end: row.end,
            breaks: row.breaks,
          }
        : {
            weekday,
            works: false,
            location: defaultLocation,
            start: '09:00',
            end: '18:00',
            breaks: [],
          }
    }),
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = (weekday: number, patch: Partial<Row>) =>
    setRows((current) =>
      current.map((row) => (row.weekday === weekday ? { ...row, ...patch } : row)),
    )

  const copyToAll = (source: Row) =>
    setRows((current) =>
      current.map((row) =>
        row.works
          ? {
              ...row,
              start: source.start,
              end: source.end,
              breaks: source.breaks.map((b) => ({ ...b })),
            }
          : row,
      ),
    )

  const invalid = rows.filter(
    (row) => row.works && (!hoursValid(row.start, row.end, row.breaks) || !row.location),
  )

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      await api(`/barbers/${barber.id}?depth=0`, {
        method: 'PATCH',
        body: {
          weeklySchedule: rows
            .filter((row) => row.works)
            .map((row) => ({
              weekday: String(row.weekday),
              location: row.location,
              start: row.start,
              end: row.end,
              breaks: row.breaks,
            })),
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
      title={t('roster.patternModal.title', { name: barber.name })}
      onClose={onClose}
      footer={
        <div className="calendar-modal__actions">
          <button type="button" className="calendar__button" disabled={busy} onClick={onClose}>
            {t('roster.day.cancel')}
          </button>
          <button
            type="button"
            className="calendar__button calendar__button--dark"
            disabled={busy || invalid.length > 0}
            onClick={() => void save()}
          >
            {busy ? t('calendar.actions.working') : t('roster.patternModal.save')}
          </button>
        </div>
      }
    >
      <div className="calendar-modal__form">
        <p className="schedule-note">{t('roster.patternModal.description')}</p>
        {rows.map((row) => (
          <div
            key={row.weekday}
            className={`schedule-pattern__row${row.works ? '' : ' schedule-pattern__row--off'}`}
          >
            <label className="calendar-modal__check schedule-pattern__day">
              <input
                type="checkbox"
                checked={row.works}
                onChange={(event) => set(row.weekday, { works: event.target.checked })}
              />
              <strong>{weekdayName(row.weekday, i18n.language, 'long')}</strong>
            </label>
            {row.works && (
              <div className="schedule-pattern__body">
                <div className="calendar-modal__grid">
                  <label className="calendar-modal__field">
                    <span>{t('roster.day.start')}</span>
                    <input
                      type="time"
                      value={row.start}
                      onChange={(event) => set(row.weekday, { start: event.target.value })}
                    />
                  </label>
                  <label className="calendar-modal__field">
                    <span>{t('roster.day.end')}</span>
                    <input
                      type="time"
                      value={row.end}
                      onChange={(event) => set(row.weekday, { end: event.target.value })}
                    />
                  </label>
                  {barber.locations.length > 1 && (
                    <label className="calendar-modal__field">
                      <span>{t('roster.day.location')}</span>
                      <select
                        value={row.location}
                        onChange={(event) => set(row.weekday, { location: event.target.value })}
                      >
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
                    breaks={row.breaks}
                    onChange={(breaks) => set(row.weekday, { breaks })}
                    suggest={{ start: '13:00', end: '14:00' }}
                  />
                </div>
                <button type="button" className="schedule-link" onClick={() => copyToAll(row)}>
                  {t('roster.patternModal.copyToAll')}
                </button>
                {invalid.includes(row) && <p role="alert">{t('roster.day.hoursInvalid')}</p>}
              </div>
            )}
          </div>
        ))}
        {error && <p role="alert">{error}</p>}
      </div>
    </Modal>
  )
}
