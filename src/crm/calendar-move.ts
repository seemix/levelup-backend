/**
 * Pure helpers of the calendar drag-n-drop (spec §5.10, stage 16). No DOM, no database.
 * A drag is a vertical delta in pixels snapped to the grid step plus a target column (barber).
 */
import { addMinutes } from './time'

/** Vertical drag distance (px) → whole grid steps in minutes (rounded to the nearest step). */
export const snapDeltaMinutes = (deltaPx: number, pxPerMinute: number, step: number): number => {
  const minutes = Math.round(deltaPx / pxPerMinute / step) * step
  return minutes === 0 ? 0 : minutes // no `-0`
}

/** Vertical drag distance (px) rounded to the grid, for the drag preview. */
export const snapDeltaPx = (deltaPx: number, pxPerMinute: number, step: number): number =>
  snapDeltaMinutes(deltaPx, pxPerMinute, step) * pxPerMinute

type MovableItem = { id?: string; start: string; end: string }
type MovableColumn<T extends MovableItem> = { barber: { id: string }; appointments: T[] }

/**
 * The columns after moving appointment `id` by `deltaMinutes` into the column of `toBarberId`
 * (duration is kept). `null` when nothing changes or the appointment is not found.
 */
export const moveInColumns = <T extends MovableItem, C extends MovableColumn<T>>(
  columns: C[],
  id: string,
  toBarberId: string,
  deltaMinutes: number,
): C[] | null => {
  const from = columns.find((column) => column.appointments.some((item) => item.id === id))
  const to = columns.find((column) => column.barber.id === toBarberId)
  const item = from?.appointments.find((candidate) => candidate.id === id)
  if (!from || !to || !item) return null
  if (from === to && deltaMinutes === 0) return null
  const moved = {
    ...item,
    start: addMinutes(new Date(item.start), deltaMinutes).toISOString(),
    end: addMinutes(new Date(item.end), deltaMinutes).toISOString(),
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
) => ({
  start: addMinutes(new Date(item.start), deltaMinutes).toISOString(),
  ...(fromBarberId === toBarberId ? {} : { barber: toBarberId }),
  ...(confirm ? { confirm: true } : {}),
})
