'use client'
import { useEffect, useMemo, useState, type CSSProperties } from 'react'

import {
  assignLanes,
  blockPosition,
  gridRows,
  minutesFromDayStart,
  nowLinePosition,
  offHoursSegments,
  visibleRange,
} from '@/crm/calendar-layout'
import { barberColorAt } from '@/crm/colors'
import { toLocalTime } from '@/crm/time'

import { AppointmentBlock } from './AppointmentBlock'
import { ColumnHeader } from './ColumnHeader'
import type { CalendarData } from './types'
import { useCrmT } from './useCrmT'

/** Pixels per minute: an hour is 120 px (as on docs/dashboard.jpg), a 15-minute row — 30 px. */
const PX_PER_MINUTE = 2
const MIN_BLOCK_HEIGHT = 22
const NOW_REFRESH_MS = 30_000

export const DayGrid = ({ data, busy }: { data: CalendarData; busy: boolean }) => {
  const t = useCrmT()
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), NOW_REFRESH_MS)
    return () => clearInterval(timer)
  }, [])

  const { date, columns } = data
  const step = data.slotStepMinutes
  const range = useMemo(
    () =>
      visibleRange(
        date,
        columns.flatMap((column) => [
          ...column.intervals,
          ...column.appointments.map((item) => ({ start: item.start, end: item.end })),
        ]),
      ),
    [date, columns],
  )
  const hours = useMemo(
    () => gridRows(date, range.from, range.to, 60).filter((row) => row.hour),
    [date, range],
  )
  const height = (range.to - range.from) * PX_PER_MINUTE
  const nowTop = nowLinePosition(date, now, range, PX_PER_MINUTE)

  const style = {
    '--calendar-columns': columns.length,
    '--calendar-height': `${height}px`,
    '--calendar-row': `${step * PX_PER_MINUTE}px`,
    '--calendar-hour': `${60 * PX_PER_MINUTE}px`,
  } as CSSProperties

  return (
    <div className={`calendar-grid${busy ? ' calendar-grid--busy' : ''}`} style={style}>
      <div className="calendar-grid__head">
        <div className="calendar-grid__corner" />
        {columns.map((column) => (
          <ColumnHeader key={`${column.barber.id}-${column.date}`} column={column} />
        ))}
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
        {columns.map((column, index) => {
          const color = column.barber.color ?? barberColorAt(index)
          const items = column.appointments
            .map((appointment) => ({
              appointment,
              position: blockPosition(date, appointment, range, PX_PER_MINUTE, MIN_BLOCK_HEIGHT),
            }))
            .filter(
              (item): item is typeof item & { position: NonNullable<typeof item.position> } =>
                item.position !== null,
            )
          const lanes = assignLanes(
            items.map(({ appointment }) => ({
              start: minutesFromDayStart(date, appointment.start),
              end: minutesFromDayStart(date, appointment.end),
            })),
          )
          return (
            <div
              key={`${column.barber.id}-${column.date}`}
              className={`calendar-grid__column${column.barber.own ? ' calendar-grid__column--own' : ''}`}
            >
              {offHoursSegments(date, column.intervals, range, PX_PER_MINUTE).map((segment) => (
                <div
                  key={segment.top}
                  className="calendar-grid__off"
                  style={{ top: segment.top, height: segment.height }}
                />
              ))}
              {column.off && (
                <span className="calendar-grid__off-label">{t(`calendar.off.${column.off}`)}</span>
              )}
              {items.map(({ appointment, position }, itemIndex) => (
                <AppointmentBlock
                  key={'id' in appointment ? appointment.id : `${appointment.start}-${itemIndex}`}
                  appointment={appointment}
                  color={color}
                  position={position}
                  lane={lanes[itemIndex]}
                />
              ))}
            </div>
          )
        })}
        {nowTop !== null && <div className="calendar-grid__now" style={{ top: nowTop }} />}
      </div>
    </div>
  )
}
