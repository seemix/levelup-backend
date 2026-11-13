/**
 * Appointment status machine (spec §5.1). Pure functions: no database access, `now` comes in.
 * Role facts (`canRestore`) are resolved by the caller through `src/access/policy.ts`.
 */

export const APPOINTMENT_STATUSES = [
  'scheduled',
  'completed',
  'paid',
  'cancelled_by_client',
  'cancelled_by_salon',
  'no_show',
] as const
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number]

export const APPOINTMENT_KINDS = ['appointment', 'block'] as const
export type AppointmentKind = (typeof APPOINTMENT_KINDS)[number]

export const PAYMENT_STATUSES = ['unpaid', 'partial', 'paid', 'refunded'] as const
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number]

export const APPOINTMENT_SOURCES = ['online', 'staff', 'import'] as const
export type AppointmentSource = (typeof APPOINTMENT_SOURCES)[number]

/** Statuses that occupy the barber's time (spec §5.3 p.2). */
export const ACTIVE_STATUSES: readonly AppointmentStatus[] = ['scheduled', 'completed', 'paid']
export const CANCELLED_STATUSES: readonly AppointmentStatus[] = [
  'cancelled_by_client',
  'cancelled_by_salon',
]
/** Statuses a block may have (spec §5.1). */
export const BLOCK_STATUSES: readonly AppointmentStatus[] = ['scheduled', 'cancelled_by_salon']

export const isActiveStatus = (status: string | null | undefined): boolean =>
  ACTIVE_STATUSES.includes(status as AppointmentStatus)
export const isCancelledStatus = (status: string | null | undefined): boolean =>
  CANCELLED_STATUSES.includes(status as AppointmentStatus)

export type StatusErrorCode =
  | 'STATUS_TRANSITION_INVALID'
  | 'STATUS_TOO_EARLY'
  | 'STATUS_FORBIDDEN'
  | 'CANCEL_REASON_REQUIRED'
  | 'CANCEL_TOO_LATE'

export type TransitionActor =
  /** Staff user; `canRestore` = admin/manager (policy `appointments.restore`). */
  | { type: 'user'; canRestore: boolean }
  /** Client through the cancel token (public endpoint). */
  | { type: 'client' }
  /** Server jobs, import, seed: everything the staff rules allow, restore included. */
  | { type: 'system' }

export type TransitionInput = {
  kind: AppointmentKind
  from: AppointmentStatus
  to: AppointmentStatus
  actor: TransitionActor
  startAt: Date
  now: Date
  cancelReason?: string | null
  /** For the client: minimal hours between `now` and `startAt` (`booking-settings`). */
  clientCancelMinHours?: number
  /** `paidAmount ≥ total`: completing a fully paid visit makes it `paid` at once. */
  fullyPaid?: boolean
  /** The payment / refund flow (`payments.service`) moves to and from `paid`; nothing else does. */
  ledger?: boolean
}

export type TransitionCheck =
  { ok: true; status: AppointmentStatus } | { ok: false; code: StatusErrorCode }

const fail = (code: StatusErrorCode): TransitionCheck => ({ ok: false, code })
const HOUR_MS = 60 * 60 * 1000

/** Validates `from → to`; returns the resulting status (`completed` may become `paid`). */
export const checkTransition = (input: TransitionInput): TransitionCheck => {
  const { kind, from, to, actor, startAt, now } = input
  if (from === to) return { ok: true, status: to }

  if (kind === 'block') {
    if (!BLOCK_STATUSES.includes(to) || !BLOCK_STATUSES.includes(from))
      return fail('STATUS_TRANSITION_INVALID')
    if (actor.type === 'client') return fail('STATUS_FORBIDDEN')
    if (to === 'scheduled' && actor.type === 'user' && !actor.canRestore)
      return fail('STATUS_FORBIDDEN')
    return { ok: true, status: to }
  }

  // `paid` is reached and left only by the payment/refund flow (§5.1, §5.8).
  if (to === 'paid' || from === 'paid') {
    if (!input.ledger) return fail('STATUS_TRANSITION_INVALID')
    return { ok: true, status: to }
  }

  if (actor.type === 'client') {
    if (from !== 'scheduled' || to !== 'cancelled_by_client') return fail('STATUS_FORBIDDEN')
    const minHours = input.clientCancelMinHours ?? 0
    return startAt.getTime() - now.getTime() >= minHours * HOUR_MS
      ? { ok: true, status: to }
      : fail('CANCEL_TOO_LATE')
  }

  if (from === 'scheduled') {
    switch (to) {
      case 'completed':
        if (startAt > now) return fail('STATUS_TOO_EARLY')
        return { ok: true, status: input.fullyPaid ? 'paid' : 'completed' }
      case 'no_show':
        return startAt > now ? fail('STATUS_TOO_EARLY') : { ok: true, status: to }
      case 'cancelled_by_client':
        return { ok: true, status: to }
      case 'cancelled_by_salon':
        return input.cancelReason?.trim()
          ? { ok: true, status: to }
          : fail('CANCEL_REASON_REQUIRED')
      default:
        return fail('STATUS_TRANSITION_INVALID')
    }
  }

  // Restore: cancelled_* / no_show / completed → scheduled (admin, manager; the slot is checked by the caller).
  if (to === 'scheduled') {
    if (actor.type === 'user' && !actor.canRestore) return fail('STATUS_FORBIDDEN')
    return { ok: true, status: to }
  }
  return fail('STATUS_TRANSITION_INVALID')
}

/** Derived payment status (§4.11); `refunded` is kept while nothing is paid again. */
export const derivePaymentStatus = (
  paidAmount: number,
  total: number,
  current?: PaymentStatus | null,
): PaymentStatus => {
  if (paidAmount <= 0) return current === 'refunded' ? 'refunded' : 'unpaid'
  return paidAmount >= total ? 'paid' : 'partial'
}
