/**
 * Pure helpers of the appointment modal (spec §5.1, §5.10, decisions 20, 21, 30): request bodies
 * built from the form state, the diff for PATCH, which actions a status offers, grid click → time.
 * No database and no React: unit-tested in `tests/int/appointment-form.int.spec.ts`.
 */
import {
  addMinutes,
  isLocalDate,
  isLocalTime,
  localDayRange,
  localToInstant,
  todayLocal,
} from './time'
import { parseLeiInput } from './money'

export type FormKind = 'appointment' | 'block'

export type ManualDiscountType = 'amount' | 'percent'

/** Everything the user edits; text fields stay strings until the body is built. */
export type FormState = {
  kind: FormKind
  barber: string
  date: string
  time: string
  /** Block length in minutes (text of the input). */
  duration: string
  service: string
  extras: string[]
  /** Existing client chosen by the lookup (admin/manager). */
  clientId: string | null
  phone: string
  firstName: string
  lastName: string
  /** "Without a name" (decision 20): no client at all. */
  withoutName: boolean
  promoCode: string
  discountType: ManualDiscountType
  /** Lei text for `amount`, a number for `percent`. */
  discountValue: string
  discountReason: string
  clientComment: string
  internalNote: string
}

export const emptyForm = (init: Partial<FormState> = {}): FormState => ({
  kind: 'appointment',
  barber: '',
  date: '',
  time: '',
  duration: '60',
  service: '',
  extras: [],
  clientId: null,
  phone: '',
  firstName: '',
  lastName: '',
  withoutName: false,
  promoCode: '',
  discountType: 'amount',
  discountValue: '',
  discountReason: '',
  clientComment: '',
  internalNote: '',
  ...init,
})

export type ManualDiscountBody = { type: ManualDiscountType; value: number; reason: string | null }

/** Error code of a field the form checks itself (before the server does). */
export type FormIssue =
  'required' | 'timeInvalid' | 'dateInvalid' | 'durationInvalid' | 'discountValueInvalid'

/**
 * Manual discount of the form → API shape. Empty or zero = no discount (`null`);
 * `undefined` = the text cannot be parsed.
 */
export const parseManualDiscount = (state: FormState): ManualDiscountBody | null | undefined => {
  const raw = state.discountValue.trim()
  if (raw === '') return null
  const value =
    state.discountType === 'amount'
      ? parseLeiInput(raw)
      : /^\d+([.,]\d+)?$/.test(raw)
        ? Number(raw.replace(',', '.'))
        : null
  if (value === null || !Number.isFinite(value)) return undefined
  if (state.discountType === 'percent' && value > 100) return undefined
  if (value === 0) return null
  return { type: state.discountType, value, reason: state.discountReason.trim() || null }
}

/** Fields the form validates itself; the server remains the authority. */
export const validateForm = (state: FormState): Partial<Record<keyof FormState, FormIssue>> => {
  const issues: Partial<Record<keyof FormState, FormIssue>> = {}
  if (!state.barber) issues.barber = 'required'
  if (!isLocalDate(state.date)) issues.date = 'dateInvalid'
  if (!isLocalTime(state.time)) issues.time = 'timeInvalid'
  if (state.kind === 'block') {
    const minutes = Number(state.duration)
    if (!Number.isInteger(minutes) || minutes <= 0) issues.duration = 'durationInvalid'
  } else if (!state.service) issues.service = 'required'
  if (parseManualDiscount(state) === undefined) issues.discountValue = 'discountValueInvalid'
  return issues
}

/** Start instant of the form (local wall-clock → UTC). Call only after `validateForm`. */
export const formStart = (state: FormState): string =>
  localToInstant(state.date, state.time).toISOString()

type Body = Record<string, unknown>

/** Client part of the body: nothing, `null` (without a name), an id or a phone (+ name) for the server to link. */
const clientBody = (state: FormState): Body => {
  if (state.withoutName) return { client: null }
  if (state.clientId) return { client: state.clientId }
  const phone = state.phone.trim()
  if (!phone) return {}
  return {
    clientPhone: phone,
    ...(state.firstName.trim() ? { clientFirstName: state.firstName.trim() } : {}),
    ...(state.lastName.trim() ? { clientLastName: state.lastName.trim() } : {}),
  }
}

export type BodyOptions = {
  location: string
  /** Admin/manager only (decision 30): a barber never sends discount fields. */
  canDiscount: boolean
}

/** `POST /api/crm/appointments`. */
export const buildCreateBody = (state: FormState, options: BodyOptions): Body => {
  const body: Body = {
    kind: state.kind,
    location: options.location,
    barber: state.barber,
    start: formStart(state),
    ...(state.clientComment.trim() ? { clientComment: state.clientComment.trim() } : {}),
    ...(state.internalNote.trim() ? { internalNote: state.internalNote.trim() } : {}),
  }
  if (state.kind === 'block') return { ...body, durationMinutes: Number(state.duration) }
  Object.assign(body, { service: state.service, extras: state.extras }, clientBody(state))
  if (state.promoCode.trim()) body.promoCode = state.promoCode.trim()
  const discount = options.canDiscount ? parseManualDiscount(state) : null
  if (discount) body.manualDiscount = discount
  return body
}

const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|')

/**
 * `PATCH /api/crm/appointments/:id`: only what changed. The server decides warnings (`PRICE_CHANGED`)
 * by the fields present in the body, so unchanged fields must not be sent.
 */
export const buildPatchBody = (
  initial: FormState,
  state: FormState,
  options: BodyOptions,
): Body => {
  const body: Body = {}
  if (state.barber !== initial.barber) body.barber = state.barber
  if (state.date !== initial.date || state.time !== initial.time) body.start = formStart(state)
  if (state.kind === 'block') {
    if (state.duration !== initial.duration) body.durationMinutes = Number(state.duration)
  } else {
    if (state.service !== initial.service) body.service = state.service
    if (!sameList(state.extras, initial.extras)) body.extras = state.extras
    const clientChanged =
      state.withoutName !== initial.withoutName ||
      state.clientId !== initial.clientId ||
      state.phone.trim() !== initial.phone.trim()
    if (clientChanged) Object.assign(body, clientBody(state))
    if (state.promoCode.trim() !== initial.promoCode.trim())
      body.promoCode = state.promoCode.trim() || null
    if (options.canDiscount) {
      const before = JSON.stringify(parseManualDiscount(initial))
      const after = parseManualDiscount(state)
      if (JSON.stringify(after) !== before) body.manualDiscount = after
    }
  }
  if (state.clientComment.trim() !== initial.clientComment.trim())
    body.clientComment = state.clientComment.trim() || null
  if (state.internalNote.trim() !== initial.internalNote.trim())
    body.internalNote = state.internalNote.trim() || null
  return body
}

/** Body of the price preview: the same selection, with the discount only if the role may give it. */
export const buildPreviewBody = (
  state: FormState,
  options: BodyOptions & { clientId?: string | null },
): Body | null => {
  if (state.kind !== 'appointment' || !state.service || !state.barber) return null
  const discount = options.canDiscount ? parseManualDiscount(state) : null
  if (discount === undefined) return null
  return {
    location: options.location,
    barber: state.barber,
    service: state.service,
    extras: state.extras,
    ...(state.promoCode.trim() ? { promoCode: state.promoCode.trim() } : {}),
    ...(discount ? { manualDiscount: discount } : {}),
    ...(options.clientId ? { client: options.clientId } : {}),
  }
}

// ---------------------------------------------------------------------------
// Actions by role and status (§5.1)
// ---------------------------------------------------------------------------

export type ActionFacts = {
  kind: FormKind
  status: string
  startAt: Date
  now: Date
  /** `can` of `GET /crm/appointments/:id` (server policy). */
  can: { restore: boolean; update: boolean; paid: boolean }
}

export type AppointmentActions = {
  edit: boolean
  complete: boolean
  /** Completing is offered but the start has not come yet. */
  completeTooEarly: boolean
  noShow: boolean
  cancel: boolean
  restore: boolean
}

/** What the modal offers. Hiding is a convenience only: the server checks every transition again. */
export const appointmentActions = (facts: ActionFacts): AppointmentActions => {
  const { kind, status, can } = facts
  const started = facts.startAt.getTime() <= facts.now.getTime()
  const none: AppointmentActions = {
    edit: false,
    complete: false,
    completeTooEarly: false,
    noShow: false,
    cancel: false,
    restore: false,
  }
  if (status === 'paid') return { ...none, edit: can.update && can.paid }
  if (status === 'scheduled') {
    const isBlock = kind === 'block'
    return {
      edit: can.update,
      complete: !isBlock,
      completeTooEarly: !isBlock && !started,
      noShow: !isBlock && started,
      cancel: true,
      restore: false,
    }
  }
  if (status === 'completed') return { ...none, edit: can.update, restore: can.restore }
  // no_show, cancelled_*: only restoring (admin/manager).
  return { ...none, restore: can.restore }
}

// ---------------------------------------------------------------------------
// Grid click → start time
// ---------------------------------------------------------------------------

/** Start (UTC instant) of a click `minutes` after the local midnight of `date`, floored to the grid step. */
export const slotStartAt = (date: string, minutes: number, step: number): Date => {
  const snapped = Math.max(0, Math.floor(minutes / step) * step)
  return addMinutes(localDayRange(date).start, snapped)
}

/** Start of "New appointment" without a clicked slot: the next grid step today, otherwise 10:00. */
export const defaultNewStart = (date: string, now: Date, step: number): Date => {
  const dayStart = localDayRange(date).start
  if (date !== todayLocal(now)) return localToInstant(date, '10:00')
  const minutes = Math.max(
    0,
    Math.ceil((now.getTime() - dayStart.getTime()) / 60_000 / step) * step,
  )
  return addMinutes(dayStart, minutes)
}
