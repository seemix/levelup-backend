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
} from '@/crm/calendar-layout'
import { slotStartAt } from '@/crm/appointment-form'
import { snapDeltaMinutes, snapDeltaPx } from '@/crm/calendar-move'
import { barberColorAt } from '@/crm/colors'
import { toLocalTime } from '@/crm/time'

import { AppointmentBlock } from './AppointmentBlock'
import { ColumnHeader } from './ColumnHeader'
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

/** A column is a drop target; a barber may only drop into their own column (server re-checks). */
const DropColumn = ({
  id,
  disabled,
  className,
  onClick,
  children,
}: {
  id: string
  disabled: boolean
  className: string
  onClick: (event: React.MouseEvent<HTMLDivElement>) => void
  children: ReactNode
}) => {
  const { setNodeRef, isOver } = useDroppable({ id, disabled })
  return (
    <div
      ref={setNodeRef}
      className={`${className}${isOver ? ' calendar-grid__column--over' : ''}`}
      onClick={onClick}
    >
      {children}
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
  /** Drag finished: appointment `id` goes to `barberId`, shifted by `deltaMinutes`. */
  onMove: (id: string, barberId: string, deltaMinutes: number) => void
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

  // The preview snaps to the 15-minute grid (horizontal movement is free to reach other columns).
  const snap: Modifier = ({ transform }) => ({
    ...transform,
    y: snapDeltaPx(transform.y, PX_PER_MINUTE, step),
  })
  const onDragStart = (event: DragStartEvent) => {
    const id = String(event.active.id)
    for (const [index, column] of columns.entries()) {
      const appointment = column.appointments.find((item) => 'id' in item && item.id === id)
      if (appointment)
        setDragging({ id, appointment, color: column.barber.color ?? barberColorAt(index) })
    }
  }
  const onDragEnd = (event: DragEndEvent) => {
    setDragging(null)
    if (!event.over) return
    onMove(
      String(event.active.id),
      String(event.over.id),
      snapDeltaMinutes(event.delta.y, PX_PER_MINUTE, step),
    )
  }

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
              <DropColumn
                key={`${column.barber.id}-${column.date}`}
                id={column.barber.id}
                disabled={!canDropInto(column)}
                className={`calendar-grid__column${column.barber.own ? ' calendar-grid__column--own' : ''}${canCreate(column) ? ' calendar-grid__column--bookable' : ''}`}
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
                    slotStartAt(date, range.from + y / PX_PER_MINUTE, step),
                  )
                }}
              >
                {offHoursSegments(date, column.intervals, range, PX_PER_MINUTE).map((segment) => (
                  <div
                    key={segment.top}
                    className="calendar-grid__off"
                    style={{ top: segment.top, height: segment.height }}
                  />
                ))}
                {column.off && (
                  <span className="calendar-grid__off-label">
                    {t(`calendar.off.${column.off}`)}
                  </span>
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
