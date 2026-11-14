'use client'
import { useTranslation } from '@payloadcms/ui'
import { useEffect, useRef, useState } from 'react'

import { isCancelledStatus } from '@/crm/appointment-status'

import type { ExceptionKind } from './ScheduleExceptionModal'
import type { CalendarColumn } from './types'
import { useCrmT } from './useCrmT'

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('')

/** Weekday and day of a `YYYY-MM-DD` in the admin language (UTC noon: no zone shift). */
const formatColumnDay = (date: string, language: string) => {
  const instant = new Date(`${date}T12:00:00Z`)
  const format = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(language, { timeZone: 'UTC', ...options }).format(instant)
  return { weekday: format({ weekday: 'short' }), day: format({ day: 'numeric', month: 'short' }) }
}

const MENU_ITEMS: { kind: ExceptionKind; label: 'addHours' | 'dayOff' | 'vacation' }[] = [
  { kind: 'custom_hours', label: 'addHours' },
  { kind: 'day_off', label: 'dayOff' },
  { kind: 'vacation', label: 'vacation' },
]

type Props = {
  column: CalendarColumn
  /** Day view: the barber; week view: the day of the barber. */
  mode: 'day' | 'week'
  today: boolean
  /** Admin/manager: the «Schedule» menu (convenience only — the server checks the rights). */
  canSchedule: boolean
  onSchedule: (kind: ExceptionKind) => void
}

/** Column header: avatar, name, position, number of (not cancelled) appointments, schedule menu. */
export const ColumnHeader = ({ column, mode, today, canSchedule, onSchedule }: Props) => {
  const t = useCrmT()
  const { i18n } = useTranslation()
  const { barber } = column
  const count = column.appointments.filter(
    (item) => 'busy' in item || !isCancelledStatus(item.status),
  ).length
  const [open, setOpen] = useState(false)
  const menu = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onMouse = (event: MouseEvent) => {
      if (!menu.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onMouse)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onMouse)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const day = formatColumnDay(column.date, i18n.language)
  return (
    <div
      className={`calendar-head${barber.own ? ' calendar-head--own' : ''}${today ? ' calendar-head--today' : ''}`}
      title={barber.own ? t('calendar.own') : undefined}
    >
      {mode === 'day' &&
        (barber.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="calendar-head__avatar" src={barber.image} alt="" />
        ) : (
          <span className="calendar-head__avatar calendar-head__avatar--empty" aria-hidden="true">
            {initials(barber.name)}
          </span>
        ))}
      <span className="calendar-head__text">
        {mode === 'day' ? (
          <>
            <span className="calendar-head__name">{barber.name}</span>
            {barber.position && <span className="calendar-head__position">{barber.position}</span>}
          </>
        ) : (
          <>
            <span className="calendar-head__name">{day.weekday}</span>
            <span className="calendar-head__position">{day.day}</span>
          </>
        )}
      </span>
      {count > 0 && (
        <span className="calendar-head__count" title={t('calendar.appointmentsCount', { count })}>
          {count}
        </span>
      )}
      {canSchedule && (
        <div className="calendar-head__menu" ref={menu}>
          <button
            type="button"
            className="calendar__icon-button"
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label={t('calendar.schedule.menu')}
            title={t('calendar.schedule.menu')}
            onClick={() => setOpen((value) => !value)}
          >
            ⋯
          </button>
          {open && (
            <div className="calendar-head__popup" role="menu">
              {MENU_ITEMS.map((item) => (
                <button
                  key={item.kind}
                  type="button"
                  role="menuitem"
                  className="calendar-head__item"
                  onClick={() => {
                    setOpen(false)
                    onSchedule(item.kind)
                  }}
                >
                  {t(`calendar.schedule.${item.label}`)}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
