'use client'
import { useTranslation } from '@payloadcms/ui'

import { useCrmT } from './useCrmT'

type Props = {
  date: string
  locations: { id: string; name: string }[]
  location: string | null
  cancelled: boolean
  onDate: (date: string) => void
  onToday: () => void
  onShift: (days: number) => void
  onLocation: (id: string) => void
  onCancelled: (value: boolean) => void
}

/** Day and weekday of a `YYYY-MM-DD` in the admin language (UTC noon: no zone shift). */
const formatDay = (date: string, language: string) => {
  const instant = new Date(`${date}T12:00:00Z`)
  const format = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(language, { timeZone: 'UTC', ...options }).format(instant)
  return { main: format({ day: 'numeric', month: 'long' }), weekday: format({ weekday: 'long' }) }
}

export const Toolbar = ({
  date,
  locations,
  location,
  cancelled,
  onDate,
  onToday,
  onShift,
  onLocation,
  onCancelled,
}: Props) => {
  const t = useCrmT()
  const { i18n } = useTranslation()
  const day = formatDay(date, i18n.language)
  return (
    <div className="calendar-toolbar">
      <div className="calendar-toolbar__group">
        <span className="calendar__pill">{t('calendar.day')}</span>
        <button type="button" className="calendar__button calendar__button--dark" onClick={onToday}>
          {t('calendar.today')}
        </button>
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
          aria-label={t('calendar.previousDay')}
          onClick={() => onShift(-1)}
        >
          ‹
        </button>
        <label className="calendar-toolbar__current">
          <strong>{day.main}</strong>
          <span>{day.weekday}</span>
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
          aria-label={t('calendar.nextDay')}
          onClick={() => onShift(1)}
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
