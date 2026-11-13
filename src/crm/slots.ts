/**
 * Free slot calculation (spec §5.3). Pure functions: no database access and no clock —
 * `now` comes in with the input. Dates are local `YYYY-MM-DD`, instants are UTC `Date`.
 */
import { getWorkingIntervals, type BarberSchedule, type ScheduleException } from './schedule'
import {
  addLocalDays,
  addMinutes,
  isLocalDate,
  localDayRange,
  localGridInstants,
  toLocalDate,
  toLocalTime,
  todayLocal,
} from './time'

export type SlotMode = 'online' | 'staff'

/** An occupied interval of a barber: an appointment or a time block in an active status (spec §5.3 p.2). */
export type BusyInterval = {
  start: Date
  end: Date
  kind: 'appointment' | 'block'
}

export type SlotSettings = {
  slotStepMinutes: number
  minLeadMinutes: number
  horizonDays: number
  bufferMinutes: number
  onlineBookingEnabled: boolean
}

/** Defaults of `booking-settings` (spec §4.3, A7), used when the global has never been saved. */
export const DEFAULT_SLOT_SETTINGS: SlotSettings = {
  slotStepMinutes: 15,
  minLeadMinutes: 120,
  horizonDays: 30,
  bufferMinutes: 0,
  onlineBookingEnabled: true,
}

export type SlotBarber = {
  id: string
  /** `barbers.order`; empty sorts last. */
  order: number | null
  active: boolean
  onlineBooking: boolean
  /** The barber provides the requested service (`barbers.services`). */
  providesService: boolean
  /** Service + extras duration for this barber, with `barber-prices` applied (see `resolveDuration`). */
  durationMinutes: number
  schedule: BarberSchedule
  exceptions: readonly ScheduleException[]
  /** Busy intervals of this barber around the date, in any location. */
  busy: readonly BusyInterval[]
}

export type SlotInput = {
  mode: SlotMode
  /** Local date of the requested day. */
  date: string
  locationId: string
  now: Date
  settings: SlotSettings
  /** One barber, or every candidate of the location for "any barber". */
  barbers: readonly SlotBarber[]
  /** Online only: a blocked client cannot book (spec §4.10). */
  clientBlocked?: boolean
}

export type SlotWarning = 'OUTSIDE_SCHEDULE'

export type SlotOption = {
  barberId: string
  end: Date
  durationMinutes: number
  warnings: SlotWarning[]
}

export type Slot = {
  start: Date
  /** Local `HH:mm` of `start` (appears twice on the autumn DST night). */
  time: string
  /** Barbers free at `start`, best auto-pick first (spec §5.3 p.6). */
  barbers: SlotOption[]
}

export type SlotCheck =
  ({ ok: true; start: Date } & SlotOption) | { ok: false; code: 'SLOT_TAKEN' | 'SLOT_UNAVAILABLE' }

// ---------------------------------------------------------------------------
// Duration (spec §5.3 p.1)
// ---------------------------------------------------------------------------

export type DurationItem = { id: string; durationMinutes: number }
export type DurationOverride = {
  itemType: 'services' | 'extras'
  itemId: string
  /** Empty means "use the base value" (spec §4.9). */
  durationMinutes?: number | null
}

/** Service duration + Σ extras, each taken from the barber override when it is set. */
export const resolveDuration = (
  service: DurationItem,
  extras: readonly DurationItem[],
  overrides: readonly DurationOverride[],
): number => {
  const pick = (itemType: DurationOverride['itemType'], item: DurationItem): number => {
    const override = overrides.find((o) => o.itemType === itemType && o.itemId === item.id)
    return typeof override?.durationMinutes === 'number'
      ? override.durationMinutes
      : item.durationMinutes
  }
  return extras.reduce((sum, extra) => sum + pick('extras', extra), pick('services', service))
}

// ---------------------------------------------------------------------------
// Slots
// ---------------------------------------------------------------------------

type Range = { start: Date; end: Date }

/** Half-open intervals: touching ends do not overlap. */
const overlaps = (a: Range, b: Range): boolean => a.start < b.end && b.start < a.end
const contains = (outer: Range, inner: Range): boolean =>
  outer.start <= inner.start && inner.end <= outer.end

/** Per-barber facts that do not depend on the start time. */
type BarberDay = {
  barber: SlotBarber
  /** Working intervals in the requested location (empty when off or working elsewhere). */
  working: Range[]
  /** Busy intervals extended by the buffer on both sides. */
  busy: Range[]
  appointmentsCount: number
  /** Online filters of spec §5.3 p.5 that depend only on the barber and the client. */
  onlineEligible: boolean
}

const prepareDay = (
  input: SlotInput,
): { days: BarberDay[]; dayRange: Range; dateBookable: boolean } => {
  const { date, settings, now, mode } = input
  if (!isLocalDate(date)) throw new RangeError(`Invalid date: ${date}`)
  const today = todayLocal(now)
  const dateBookable =
    settings.onlineBookingEnabled &&
    !input.clientBlocked &&
    date >= today &&
    date <= addLocalDays(today, settings.horizonDays)

  const days = input.barbers.map((barber): BarberDay => {
    const day = getWorkingIntervals(barber.schedule, date, barber.exceptions)
    const working =
      day.working && day.locationId === input.locationId
        ? day.intervals.map(({ start, end }) => ({ start, end }))
        : []
    const busy = barber.busy.map(({ start, end }) => ({
      start: addMinutes(start, -settings.bufferMinutes),
      end: addMinutes(end, settings.bufferMinutes),
    }))
    const appointmentsCount = barber.busy.filter(
      (item) => item.kind === 'appointment' && toLocalDate(item.start) === date,
    ).length
    const onlineEligible =
      mode === 'online' && barber.active && barber.onlineBooking && barber.providesService
    return { barber, working, busy, appointmentsCount, onlineEligible }
  })
  return { days, dayRange: localDayRange(date), dateBookable }
}

type Evaluation = SlotOption | 'SLOT_TAKEN' | 'SLOT_UNAVAILABLE'

/** Rules for one barber and one start; the grid is checked by the caller (spec §5.3 p.4, p.5, p.7). */
const evaluate = (
  input: SlotInput,
  day: BarberDay,
  dayRange: Range,
  dateBookable: boolean,
  start: Date,
): Evaluation => {
  const { barber } = day
  if (!Number.isInteger(barber.durationMinutes) || barber.durationMinutes <= 0)
    return 'SLOT_UNAVAILABLE'
  const slot = { start, end: addMinutes(start, barber.durationMinutes) }
  if (!contains(dayRange, slot)) return 'SLOT_UNAVAILABLE'
  const inSchedule = day.working.some((interval) => contains(interval, slot))

  if (input.mode === 'online') {
    if (!dateBookable || !day.onlineEligible || !inSchedule) return 'SLOT_UNAVAILABLE'
    if (start < addMinutes(input.now, input.settings.minLeadMinutes)) return 'SLOT_UNAVAILABLE'
  }
  // Overlap with another appointment or block is never allowed (spec §5.3 p.7).
  if (day.busy.some((busy) => overlaps(busy, slot))) return 'SLOT_TAKEN'

  return {
    barberId: barber.id,
    end: slot.end,
    durationMinutes: barber.durationMinutes,
    warnings: inSchedule ? [] : ['OUTSIDE_SCHEDULE'],
  }
}

/** Auto-pick order (spec §5.3 p.6): in schedule first, fewer appointments that day, lower `order`, then id. */
const compareCandidates = (
  a: { option: SlotOption; day: BarberDay },
  b: { option: SlotOption; day: BarberDay },
): number =>
  a.option.warnings.length - b.option.warnings.length ||
  a.day.appointmentsCount - b.day.appointmentsCount ||
  (a.day.barber.order ?? Number.POSITIVE_INFINITY) -
    (b.day.barber.order ?? Number.POSITIVE_INFINITY) ||
  (a.day.barber.id < b.day.barber.id ? -1 : a.day.barber.id > b.day.barber.id ? 1 : 0)

const optionsAt = (
  input: SlotInput,
  prepared: ReturnType<typeof prepareDay>,
  start: Date,
): SlotOption[] =>
  prepared.days
    .map((day) => ({
      day,
      option: evaluate(input, day, prepared.dayRange, prepared.dateBookable, start),
    }))
    .filter((c): c is { day: BarberDay; option: SlotOption } => typeof c.option !== 'string')
    .sort(compareCandidates)
    .map((c) => c.option)

/**
 * Free slots of one barber, or the union for "any barber" (spec §5.3).
 * Online: grid starts inside working time in the location, after `now + minLead`, within the horizon.
 * Staff: every grid start of the local day that does not overlap a busy interval;
 * starts outside working time carry `OUTSIDE_SCHEDULE`.
 */
export const computeSlots = (input: SlotInput): Slot[] => {
  const prepared = prepareDay(input)
  const slots: Slot[] = []
  for (const start of localGridInstants(input.date, input.settings.slotStepMinutes)) {
    const barbers = optionsAt(input, prepared, start)
    if (barbers.length > 0) slots.push({ start, time: toLocalTime(start), barbers })
  }
  return slots
}

const onGrid = (input: SlotInput, start: Date): boolean =>
  localGridInstants(input.date, input.settings.slotStepMinutes).some(
    (instant) => instant.getTime() === start.getTime(),
  )

/**
 * Validates one start for one barber (creation, moves). Online: must be one of `computeSlots`.
 * Staff: any minute of the day that does not overlap a busy interval and ends by midnight.
 */
export const checkSlot = (input: SlotInput, barberId: string, start: Date): SlotCheck => {
  if (toLocalDate(start) !== input.date) {
    throw new RangeError(`Start ${start.toISOString()} is not on ${input.date}`)
  }
  const prepared = prepareDay(input)
  const day = prepared.days.find((item) => item.barber.id === barberId)
  if (!day) return { ok: false, code: 'SLOT_UNAVAILABLE' }
  if (input.mode === 'online' && !onGrid(input, start))
    return { ok: false, code: 'SLOT_UNAVAILABLE' }
  const result = evaluate(input, day, prepared.dayRange, prepared.dateBookable, start)
  return typeof result === 'string' ? { ok: false, code: result } : { ok: true, start, ...result }
}

/**
 * "Any barber" choice at creation time (spec §5.3 p.6): a barber free at `start`
 * with the fewest appointments that day; ties → lower `order`, then lower id. `null` if nobody is free.
 */
export const pickBarber = (input: SlotInput, start: Date): string | null => {
  if (toLocalDate(start) !== input.date) return null
  if (input.mode === 'online' && !onGrid(input, start)) return null
  return optionsAt(input, prepareDay(input), start)[0]?.barberId ?? null
}
