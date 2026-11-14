'use client'
import { useTranslation } from '@payloadcms/ui'
import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react'

import { monthRange } from '@/crm/schedule-edit'
import { addLocalDays, eachLocalDate, isoWeekday, todayLocal } from '@/crm/time'

import '../calendar/calendar.scss'
import './schedule.scss'
import { useCrmApi } from '../calendar/api'
import { useCrmT } from '../calendar/useCrmT'
import { DayModal } from './DayModal'
import { FillModal } from './FillModal'
import { PatternModal } from './PatternModal'
import { ScheduleGrid, type GridColumn } from './ScheduleGrid'
import {
  monthTitle,
  shiftMonth,
  shortHours,
  weekdayName,
  type RosterBarber,
  type RosterDay,
  type RosterResponse,
} from './shared'

type Selection = { barber: string; dates: string[] }

type View = 'day' | 'week' | 'month'

const VIEWS: { view: View; label: 'calendar.day' | 'calendar.week' | 'roster.monthView' }[] = [
  { view: 'day', label: 'calendar.day' },
  { view: 'week', label: 'calendar.week' },
  { view: 'month', label: 'roster.monthView' },
]

const formatDate = (date: string, language: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat(language, { timeZone: 'UTC', ...options }).format(
    new Date(`${date}T12:00:00Z`),
  )

const range = (a: string, b: string) => (a <= b ? eachLocalDate(a, b) : eachLocalDate(b, a))

/**
 * Barber schedule (A44) in three views: day (columns — barbers) and week (columns — 7 days of one
 * barber) in the look of the appointments calendar, and month — the roster table (rows — barbers,
 * columns — days; drag / Shift+click / Ctrl+click selects several days of one barber). A click on a
 * day opens its editor; the weekly pattern and «fill by pattern» are edited here too.
 */
export const ScheduleClient = () => {
  const t = useCrmT()
  const { i18n } = useTranslation()
  const api = useCrmApi()
  const [view, setView] = useState<View>('day')
  const [date, setDate] = useState(() => todayLocal())
  const [weekBarber, setWeekBarber] = useState<string | null>(null)
  const month = date.slice(0, 7)
  const monday = addLocalDays(date, 1 - isoWeekday(date))
  const [location, setLocation] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<{ key: string; data: RosterResponse | null }>({
    key: '',
    data: null,
  })
  const [selection, setSelection] = useState<Selection | null>(null)
  const [editing, setEditing] = useState<Selection | null>(null)
  const [pattern, setPattern] = useState<string | null>(null)
  const [filling, setFilling] = useState(false)
  const anchor = useRef<{ barber: string; date: string } | null>(null)
  const drag = useRef<{ barber: string; from: string; moved: boolean } | null>(null)

  const period: Record<string, string> =
    view === 'month'
      ? { month }
      : view === 'week'
        ? { from: monday, to: addLocalDays(monday, 6) }
        : { from: date, to: date }
  const query = new URLSearchParams(period).toString()
  const key = [query, location ?? '', i18n.language, attempt].join('|')
  useEffect(() => {
    const controller = new AbortController()
    const params = new URLSearchParams(query)
    params.set('locale', i18n.language)
    if (location) params.set('location', location)
    api<RosterResponse>(`/crm/schedule?${params}`, { signal: controller.signal })
      .then((data) => setResult({ key, data }))
      .catch((error: unknown) => {
        if ((error as { name?: string }).name !== 'AbortError') setResult({ key, data: null })
      })
    return () => controller.abort()
  }, [api, key, query, location, i18n.language])

  // A drag ends anywhere on the page: a click without movement opens the editor of that day.
  useEffect(() => {
    const onUp = () => {
      const current = drag.current
      drag.current = null
      if (current && !current.moved) {
        setSelection(null)
        setEditing({ barber: current.barber, dates: [current.from] })
      }
    }
    document.addEventListener('mouseup', onUp)
    return () => document.removeEventListener('mouseup', onUp)
  }, [])

  const reload = useCallback(() => setAttempt((value) => value + 1), [])
  const goDate = (value: string) => {
    setSelection(null)
    setDate(value)
  }
  const shift = (delta: number) => {
    if (view === 'month') goDate(`${shiftMonth(month, delta)}-01`)
    else goDate(addLocalDays(date, view === 'week' ? delta * 7 : delta))
  }
  const short = { day: 'numeric', month: 'short' } as const
  const title =
    view === 'month'
      ? monthTitle(month, i18n.language)
      : view === 'week'
        ? `${formatDate(monday, i18n.language, short)} – ${formatDate(addLocalDays(monday, 6), i18n.language, short)}`
        : formatDate(date, i18n.language, { weekday: 'long', day: 'numeric', month: 'long' })

  const settled = result.key === key
  const data = result.data

  const onCellDown = (event: MouseEvent, barber: string, date: string) => {
    if (event.button !== 0) return
    event.preventDefault()
    if (event.shiftKey && anchor.current?.barber === barber) {
      setSelection({ barber, dates: range(anchor.current.date, date) })
      return
    }
    anchor.current = { barber, date }
    if (event.ctrlKey || event.metaKey) {
      const dates = selection && selection.barber === barber ? selection.dates : []
      const next = dates.includes(date) ? dates.filter((item) => item !== date) : [...dates, date]
      setSelection(next.length > 0 ? { barber, dates: next.sort() } : null)
      return
    }
    drag.current = { barber, from: date, moved: false }
    setSelection({ barber, dates: [date] })
  }

  const onCellEnter = (barber: string, date: string) => {
    const current = drag.current
    if (!current || current.barber !== barber) return
    if (date !== current.from) current.moved = true
    setSelection({ barber, dates: range(current.from, date) })
  }

  const cellTitle = (barber: RosterBarber, day: RosterDay) => {
    const lines = [
      day.status === 'work' ? `${day.start}–${day.end}` : t(`roster.status.${day.status}`),
    ]
    if (day.status === 'work' && day.breaks.length > 0)
      lines.push(
        t('roster.tooltip.breaks', {
          value: day.breaks.map((item) => `${item.start}–${item.end}`).join(', '),
        }),
      )
    if (day.status === 'work' && day.location && day.location !== data?.location) {
      const name = barber.locations.find((item) => item.id === day.location)?.name ?? ''
      lines.push(t('roster.tooltip.location', { name }))
    }
    if (day.override) lines.push(t('roster.tooltip.override'))
    if (day.comment) lines.push(day.comment)
    if (day.appointments > 0)
      lines.push(t('roster.tooltip.appointments', { count: day.appointments }))
    return lines.join('\n')
  }

  if (!settled && !data) return <div className="calendar__state">{t('calendar.loading')}</div>
  if (settled && !data)
    return (
      <div className="calendar__state">
        <p>{t('calendar.loadError')}</p>
        <button type="button" className="calendar__button" onClick={reload}>
          {t('calendar.retry')}
        </button>
      </div>
    )
  if (!data) return null

  const editable = data.barbers.filter((barber) => barber.canEdit)
  const today = data.today
  const dates = data.barbers[0]?.days.map((day) => day.date) ?? eachLocalDate(data.from, data.to)
  const editingBarber = editing ? data.barbers.find((item) => item.id === editing.barber) : null
  const patternBarber = pattern ? data.barbers.find((item) => item.id === pattern) : null
  const selectedBarber = selection
    ? data.barbers.find((item) => item.id === selection.barber)
    : null
  const fillMonth = monthRange(month)
  const fillFrom = today > fillMonth.from && today <= fillMonth.to ? today : fillMonth.from
  const weekRow =
    data.barbers.find((item) => item.id === weekBarber) ??
    data.barbers.find((item) => item.own) ??
    data.barbers[0]
  const gridColumns: GridColumn[] =
    view === 'day'
      ? data.barbers.flatMap((barber) => (barber.days[0] ? [{ barber, day: barber.days[0] }] : []))
      : view === 'week' && weekRow
        ? weekRow.days.map((day) => ({ barber: weekRow, day }))
        : []

  return (
    <div className={`calendar schedule${settled ? '' : ' schedule--busy'}`}>
      <div className="calendar-toolbar">
        <div className="calendar-toolbar__group">
          <h1 className="schedule__title">{t('roster.title')}</h1>
          {VIEWS.map((item) => (
            <button
              key={item.view}
              type="button"
              className={`calendar__pill${view === item.view ? ' calendar__pill--active' : ''}`}
              aria-pressed={view === item.view}
              onClick={() => {
                setSelection(null)
                setView(item.view)
              }}
            >
              {t(item.label)}
            </button>
          ))}
          <button
            type="button"
            className="calendar__button calendar__button--dark"
            onClick={() => goDate(todayLocal())}
          >
            {t('calendar.today')}
          </button>
          {view === 'week' && data.barbers.length > 1 && weekRow && (
            <select
              className="calendar__select"
              aria-label={t('calendar.barber')}
              value={weekRow.id}
              onChange={(event) => setWeekBarber(event.target.value)}
            >
              {data.barbers.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          )}
          {data.locations.length > 1 && (
            <select
              className="calendar__select"
              aria-label={t('roster.location')}
              value={data.location}
              onChange={(event) => {
                setSelection(null)
                setLocation(event.target.value)
              }}
            >
              {data.locations.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="calendar-toolbar__date">
          <button
            type="button"
            className="calendar__icon-button"
            aria-label={t(
              view === 'month'
                ? 'roster.previousMonth'
                : view === 'week'
                  ? 'calendar.previousWeek'
                  : 'calendar.previousDay',
            )}
            onClick={() => shift(-1)}
          >
            ‹
          </button>
          <label className="calendar-toolbar__current schedule__month">
            <strong>{title}</strong>
            <input
              className="calendar-toolbar__picker"
              type="date"
              value={date}
              onChange={(event) => event.target.value && goDate(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="calendar__icon-button"
            aria-label={t(
              view === 'month'
                ? 'roster.nextMonth'
                : view === 'week'
                  ? 'calendar.nextWeek'
                  : 'calendar.nextDay',
            )}
            onClick={() => shift(1)}
          >
            ›
          </button>
        </div>
        <div className="calendar-toolbar__group">
          {editable.length > 0 && (
            <button
              type="button"
              className="calendar__button calendar__button--dark"
              onClick={() => setFilling(true)}
            >
              {t('roster.fill')}
            </button>
          )}
        </div>
      </div>

      {view === 'month' && editable.length > 0 && (
        <p className="schedule-note">{t('roster.hint')}</p>
      )}

      {selection && selectedBarber && (
        <div className="schedule-selection" role="status">
          <span>
            {selectedBarber.name} · {t('roster.selected', { count: selection.dates.length })}
          </span>
          <button
            type="button"
            className="calendar__button calendar__button--dark"
            onClick={() => {
              setEditing(selection)
              setSelection(null)
            }}
          >
            {t('roster.editSelected')}
          </button>
          <button type="button" className="calendar__button" onClick={() => setSelection(null)}>
            {t('roster.clearSelection')}
          </button>
        </div>
      )}

      {data.barbers.length === 0 ? (
        <div className="calendar__state">{t('roster.empty')}</div>
      ) : view !== 'month' ? (
        <ScheduleGrid
          columns={gridColumns}
          mode={view}
          locationId={data.location}
          busy={!settled}
          onEdit={(barber, day) => setEditing({ barber: barber.id, dates: [day] })}
          onPattern={(barber) => setPattern(barber.id)}
        />
      ) : (
        <div className="schedule-roster">
          <table className="schedule-roster__table">
            <thead>
              <tr>
                <th className="schedule-roster__corner" scope="col">
                  {t('roster.barber')}
                </th>
                {dates.map((date) => {
                  const weekday = isoWeekday(date)
                  return (
                    <th
                      key={date}
                      scope="col"
                      className={[
                        'schedule-roster__date',
                        weekday >= 6 ? 'schedule-roster__date--weekend' : '',
                        date === today ? 'schedule-roster__date--today' : '',
                      ].join(' ')}
                    >
                      <span>{Number(date.slice(8))}</span>
                      <small>{weekdayName(weekday, i18n.language, 'short')}</small>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {data.barbers.map((barber) => (
                <tr key={barber.id}>
                  <th scope="row" className="schedule-roster__barber">
                    <span
                      className="schedule-roster__dot"
                      style={{ background: barber.color ?? undefined }}
                      aria-hidden
                    />
                    <span className="schedule-roster__name">
                      {barber.name}
                      {!barber.canEdit && <small>{t('roster.readOnly')}</small>}
                    </span>
                    {barber.canEditPattern && (
                      <button
                        type="button"
                        className="schedule-link"
                        onClick={() => setPattern(barber.id)}
                      >
                        {t('roster.pattern')}
                      </button>
                    )}
                  </th>
                  {barber.days.map((day) => {
                    const selected =
                      selection?.barber === barber.id && selection.dates.includes(day.date)
                    const elsewhere =
                      day.status === 'work' && !!day.location && day.location !== data.location
                    const className = [
                      'schedule-cell',
                      `schedule-cell--${day.status}`,
                      day.override ? 'schedule-cell--override' : '',
                      elsewhere ? 'schedule-cell--elsewhere' : '',
                      selected ? 'schedule-cell--selected' : '',
                      isoWeekday(day.date) >= 6 ? 'schedule-cell--weekend' : '',
                      day.date === today ? 'schedule-cell--today' : '',
                    ].join(' ')
                    const label =
                      day.status === 'work'
                        ? shortHours(day.start, day.end)
                        : day.status === 'off'
                          ? ''
                          : t(`roster.short.${day.status}`)
                    const content = (
                      <>
                        <span className="schedule-cell__label">{label}</span>
                        {day.appointments > 0 && (
                          <span className="schedule-cell__count">{day.appointments}</span>
                        )}
                      </>
                    )
                    return (
                      <td key={day.date} className="schedule-roster__cell">
                        {barber.canEdit ? (
                          <button
                            type="button"
                            className={className}
                            title={cellTitle(barber, day)}
                            aria-pressed={selected}
                            onMouseDown={(event) => onCellDown(event, barber.id, day.date)}
                            onMouseEnter={() => onCellEnter(barber.id, day.date)}
                            onClick={(event) => {
                              // Keyboard activation (mouse clicks are handled on mouseup).
                              if (event.detail === 0)
                                setEditing({ barber: barber.id, dates: [day.date] })
                            }}
                          >
                            {content}
                          </button>
                        ) : (
                          <div className={className} title={cellTitle(barber, day)}>
                            {content}
                          </div>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {view === 'month' && (
        <ul className="schedule-legend">
          <li>
            <span className="schedule-cell schedule-cell--work schedule-cell--override">
              <span className="schedule-cell__label">{shortHours('10:00', '19:00')}</span>
            </span>
            {t('roster.legend.override')}
          </li>
          <li>
            <span className="schedule-cell schedule-cell--work">
              <span className="schedule-cell__count">2</span>
            </span>
            {t('roster.legend.appointments')}
          </li>
          <li>
            <span className="schedule-cell schedule-cell--work schedule-cell--elsewhere" />
            {t('roster.legend.otherLocation')}
          </li>
          {(['day_off', 'vacation', 'sick'] as const).map((status) => (
            <li key={status}>
              <span className={`schedule-cell schedule-cell--${status}`}>
                <span className="schedule-cell__label">{t(`roster.short.${status}`)}</span>
              </span>
              {t(`roster.status.${status}`)}
            </li>
          ))}
        </ul>
      )}

      {editing && editingBarber && (
        <DayModal
          barber={editingBarber}
          dates={editing.dates}
          locationId={data.location}
          onClose={() => setEditing(null)}
          onSaved={reload}
        />
      )}
      {patternBarber && (
        <PatternModal
          barber={patternBarber}
          locationId={data.location}
          onClose={() => setPattern(null)}
          onSaved={reload}
        />
      )}
      {filling && (
        <FillModal
          barbers={editable}
          dateFrom={fillFrom}
          dateTo={fillMonth.to}
          onClose={() => setFilling(false)}
          onSaved={reload}
        />
      )}
    </div>
  )
}
