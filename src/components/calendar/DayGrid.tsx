'use client'
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  type Modifier,
} from '@dnd-kit/core'
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'

import {
  assignLanes,
  blockPosition,
  gridRows,
  minutesFromDayStart,
  nowLinePosition,
  offHoursSegments,
  visibleRange,
  type IsoInterval,
} from '@/crm/calendar-layout'
import { slotStartAt } from '@/crm/appointment-form'
import { snapDeltaMinutes, snapDeltaPx } from '@/crm/calendar-move'
import { barberColorAt } from '@/crm/colors'
import { toLocalDate, toLocalTime } from '@/crm/time'

import { AppointmentBlock } from './AppointmentBlock'
import { ColumnHeader } from './ColumnHeader'
import type { ExceptionKind } from './ScheduleExceptionModal'
import type { CalendarAppointment, CalendarData } from './types'
import { useCrmT } from './useCrmT'

/** Pixels per minute: an hour is 120 px (as on docs/dashboard.jpg), a 15-minute row — 30 px. */
const PX_PER_MINUTE = 2
const MIN_BLOCK_HEIGHT = 22
const NOW_REFRESH_MS = 30_000
/** Touch: hold ~0.3 s to pick a block up, so a normal swipe still scrolls the grid. */
const TOUCH_HOLD_MS = 300
const TOUCH_TOLERANCE_PX = 8
/** Mouse: a click opens the block, a drag of more than a few pixels moves it. */
const MOUSE_DISTANCE_PX = 6

type Column = CalendarData['columns'][number]

/** Droppable id of a column: day view — one per barber, week view — one per day of the barber. */
const columnKey = (column: Column) => `${column.barber.id}|${column.date}`

/** Visible range of the grid: the union of the ranges of the columns (each in its own date). */
const gridRange = (columns: Column[], fallbackDate: string) => {
  const ranges = columns
    .map((column) => {
      const intervals: IsoInterval[] = [
        ...column.intervals,
        ...column.appointments.map((item) => ({ start: item.start, end: item.end })),
      ]
      return intervals.length === 0 ? null : visibleRange(column.date, intervals)
    })
    .filter((range): range is { from: number; to: number } => range !== null)
  if (ranges.length === 0) return visibleRange(fallbackDate, [])
  return {
    from: Math.min(...ranges.map((range) => range.from)),
    to: Math.max(...ranges.map((range) => range.to)),
  }
}

/** A column is a drop target; a barber may only drop into their own column (server re-checks). */
const DropColumn = ({
  id,
  disabled,
  className,
  onClick,
  hintAt,
  children,
}: {
  id: string
  disabled: boolean
  className: string
  onClick: (event: React.MouseEvent<HTMLDivElement>) => void
  /** Time hint for a vertical offset (px) inside the column: snapped line position and label. */
  hintAt: (y: number) => { top: number; label: string }
  children: ReactNode
}) => {
  const { setNodeRef, isOver } = useDroppable({ id, disabled })
  const [hint, setHint] = useState<{ top: number; label: string } | null>(null)
  const onMove = (event: React.MouseEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('.calendar-block')) {
      setHint(null)
      return
    }
    setHint(hintAt(event.clientY - event.currentTarget.getBoundingClientRect().top))
  }
  return (
    <div
      ref={setNodeRef}
      className={`${className}${isOver ? ' calendar-grid__column--over' : ''}`}
      onClick={onClick}
      onMouseMove={onMove}
      onMouseLeave={() => setHint(null)}
    >
      {children}
      {hint && (
        <div className="calendar-grid__hint" style={{ top: hint.top }}>
          <span>{hint.label}</span>
        </div>
      )}
    </div>
  )
}

type Props = {
  data: CalendarData
  busy: boolean
  /** May the user book into this column (admin/manager — any, barber — their own)? */
  canCreate: (column: CalendarData['columns'][number]) => boolean
  onOpen: (id: string) => void
  onCreate: (barberId: string, start: Date) => void
  /** May the user drag this appointment out of this column? */
  canMove: (appointment: CalendarAppointment, column: Column) => boolean
  /** May the user drop into this column? */
  canDropInto: (column: Column) => boolean
  /** Drag finished: appointment `id` goes to `barberId` and the local `date`, shifted by `deltaMinutes`. */
  onMove: (id: string, barberId: string, date: string, deltaMinutes: number) => void
  /** Admin/manager: may add a schedule exception to this column (menu in the header)? */
  canSchedule: boolean
  onSchedule: (column: Column, kind: ExceptionKind) => void
}

export const DayGrid = ({
  data,
  busy,
  canCreate,
  onOpen,
  onCreate,
  canMove,
  canDropInto,
  onMove,
  canSchedule,
  onSchedule,
}: Props) => {
  const t = useCrmT()
  const [dragging, setDragging] = useState<{
    id: string
    color: string
    appointment: CalendarAppointment
  } | null>(null)
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: MOUSE_DISTANCE_PX } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: TOUCH_HOLD_MS, tolerance: TOUCH_TOLERANCE_PX },
    }),
  )
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), NOW_REFRESH_MS)
    return () => clearInterval(timer)
  }, [])

  const { columns } = data
  const week = data.view === 'week'
  // Rows and labels follow the first column's date (they differ only on DST days of a week).
  const date = columns[0]?.date ?? data.date
  const today = toLocalDate(now)
  // Colour follows the barber, not the column (week view has seven columns of one barber).
  const barberIds = useMemo(() => [...new Set(columns.map((item) => item.barber.id))], [columns])
  const colorOf = (column: Column) =>
    column.barber.color ?? barberColorAt(barberIds.indexOf(column.barber.id))
  const step = data.slotStepMinutes
  const range = useMemo(() => gridRange(columns, date), [date, columns])
  const hours = useMemo(
    () => gridRows(date, range.from, range.to, 60).filter((row) => row.hour),
    [date, range],
  )
  const height = (range.to - range.from) * PX_PER_MINUTE
  const nowTop = week ? null : nowLinePosition(date, now, range, PX_PER_MINUTE)

  // The preview snaps to the 15-minute grid (horizontal movement is free to reach other columns).
  const snap: Modifier = ({ transform }) => ({
    ...transform,
    y: snapDeltaPx(transform.y, PX_PER_MINUTE, step),
  })
  const onDragStart = (event: DragStartEvent) => {
    const id = String(event.active.id)
    for (const column of columns) {
      const appointment = column.appointments.find((item) => 'id' in item && item.id === id)
      if (appointment) setDragging({ id, appointment, color: colorOf(column) })
    }
  }
  const onDragEnd = (event: DragEndEvent) => {
    setDragging(null)
    if (!event.over) return
    const [barberId, targetDate] = String(event.over.id).split('|')
    onMove(
      String(event.active.id),
      barberId,
      targetDate,
      snapDeltaMinutes(event.delta.y, PX_PER_MINUTE, step),
    )
  }

  const columnNow = (columnDate: string) =>
    columnDate === today ? nowLinePosition(columnDate, now, range, PX_PER_MINUTE) : null

  const style = {
    '--calendar-columns': columns.length,
    '--calendar-height': `${height}px`,
    '--calendar-row': `${step * PX_PER_MINUTE}px`,
    '--calendar-hour': `${60 * PX_PER_MINUTE}px`,
  } as CSSProperties

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      modifiers={[snap]}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setDragging(null)}
    >
      <div className={`calendar-grid${busy ? ' calendar-grid--busy' : ''}`} style={style}>
        <div className="calendar-grid__head">
          <div className="calendar-grid__corner" />
          {columns.map((column) => (
            <ColumnHeader
              key={columnKey(column)}
              column={column}
              mode={week ? 'week' : 'day'}
              today={column.date === today}
              canSchedule={canSchedule}
              onSchedule={(kind) => onSchedule(column, kind)}
            />
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
          {columns.map((column) => {
            const color = colorOf(column)
            const items = column.appointments
              .map((appointment) => ({
                appointment,
                position: blockPosition(
                  column.date,
                  appointment,
                  range,
                  PX_PER_MINUTE,
                  MIN_BLOCK_HEIGHT,
                ),
              }))
              .filter(
                (item): item is typeof item & { position: NonNullable<typeof item.position> } =>
                  item.position !== null,
              )
            const lanes = assignLanes(
              items.map(({ appointment }) => ({
                start: minutesFromDayStart(column.date, appointment.start),
                end: minutesFromDayStart(column.date, appointment.end),
              })),
            )
            return (
              <DropColumn
                key={columnKey(column)}
                id={columnKey(column)}
                disabled={!canDropInto(column)}
                className={`calendar-grid__column${column.barber.own ? ' calendar-grid__column--own' : ''}${canCreate(column) ? ' calendar-grid__column--bookable' : ''}`}
                hintAt={(y) => {
                  const start = slotStartAt(column.date, range.from + y / PX_PER_MINUTE, step)
                  return {
                    top:
                      (minutesFromDayStart(column.date, start.toISOString()) - range.from) *
                      PX_PER_MINUTE,
                    label: toLocalTime(start),
                  }
                }}
                onClick={(event) => {
                  // A click on a block opens it; a click on an empty slot starts a new appointment.
                  if (
                    !canCreate(column) ||
                    (event.target as HTMLElement).closest('.calendar-block')
                  )
                    return
                  const y = event.clientY - event.currentTarget.getBoundingClientRect().top
                  onCreate(
                    column.barber.id,
                    slotStartAt(column.date, range.from + y / PX_PER_MINUTE, step),
                  )
                }}
              >
                {offHoursSegments(column.date, column.intervals, range, PX_PER_MINUTE).map(
                  (segment) => (
                    <div
                      key={segment.top}
                      className="calendar-grid__off"
                      style={{ top: segment.top, height: segment.height }}
                    />
                  ),
                )}
                {column.off && (
                  <span className="calendar-grid__off-label">
                    {t(`calendar.off.${column.off}`)}
                  </span>
                )}
                {week && columnNow(column.date) !== null && (
                  <div
                    className="calendar-grid__now calendar-grid__now--column"
                    style={{ top: columnNow(column.date) ?? 0 }}
                  />
                )}
                {items.map(({ appointment, position }, itemIndex) => (
                  <AppointmentBlock
                    key={'id' in appointment ? appointment.id : `${appointment.start}-${itemIndex}`}
                    appointment={appointment}
                    color={color}
                    position={position}
                    lane={lanes[itemIndex]}
                    onOpen={onOpen}
                    draggable={canMove(appointment, column)}
                  />
                ))}
              </DropColumn>
            )
          })}
          {nowTop !== null && <div className="calendar-grid__now" style={{ top: nowTop }} />}
        </div>
      </div>
      <DragOverlay dropAnimation={null}>
        {dragging && (
          <AppointmentBlock
            overlay
            appointment={dragging.appointment}
            color={dragging.color}
            position={{ top: 0, height: 0 }}
            lane={{ lane: 0, lanes: 1 }}
            onOpen={onOpen}
          />
        )}
      </DragOverlay>
    </DndContext>
  )
}
