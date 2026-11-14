/**
 * Pure helpers of the calendar drag-n-drop (spec §5.10, stages 16 and 20). No DOM, no database.
 * A drag is a vertical delta in pixels snapped to the grid step plus a target column
 * (day view — a barber, week view — a day of the barber).
 */
import { addMinutes, localDayRange, minutesBetween } from './time'

/** Vertical drag distance (px) → whole grid steps in minutes (rounded to the nearest step). */
export const snapDeltaMinutes = (deltaPx: number, pxPerMinute: number, step: number): number => {
  const minutes = Math.round(deltaPx / pxPerMinute / step) * step
  return minutes === 0 ? 0 : minutes // no `-0`
}

/** Vertical drag distance (px) rounded to the grid, for the drag preview. */
export const snapDeltaPx = (deltaPx: number, pxPerMinute: number, step: number): number =>
  snapDeltaMinutes(deltaPx, pxPerMinute, step) * pxPerMinute

/**
 * New start of a moved appointment. Within one day — `start + delta`; to another local day
 * (`dates`) — the same position in the target column: elapsed minutes from the local midnight
 * (right on DST days), shifted by `delta`.
 */
export const movedStart = (
  start: string,
  deltaMinutes: number,
  dates?: { from: string; to: string },
): Date => {
  const instant = new Date(start)
  if (!dates || dates.from === dates.to) return addMinutes(instant, deltaMinutes)
  const offset = minutesBetween(localDayRange(dates.from).start, instant)
  return addMinutes(localDayRange(dates.to).start, offset + deltaMinutes)
}

type MovableItem = { id?: string; start: string; end: string }
type MovableColumn<T extends MovableItem> = {
  barber: { id: string }
  /** Local date of the column (week view); absent in tests/day view where it is not needed. */
  date?: string
  appointments: T[]
}

/**
 * The columns after moving appointment `id` by `deltaMinutes` into the column of `toBarberId`
 * (and `toDate` in week view); duration is kept. `null` when nothing changes or the appointment
 * (or the target column) is not found.
 */
export const moveInColumns = <T extends MovableItem, C extends MovableColumn<T>>(
  columns: C[],
  id: string,
  toBarberId: string,
  deltaMinutes: number,
  toDate?: string,
): C[] | null => {
  const from = columns.find((column) => column.appointments.some((item) => item.id === id))
  const to = columns.find(
    (column) => column.barber.id === toBarberId && (toDate === undefined || column.date === toDate),
  )
  const item = from?.appointments.find((candidate) => candidate.id === id)
  if (!from || !to || !item) return null
  if (from === to && deltaMinutes === 0) return null
  const start = movedStart(
    item.start,
    deltaMinutes,
    from.date && to.date ? { from: from.date, to: to.date } : undefined,
  )
  const duration = minutesBetween(new Date(item.start), new Date(item.end))
  const moved = {
    ...item,
    start: start.toISOString(),
    end: addMinutes(start, duration).toISOString(),
  }
  return columns.map((column) => {
    const rest = column.appointments.filter((candidate) => candidate.id !== id)
    return column === to
      ? { ...column, appointments: [...rest, moved] }
      : column === from
        ? { ...column, appointments: rest }
        : column
  })
}

/** Body of `PATCH /crm/appointments/:id` for a move; the barber is sent only when it changes. */
export const moveBody = (
  item: { start: string },
  fromBarberId: string,
  toBarberId: string,
  deltaMinutes: number,
  confirm = false,
  dates?: { from: string; to: string },
) => ({
  start: movedStart(item.start, deltaMinutes, dates).toISOString(),
  ...(fromBarberId === toBarberId ? {} : { barber: toBarberId }),
  ...(confirm ? { confirm: true } : {}),
})
