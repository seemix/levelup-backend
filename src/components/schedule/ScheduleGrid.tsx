'use client'
import { useTranslation } from '@payloadcms/ui'
import { useEffect, useMemo, useState, type CSSProperties } from 'react'

import {
  blockPosition,
  gridRows,
  nowLinePosition,
  offHoursSegments,
  readableTextColor,
  visibleRange,
  type IsoInterval,
} from '@/crm/calendar-layout'
import { barberColorAt } from '@/crm/colors'
import { subtractBreaks } from '@/crm/schedule'
import { localToInstant, minutesToTime, timeToMinutes, toLocalDate, toLocalTime } from '@/crm/time'

import { useCrmT } from '../calendar/useCrmT'
import type { RosterBarber, RosterDay } from './shared'

/** Half the scale of the appointments calendar: a whole working day fits on the screen. */
const PX_PER_MINUTE = 1
const ROW_MINUTES = 30
const NOW_REFRESH_MS = 30_000

export type GridColumn = { barber: RosterBarber; day: RosterDay }

/** Working intervals of a roster day (hours minus breaks) as ISO instants. */
const workIntervals = ({ date, status, start, end, breaks }: RosterDay): IsoInterval[] => {
  if (status !== 'work' || !start || !end) return []
  const from = timeToMinutes(start)
  const to = timeToMinutes(end)
  if (from >= to) return []
  return subtractBreaks({ start: from, end: to }, breaks).map((item) => ({
    start: localToInstant(date, minutesToTime(item.start)).toISOString(),
    end: localToInstant(date, minutesToTime(item.end)).toISOString(),
  }))
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('')

type Props = {
  columns: GridColumn[]
  /** Day: columns are barbers; week: columns are the days of one barber. */
  mode: 'day' | 'week'
  /** Location of the roster: a day in another location is shown faded. */
  locationId: string
  busy: boolean
  onEdit: (barber: RosterBarber, date: string) => void
  onPattern: (barber: RosterBarber) => void
}

/**
 * Day / week view of the schedule in the look of the appointments calendar (A44): a time axis,
 * working hours as blocks in the barber colour, breaks and non-working time hatched. A click on a
 * column opens the editor of that day (when the user may change it).
 */
export const ScheduleGrid = ({ columns, mode, locationId, busy, onEdit, onPattern }: Props) => {
  const t = useCrmT()
  const { i18n } = useTranslation()
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), NOW_REFRESH_MS)
    return () => clearInterval(timer)
  }, [])
  const today = toLocalDate(now)

  const date = columns[0]?.day.date ?? today
  const intervals = useMemo(
    () => new Map(columns.map((column) => [column, workIntervals(column.day)])),
    [columns],
  )
  const range = useMemo(() => {
    const ranges = columns
      .map((column) => ({ day: column.day.date, list: intervals.get(column) ?? [] }))
      .filter((item) => item.list.length > 0)
      .map((item) => visibleRange(item.day, item.list))
    if (ranges.length === 0) return visibleRange(date, [])
    return {
      from: Math.min(...ranges.map((item) => item.from)),
      to: Math.max(...ranges.map((item) => item.to)),
    }
  }, [columns, intervals, date])
  const hours = useMemo(
    () => gridRows(date, range.from, range.to, 60).filter((row) => row.hour),
    [date, range],
  )
  const barberIds = [...new Set(columns.map((column) => column.barber.id))]
  const colorOf = (barber: RosterBarber) =>
    barber.color ?? barberColorAt(barberIds.indexOf(barber.id))
  const nowTop = mode === 'day' ? nowLinePosition(date, now, range, PX_PER_MINUTE) : null

  const style = {
    '--calendar-columns': columns.length,
    '--calendar-height': `${(range.to - range.from) * PX_PER_MINUTE}px`,
    '--calendar-row': `${ROW_MINUTES * PX_PER_MINUTE}px`,
    '--calendar-hour': `${60 * PX_PER_MINUTE}px`,
  } as CSSProperties

  const formatDay = (value: string) => {
    const instant = new Date(`${value}T12:00:00Z`)
    const format = (options: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat(i18n.language, { timeZone: 'UTC', ...options }).format(instant)
    return {
      weekday: format({ weekday: 'short' }),
      day: format({ day: 'numeric', month: 'short' }),
    }
  }

  return (
    <div
      className={`calendar-grid schedule-grid${busy ? ' calendar-grid--busy' : ''}`}
      style={style}
    >
      <div className="calendar-grid__head">
        <div className="calendar-grid__corner" />
        {columns.map(({ barber, day }) => {
          const head = formatDay(day.date)
          return (
            <div
              key={`${barber.id}|${day.date}`}
              className={`calendar-head${barber.own ? ' calendar-head--own' : ''}${day.date === today ? ' calendar-head--today' : ''}`}
            >
              {mode === 'day' &&
                (barber.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="calendar-head__avatar" src={barber.image} alt="" />
                ) : (
                  <span
                    className="calendar-head__avatar calendar-head__avatar--empty"
                    aria-hidden="true"
                  >
                    {initials(barber.name)}
                  </span>
                ))}
              <span className="calendar-head__text">
                {mode === 'day' ? (
                  <>
                    <span className="calendar-head__name">{barber.name}</span>
                    {barber.canEditPattern ? (
                      <button
                        type="button"
                        className="schedule-link"
                        onClick={() => onPattern(barber)}
                      >
                        {t('roster.pattern')}
                      </button>
                    ) : (
                      barber.position && (
                        <span className="calendar-head__position">{barber.position}</span>
                      )
                    )}
                  </>
                ) : (
                  <>
                    <span className="calendar-head__name">{head.weekday}</span>
                    <span className="calendar-head__position">{head.day}</span>
                  </>
                )}
              </span>
              {day.appointments > 0 && (
                <span
                  className="calendar-head__count"
                  title={t('roster.tooltip.appointments', { count: day.appointments })}
                >
                  {day.appointments}
                </span>
              )}
            </div>
          )
        })}
      </div>
      <div className="calendar-grid__body">
        <div className="calendar-grid__times" aria-label={t('calendar.timeColumn')}>
          {hours.map((row) => (
            <span
              key={row.offset}
              className="calendar-grid__time"
              style={{ top: (row.offset - range.from) * PX_PER_MINUTE }}
            >
              {row.label}
            </span>
          ))}
          {nowTop !== null && (
            <span className="calendar-grid__now-badge" style={{ top: nowTop }}>
              {toLocalTime(now)}
            </span>
          )}
        </div>
        {columns.map((column) => {
          const { barber, day } = column
          const list = intervals.get(column) ?? []
          const elsewhere = day.status === 'work' && !!day.location && day.location !== locationId
          const color = colorOf(barber)
          const blockStyle = {
            '--block-color': color,
            '--block-text': readableTextColor(color),
          } as CSSProperties
          const columnNow =
            mode === 'week' && day.date === today
              ? nowLinePosition(day.date, now, range, PX_PER_MINUTE)
              : null
          const locationName = barber.locations.find((item) => item.id === day.location)?.name
          return (
            <div
              key={`${barber.id}|${day.date}`}
              className={`calendar-grid__column${barber.own ? ' calendar-grid__column--own' : ''}${barber.canEdit ? ' calendar-grid__column--bookable' : ''}`}
              role={barber.canEdit ? 'button' : undefined}
              tabIndex={barber.canEdit ? 0 : undefined}
              aria-label={barber.canEdit ? `${barber.name} · ${day.date}` : undefined}
              onClick={() => barber.canEdit && onEdit(barber, day.date)}
              onKeyDown={(event) => {
                if (barber.canEdit && (event.key === 'Enter' || event.key === ' ')) {
                  event.preventDefault()
                  onEdit(barber, day.date)
                }
              }}
            >
              {offHoursSegments(day.date, elsewhere ? [] : list, range, PX_PER_MINUTE).map(
                (segment) => (
                  <div
                    key={segment.top}
                    className="calendar-grid__off"
                    style={{ top: segment.top, height: segment.height }}
                  />
                ),
              )}
              {day.status !== 'work' && (
                <span className="calendar-grid__off-label">
                  {t(`roster.status.${day.status}`)}
                  {day.override && day.comment ? ` · ${day.comment}` : ''}
                  {barber.canEdit && day.status === 'off' && (
                    <span className="schedule-grid__add">+ {t('calendar.schedule.addHours')}</span>
                  )}
                </span>
              )}
              {list.map((interval, index) => {
                const position = blockPosition(day.date, interval, range, PX_PER_MINUTE)
                if (!position) return null
                return (
                  <div
                    key={interval.start}
                    className={`calendar-block schedule-grid__shift${elsewhere ? ' schedule-grid__shift--elsewhere' : ''}${day.override ? ' schedule-grid__shift--override' : ''}`}
                    style={{
                      ...blockStyle,
                      top: position.top,
                      height: position.height,
                      left: 0,
                      width: '100%',
                    }}
                  >
                    <div className="calendar-block__head">
                      {toLocalTime(new Date(interval.start))}–{toLocalTime(new Date(interval.end))}
                    </div>
                    {index === 0 && (
                      <div className="calendar-block__body">
                        {elsewhere && locationName && (
                          <div className="calendar-block__service">{locationName}</div>
                        )}
                        {day.override && (
                          <div className="calendar-block__note">{t('roster.tooltip.override')}</div>
                        )}
                        {day.comment && <div className="calendar-block__note">{day.comment}</div>}
                      </div>
                    )}
                  </div>
                )
              })}
              {columnNow !== null && (
                <div
                  className="calendar-grid__now calendar-grid__now--column"
                  style={{ top: columnNow }}
                />
              )}
            </div>
          )
        })}
        {nowTop !== null && <div className="calendar-grid__now" style={{ top: nowTop }} />}
      </div>
    </div>
  )
}
