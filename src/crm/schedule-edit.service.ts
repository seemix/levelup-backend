/**
 * Applies roster edits to `schedule-exceptions` (spec A44): one DB transaction per request,
 * serialized per barber, every write through the collection with the user's rights
 * (`overrideAccess: false`), so the collection validation and access rules still apply.
 */
import { APIError, type PayloadRequest } from 'payload'

import { crmT } from '@/i18n'

import { isTransientError, mongo, runBookingTransaction, sessionOf } from './appointments'
import { ruleError, type RuleErrorCode } from './errors'
import {
  isPlanEmpty,
  SCHEDULE_EDIT_CONTEXT,
  planDays,
  planFill,
  type DayValue,
  type ExceptionPlan,
  type StoredException,
} from './schedule-edit'
import {
  relationId,
  validateBreaks,
  validateDayInterval,
  type BarberSchedule,
  type RelationValue,
} from './schedule'

export { SCHEDULE_EDIT_CONTEXT }

/** `booking-locks.date` key that serializes schedule edits of one barber. */
const LOCK_KEY = 'schedule'

export type PlanResult = { removed: number; updated: number; created: number }

const conflict = (req: PayloadRequest): APIError =>
  new APIError(
    crmT(req.t, 'errors.scheduleConflict'),
    409,
    { code: 'SCHEDULE_CONFLICT', retryable: true },
    true,
  )

/** Concurrent edits of the same barber's schedule conflict on this document (and are retried). */
const lockBarberSchedule = async (req: PayloadRequest, barberId: string) => {
  const session = await sessionOf(req)
  try {
    await mongo(req).collections['booking-locks'].updateOne(
      { barber: barberId, date: LOCK_KEY },
      {
        $inc: { version: 1 },
        $set: { updatedAt: new Date() },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true, session },
    )
  } catch (error) {
    if (isTransientError(error) || (error as { code?: unknown }).code === 11000) throw conflict(req)
    throw error
  }
}

type BarberRow = BarberSchedule & { id: string }

const loadBarber = async (req: PayloadRequest, barberId: string): Promise<BarberRow | null> => {
  const { docs } = await req.payload.find({
    collection: 'barbers',
    where: { id: { equals: barberId } },
    overrideAccess: true,
    depth: 0,
    limit: 1,
    pagination: false,
    select: { weeklySchedule: true, locations: true },
    req,
  })
  const doc = docs[0] as unknown as BarberRow | undefined
  return doc ? { ...doc, id: String(doc.id) } : null
}

type ExceptionDoc = StoredException & { barber: RelationValue }

/** Exceptions of the barbers that touch `[from, to]` (system read inside the transaction). */
export const loadExceptions = async (
  req: PayloadRequest,
  barberIds: readonly string[],
  from: string,
  to: string,
): Promise<ExceptionDoc[]> => {
  if (barberIds.length === 0) return []
  const { docs } = await req.payload.find({
    collection: 'schedule-exceptions',
    where: {
      and: [
        { barber: { in: [...barberIds] } },
        { dateFrom: { less_than_equal: to } },
        { dateTo: { greater_than_equal: from } },
      ],
    },
    overrideAccess: true,
    depth: 0,
    pagination: false,
    sort: 'dateFrom',
    select: {
      barber: true,
      kind: true,
      dateFrom: true,
      dateTo: true,
      location: true,
      start: true,
      end: true,
      breaks: true,
      comment: true,
    },
    req,
  })
  return (docs as unknown as ExceptionDoc[]).map((doc) => ({ ...doc, id: String(doc.id) }))
}

/** Writes the plan with the user's rights; the collection hooks and access still run. */
const applyPlan = async (
  req: PayloadRequest,
  barberId: string,
  plan: ExceptionPlan,
): Promise<PlanResult> => {
  const common = { req, overrideAccess: false, depth: 0, select: {} } as const
  for (const id of plan.remove)
    await req.payload.delete({ collection: 'schedule-exceptions', id, ...common })
  for (const { id, dateFrom, dateTo } of plan.update)
    await req.payload.update({
      collection: 'schedule-exceptions',
      id,
      data: { dateFrom, dateTo },
      ...common,
    })
  for (const draft of plan.create) {
    const breaks = (draft.breaks ?? []).map(({ start, end }) => ({ start, end }))
    await req.payload.create({
      collection: 'schedule-exceptions',
      data: {
        barber: barberId,
        kind: draft.kind,
        dateFrom: draft.dateFrom,
        dateTo: draft.dateTo,
        location: relationId(draft.location),
        start: draft.start ?? null,
        end: draft.end ?? null,
        breaks,
        comment: draft.comment ?? null,
      },
      ...common,
    })
  }
  return { removed: plan.remove.length, updated: plan.update.length, created: plan.create.length }
}

const sum = (results: PlanResult[]): PlanResult =>
  results.reduce(
    (acc, item) => ({
      removed: acc.removed + item.removed,
      updated: acc.updated + item.updated,
      created: acc.created + item.created,
    }),
    { removed: 0, updated: 0, created: 0 },
  )

/** Hours, breaks and location of a working day: the same rules as the collection (§4.4). */
const checkValue = (req: PayloadRequest, barber: BarberRow, value: DayValue): DayValue => {
  if (value.kind !== 'custom_hours') return value
  const fail = (code: RuleErrorCode) => ruleError(req.t, code)
  const error = validateDayInterval(value) ?? validateBreaks(value, value.breaks)
  if (error) throw fail(error as RuleErrorCode)
  const locations = (barber.locations ?? []).map(relationId).filter((id): id is string => !!id)
  const location = value.location || (locations.length === 1 ? locations[0] : '')
  if (!locations.includes(location)) throw fail('LOCATION_NOT_ALLOWED')
  return { ...value, location }
}

const inTransaction = <T>(req: PayloadRequest, fn: () => Promise<T>): Promise<T> => {
  const previous = req.context[SCHEDULE_EDIT_CONTEXT]
  req.context[SCHEDULE_EDIT_CONTEXT] = true
  return runBookingTransaction(req, fn, () => conflict(req)).finally(() => {
    req.context[SCHEDULE_EDIT_CONTEXT] = previous
  })
}

/** Sets `dates` of one barber to `value` (roster cell editing). Rights are checked by the caller and the collection. */
export const editScheduleDays = async (
  req: PayloadRequest,
  input: { barber: string; dates: string[]; value: DayValue },
): Promise<PlanResult | null> =>
  inTransaction(req, async () => {
    const barber = await loadBarber(req, input.barber)
    if (!barber) return null
    const value = checkValue(req, barber, input.value)
    await lockBarberSchedule(req, barber.id)
    const dates = [...input.dates].sort()
    const exceptions = await loadExceptions(req, [barber.id], dates[0], dates[dates.length - 1])
    const plan = planDays(barber, exceptions, dates, value)
    if (isPlanEmpty(plan)) return { removed: 0, updated: 0, created: 0 }
    return applyPlan(req, barber.id, plan)
  })

/** «Fill by pattern»: removes overrides of the dates for each barber (vacations and sick leaves are kept by default). */
export const fillSchedule = async (
  req: PayloadRequest,
  input: { barbers: string[]; dates: string[]; keepAbsences: boolean },
): Promise<PlanResult> =>
  inTransaction(req, async () => {
    const dates = [...input.dates].sort()
    const results: PlanResult[] = []
    for (const barberId of input.barbers) {
      await lockBarberSchedule(req, barberId)
      const exceptions = await loadExceptions(req, [barberId], dates[0], dates[dates.length - 1])
      const plan = planFill(exceptions, dates, input.keepAbsences)
      if (!isPlanEmpty(plan)) results.push(await applyPlan(req, barberId, plan))
    }
    return sum(results)
  })
