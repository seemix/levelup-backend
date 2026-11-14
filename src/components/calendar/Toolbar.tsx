'use client'
import { useTranslation } from '@payloadcms/ui'

import { addLocalDays, isoWeekday } from '@/crm/time'

import { useCrmT } from './useCrmT'

export type CalendarMode = 'day' | 'week'

type Props = {
  view: CalendarMode
  onView: (view: CalendarMode) => void
  /** Barbers of the location and the selected one (week view). */
  barbers: { id: string; name: string }[]
  barber: string | null
  onBarber: (id: string) => void
  date: string
  locations: { id: string; name: string }[]
  location: string | null
  cancelled: boolean
  onDate: (date: string) => void
  onToday: () => void
  onShift: (days: number) => void
  onLocation: (id: string) => void
  onCancelled: (value: boolean) => void
  onNew: () => void
}

/** Day and weekday of a `YYYY-MM-DD` in the admin language (UTC noon: no zone shift). */
const formatDay = (date: string, language: string) => {
  const instant = new Date(`${date}T12:00:00Z`)
  const format = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(language, { timeZone: 'UTC', ...options }).format(instant)
  return { main: format({ day: 'numeric', month: 'long' }), weekday: format({ weekday: 'long' }) }
}

/** «10 Nov – 16 Nov» of the Monday…Sunday week containing `date`. */
const formatWeek = (date: string, language: string) => {
  const monday = addLocalDays(date, 1 - isoWeekday(date))
  const part = (value: string) =>
    new Intl.DateTimeFormat(language, { timeZone: 'UTC', day: 'numeric', month: 'short' }).format(
      new Date(`${value}T12:00:00Z`),
    )
  return `${part(monday)} – ${part(addLocalDays(monday, 6))}`
}

export const Toolbar = ({
  view,
  onView,
  barbers,
  barber,
  onBarber,
  date,
  locations,
  location,
  cancelled,
  onDate,
  onToday,
  onShift,
  onLocation,
  onCancelled,
  onNew,
}: Props) => {
  const t = useCrmT()
  const { i18n } = useTranslation()
  const day = formatDay(date, i18n.language)
  return (
    <div className="calendar-toolbar">
      <div className="calendar-toolbar__group">
        <button
          type="button"
          className="calendar__button calendar__button--primary"
          onClick={onNew}
        >
          + {t('calendar.newBooking')}
        </button>
        {(['day', 'week'] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            className={`calendar__pill${view === mode ? ' calendar__pill--active' : ''}`}
            aria-pressed={view === mode}
            onClick={() => onView(mode)}
          >
            {t(`calendar.${mode}`)}
          </button>
        ))}
        <button type="button" className="calendar__button calendar__button--dark" onClick={onToday}>
          {t('calendar.today')}
        </button>
        {view === 'week' && barbers.length > 0 && (
          <select
            className="calendar__select"
            aria-label={t('calendar.barber')}
            value={barber ?? ''}
            onChange={(event) => onBarber(event.target.value)}
          >
            {barbers.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        )}
        {locations.length > 1 && (
          <select
            className="calendar__select"
            aria-label={t('calendar.location')}
            value={location ?? ''}
            onChange={(event) => onLocation(event.target.value)}
          >
            {locations.map((item) => (
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
          aria-label={t(view === 'week' ? 'calendar.previousWeek' : 'calendar.previousDay')}
          onClick={() => onShift(view === 'week' ? -7 : -1)}
        >
          ‹
        </button>
        <label className="calendar-toolbar__current">
          {view === 'week' ? (
            <strong>{formatWeek(date, i18n.language)}</strong>
          ) : (
            <>
              <strong>{day.main}</strong>
              <span>{day.weekday}</span>
            </>
          )}
          <input
            className="calendar-toolbar__picker"
            type="date"
            value={date}
            onChange={(event) => event.target.value && onDate(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="calendar__icon-button"
          aria-label={t(view === 'week' ? 'calendar.nextWeek' : 'calendar.nextDay')}
          onClick={() => onShift(view === 'week' ? 7 : 1)}
        >
          ›
        </button>
      </div>
      <label className="calendar-toolbar__toggle">
        <input
          type="checkbox"
          checked={cancelled}
          onChange={(event) => onCancelled(event.target.checked)}
        />
        {t('calendar.showCancelled')}
      </label>
    </div>
  )
}
