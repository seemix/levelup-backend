/**
 * `GET /api/booking/days` and `GET /api/booking/slots` (spec §6.1, §5.3 online mode).
 * Query: `location`, `barber` (id or `any`/empty), `service`, `extras[]`, plus `from`/`to` or `date`.
 */
import type { PayloadRequest } from 'payload'

import { computeSlots } from '@/crm/slots'
import { loadSlotRange } from '@/crm/slots.loader'
import { addLocalDays, eachLocalDate, isLocalDate, todayLocal } from '@/crm/time'

import { parseSelection, readSettings, validateSelection, type Selection } from './context'
import { bookingEndpoint, InputErrors, ok, queryList } from './http'

/** At most this many days per `days` request. */
export const MAX_DAYS_RANGE = 62

const selectionFromQuery = (errors: InputErrors, params: URLSearchParams): Selection =>
  parseSelection(errors, {
    location: params.get('location'),
    barber: params.get('barber'),
    service: params.get('service'),
    extras: queryList(params, 'extras'),
  })

const loadRange = (
  req: PayloadRequest,
  selection: Selection,
  from: string,
  to: string,
  now: Date,
) =>
  loadSlotRange(
    req.payload,
    {
      mode: 'online',
      locationId: selection.locationId,
      barberId: selection.barberId,
      serviceId: selection.serviceId,
      extraIds: selection.extraIds,
      from,
      to,
      now,
    },
    req,
  )

/** Local dates in `[from, to]` (clamped to today … today + horizon) that have at least one free slot. */
export const daysEndpoint = bookingEndpoint('get', '/booking/days', async (req) => {
  const params = req.searchParams
  const errors = new InputErrors()
  const selection = selectionFromQuery(errors, params)
  const fromParam = params.get('from')
  const toParam = params.get('to')
  if (fromParam && !isLocalDate(fromParam)) errors.add('from')
  if (toParam && !isLocalDate(toParam)) errors.add('to')
  errors.throwIfAny()

  const now = new Date()
  const settings = await readSettings(req)
  const today = todayLocal(now)
  const last = addLocalDays(today, settings.horizonDays)
  const from = fromParam && fromParam > today ? fromParam : today
  const wanted = toParam && toParam < last ? toParam : last
  const to =
    wanted > addLocalDays(from, MAX_DAYS_RANGE - 1)
      ? addLocalDays(from, MAX_DAYS_RANGE - 1)
      : wanted

  await validateSelection(req, selection)
  if (!settings.onlineBookingEnabled || from > to) return ok({ from, to, days: [] })

  const range = await loadRange(req, selection, from, to, now)
  const days = eachLocalDate(from, to).filter(
    (date) => computeSlots(range.inputFor(date)).length > 0,
  )
  return ok({ from, to, days })
})

/** Free starts of one local date; `barbers` lists who is free, the auto-pick first (§5.3 p.6). */
export const slotsEndpoint = bookingEndpoint('get', '/booking/slots', async (req) => {
  const params = req.searchParams
  const errors = new InputErrors()
  const selection = selectionFromQuery(errors, params)
  const date = params.get('date') ?? ''
  if (!isLocalDate(date)) errors.add('date')
  errors.throwIfAny()

  await validateSelection(req, selection)
  const range = await loadRange(req, selection, date, date, new Date())
  const slots = computeSlots(range.inputFor(date)).map((slot) => ({
    start: slot.start.toISOString(),
    time: slot.time,
    barbers: slot.barbers.map((option) => ({
      id: option.barberId,
      end: option.end.toISOString(),
      durationMinutes: option.durationMinutes,
    })),
  }))
  return ok({ date, slots })
})
