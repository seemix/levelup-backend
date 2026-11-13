/**
 * Appointments service (spec §4.11, §5.1, §5.3 p.7, §5.4 p.7, §5.5, §5.9, §5.11).
 *
 * The rules live in the `appointments` collection hooks, so the admin form, the CRM endpoints and the
 * public booking endpoint all go through the same code:
 * - `prepareAppointment` (beforeChange): server-owned fields, status machine, price snapshot, slot
 *   validation under the `booking-locks` lock, promo code counter, cancel token;
 * - `logAppointmentChange` (afterChange): history in `appointment-logs`.
 *
 * Endpoints call `createAppointment` / `updateAppointment` / `changeAppointmentStatus`: they run the
 * Local API operation in a MongoDB transaction and retry it on a write conflict (§5.9). The admin form
 * runs inside Payload's own transaction (no retries): a conflict there ends with `SLOT_TAKEN`.
 * Every call needs its own `req` (the transaction id is stored on it).
 */
import { createHash, randomBytes } from 'node:crypto'
import type { MongooseAdapter } from '@payloadcms/db-mongodb'
import {
  APIError,
  type CollectionAfterChangeHook,
  type CollectionBeforeChangeHook,
  type PayloadRequest,
} from 'payload'

import { allowed, getStaffContext, type PolicyScope, type PolicyUser } from '@/access/policy'
import { crmT } from '@/i18n'

import {
  checkTransition,
  derivePaymentStatus,
  isActiveStatus,
  isCancelledStatus,
  type AppointmentKind,
  type AppointmentStatus,
  type PaymentStatus,
  type TransitionActor,
} from './appointment-status'
import { ruleError, toRuleError, type RuleErrorCode } from './errors'
import { calculatePrice, type CatalogItem, type PriceOverride } from './pricing'
import {
  appointmentsPromoUsage,
  checkPromo,
  findPromoById,
  type PromoErrorCode,
  toPromoRule,
} from './promo'
import { relationId, type RelationValue } from './schedule'
import { checkSlot } from './slots'
import { appointmentsBusySource, loadSlotInput } from './slots.loader'
import { addMinutes, localDayRange, toLocalDate } from './time'

// ---------------------------------------------------------------------------
// Request context
// ---------------------------------------------------------------------------

export type BookingMode = 'online' | 'staff'
export type ActorType = 'user' | 'client' | 'system'

/** Who is acting and how; set by the service/endpoints. Defaults: staff mode, actor from `req.user`. */
export type AppointmentOptions = {
  /** `online` — public booking rules (§5.3 p.5); `staff` — CRM rules (§5.3 p.7). */
  mode?: BookingMode
  /** `client` — public endpoint (cancel by token); `system` — jobs, import, seed. */
  actorType?: ActorType
  /** Clock override (tests, endpoints that already read the time). */
  now?: Date
  /** Log action override for the payment/refund flow (stage 18). */
  logAction?: LogAction
}

export type AppointmentWarning = 'OUTSIDE_SCHEDULE' | 'REFUND_REQUIRED'

export type AppointmentResult = {
  warnings: AppointmentWarning[]
  /** Plain cancel token of a new appointment (only its sha256 is stored). */
  cancelToken?: string
}

export const APPOINTMENT_CONTEXT = {
  options: 'appointmentOptions',
  result: 'appointmentResult',
  /** Set by the ledger (stage 18): `paidAmount`, `certificateAmount`, `tipAmount`, `paid` status may change. */
  ledger: 'appointmentLedger',
  /** Skip the history entry (bulk/system maintenance). */
  skipLog: 'skipAppointmentLog',
  /** Re-entrancy guard of the history hook. */
  logging: 'appointmentLogging',
} as const

const readOptions = (req: PayloadRequest): AppointmentOptions =>
  (req.context[APPOINTMENT_CONTEXT.options] as AppointmentOptions | undefined) ?? {}

// ---------------------------------------------------------------------------
// Cancel token (§5.10)
// ---------------------------------------------------------------------------

export const hashCancelToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex')

/** 32 random bytes, base64url; only the sha256 goes to the database. */
export const generateCancelToken = (): { token: string; hash: string } => {
  const token = randomBytes(32).toString('base64url')
  return { token, hash: hashCancelToken(token) }
}

// ---------------------------------------------------------------------------
// Transactions and the barber-day lock (§5.9)
// ---------------------------------------------------------------------------

const MAX_RETRIES = 3

type MongoLikeError = {
  code?: number
  codeName?: string
  errorLabels?: string[]
  hasErrorLabel?: (label: string) => boolean
  data?: { retryable?: boolean }
  cause?: unknown
}

/** WriteConflict / TransientTransactionError (also our own retryable `SLOT_TAKEN`). */
export const isTransientError = (error: unknown, depth = 0): boolean => {
  if (!error || typeof error !== 'object' || depth > 5) return false
  const e = error as MongoLikeError
  if (e.data?.retryable) return true
  if (e.code === 112 || e.codeName === 'WriteConflict') return true
  if (e.code === 251 || e.codeName === 'NoSuchTransaction') return true
  if (typeof e.hasErrorLabel === 'function' && e.hasErrorLabel('TransientTransactionError'))
    return true
  if (Array.isArray(e.errorLabels) && e.errorLabels.includes('TransientTransactionError'))
    return true
  return isTransientError(e.cause, depth + 1)
}

/** `SLOT_TAKEN` marked as retryable: the service retries, the admin form shows it as is. */
const conflictError = (req: PayloadRequest): APIError =>
  new APIError(crmT(req.t, 'errors.slotTaken'), 409, { code: 'SLOT_TAKEN', retryable: true }, true)

const mongo = (req: PayloadRequest) => req.payload.db as unknown as MongooseAdapter

const sessionOf = async (req: PayloadRequest) => {
  const id = req.transactionID instanceof Promise ? await req.transactionID : req.transactionID
  return id ? mongo(req).sessions[id] : undefined
}

/**
 * Upserts `booking-locks {barber, date}` with `$inc version` in the current transaction:
 * concurrent transactions for the same barber and local day get a WriteConflict.
 */
const lockBarberDay = async (req: PayloadRequest, barberId: string, date: string) => {
  const session = await sessionOf(req)
  try {
    await mongo(req).collections['booking-locks'].updateOne(
      { barber: barberId, date },
      {
        $inc: { version: 1 },
        $set: { updatedAt: new Date() },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true, session },
    )
  } catch (error) {
    if (isTransientError(error) || (error as MongoLikeError).code === 11000)
      throw conflictError(req)
    throw error
  }
}

/** Atomic `usedCount` change in the current transaction (a conflict on the promo document is retried). */
const incrementPromoUsage = async (req: PayloadRequest, promoId: string, delta: number) => {
  const session = await sessionOf(req)
  try {
    await mongo(req).collections['promo-codes'].updateOne(
      { _id: promoId },
      { $inc: { usedCount: delta } },
      { session },
    )
  } catch (error) {
    if (isTransientError(error)) throw conflictError(req)
    throw error
  }
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Runs `fn` in a MongoDB transaction and retries it up to 3 times on a write conflict,
 * then fails with `SLOT_TAKEN` (§5.9). Inside an existing transaction `fn` runs as is.
 */
export const runBookingTransaction = async <T>(
  req: PayloadRequest,
  fn: () => Promise<T>,
): Promise<T> => {
  if (req.transactionID) return fn()
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const id = await req.payload.db.beginTransaction()
    if (!id) return fn() // the adapter has no transactions
    req.transactionID = id
    try {
      const value = await fn()
      await req.payload.db.commitTransaction(id)
      delete req.transactionID
      return value
    } catch (error) {
      // Payload rolls back on its own errors; make sure nothing is left open either way.
      if (req.transactionID) {
        await req.payload.db.rollbackTransaction(req.transactionID).catch(() => undefined)
        delete req.transactionID
      }
      if (!isTransientError(error)) throw error
      await pause(5 + Math.floor(Math.random() * 20) * (attempt + 1))
    }
  }
  throw ruleError(req.t, 'SLOT_TAKEN', 409)
}

// ---------------------------------------------------------------------------
// Service API
// ---------------------------------------------------------------------------

/** Fields a caller may send; computed ones are ignored by the hook. */
export type AppointmentInput = {
  kind?: AppointmentKind
  location?: string
  barber?: string
  client?: string | null
  service?: string | null
  extras?: string[]
  startAt?: string | Date
  /** Blocks only; appointments take it from the services. */
  durationMinutes?: number | null
  promoCode?: string | null
  manualDiscountType?: 'amount' | 'percent' | null
  manualDiscountValue?: number | null
  manualDiscountReason?: string | null
  status?: AppointmentStatus
  cancelReason?: string | null
  source?: 'online' | 'staff' | 'import'
  language?: 'ru' | 'ro' | 'en' | null
  clientComment?: string | null
  internalNote?: string | null
  externalId?: string | null
}

export type AppointmentDoc = Record<string, unknown> & { id: string | number }

export type AppointmentServiceResult = AppointmentResult & { doc: AppointmentDoc }

const prepareRequest = (req: PayloadRequest, options: AppointmentOptions) => {
  req.context[APPOINTMENT_CONTEXT.options] = options
  req.context[APPOINTMENT_CONTEXT.result] = undefined
}

const readResult = (req: PayloadRequest): AppointmentResult =>
  (req.context[APPOINTMENT_CONTEXT.result] as AppointmentResult | undefined) ?? { warnings: [] }

/** Local API with `user` → access is enforced; without `user` it is a system/public call. */
const accessOptions = (req: PayloadRequest) => ({ overrideAccess: !req.user, req, depth: 0 })

export const createAppointment = (
  req: PayloadRequest,
  data: AppointmentInput,
  options: AppointmentOptions = {},
): Promise<AppointmentServiceResult> =>
  runBookingTransaction(req, async () => {
    prepareRequest(req, options)
    const doc = await req.payload.create({
      collection: 'appointments',
      data: data as never,
      ...accessOptions(req),
    })
    return { ...readResult(req), doc: doc as unknown as AppointmentDoc }
  })

export const updateAppointment = (
  req: PayloadRequest,
  id: string,
  data: AppointmentInput,
  options: AppointmentOptions = {},
): Promise<AppointmentServiceResult> =>
  runBookingTransaction(req, async () => {
    prepareRequest(req, options)
    const doc = await req.payload.update({
      collection: 'appointments',
      id,
      data: data as never,
      ...accessOptions(req),
    })
    return { ...readResult(req), doc: doc as unknown as AppointmentDoc }
  })

export const changeAppointmentStatus = (
  req: PayloadRequest,
  id: string,
  status: AppointmentStatus,
  { cancelReason, ...options }: AppointmentOptions & { cancelReason?: string | null } = {},
): Promise<AppointmentServiceResult> =>
  updateAppointment(
    req,
    id,
    cancelReason === undefined ? { status } : { status, cancelReason },
    options,
  )

// ---------------------------------------------------------------------------
// beforeChange: the rules
// ---------------------------------------------------------------------------

type LineRow = {
  itemType: 'service' | 'extra'
  item: string
  price: number
  durationMinutes: number
}

type Row = {
  id?: string | number
  kind?: AppointmentKind | null
  location?: RelationValue
  barber?: RelationValue
  client?: RelationValue
  service?: RelationValue
  extras?: RelationValue[] | null
  startAt?: string | Date | null
  endAt?: string | Date | null
  durationMinutes?: number | null
  lines?: LineRow[] | null
  subtotal?: number | null
  promoCode?: RelationValue
  promoDiscount?: number | null
  manualDiscountType?: 'amount' | 'percent' | null
  manualDiscountValue?: number | null
  manualDiscount?: number | null
  manualDiscountReason?: string | null
  total?: number | null
  paidAmount?: number | null
  certificateAmount?: number | null
  tipAmount?: number | null
  paymentStatus?: PaymentStatus | null
  status?: AppointmentStatus | null
  statusChangedAt?: string | Date | null
  cancelledAt?: string | Date | null
  cancelReason?: string | null
  source?: string | null
  createdBy?: RelationValue
  language?: string | null
  cancelTokenHash?: string | null
}

/** Never taken from the request: restored from the stored document, then recomputed. */
const SERVER_FIELDS = [
  'kind',
  'source',
  'createdBy',
  'cancelTokenHash',
  'statusChangedAt',
  'cancelledAt',
  'lines',
  'subtotal',
  'promoDiscount',
  'manualDiscount',
  'total',
  'endAt',
  'paymentStatus',
] as const satisfies readonly (keyof Row)[]

/** Changed only by the ledger (stage 18). */
const PAYMENT_FIELDS = ['paidAmount', 'certificateAmount', 'tipAmount'] as const

const ids = (values: readonly RelationValue[] | null | undefined): string[] => [
  ...new Set((values ?? []).map(relationId).filter((id): id is string => id !== null)),
]

const toDate = (value: string | Date | null | undefined): Date | null =>
  value ? new Date(value) : null

/** Comparable form of a field value (relations → ids, dates → ISO, arrays element-wise). */
const comparable = (value: unknown): unknown => {
  if (value === undefined || value === '') return null
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(comparable)
  if (value && typeof value === 'object' && 'id' in value)
    return String((value as { id: unknown }).id)
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value))
    return new Date(value).toISOString()
  return value
}

const sameValue = (a: unknown, b: unknown): boolean =>
  JSON.stringify(comparable(a)) === JSON.stringify(comparable(b))

const fail = (req: PayloadRequest, code: RuleErrorCode, status = 400): never => {
  throw ruleError(req.t, code, status)
}

const PROMO_STATUS: Record<PromoErrorCode, number> = {
  PROMO_NOT_FOUND: 404,
  PROMO_EXPIRED: 400,
  PROMO_LIMIT: 409,
  PROMO_CLIENT_LIMIT: 409,
  PROMO_NOT_APPLICABLE: 400,
}

type SystemReads = ReturnType<typeof systemReads>

/** System reads inside the current transaction (`depth: 0`, `select`). */
const systemReads = (req: PayloadRequest) => {
  const base = { depth: 0, overrideAccess: true, pagination: false, req } as const
  return {
    settings: async () => {
      const doc = (await req.payload.findGlobal({
        slug: 'booking-settings',
        depth: 0,
        overrideAccess: true,
        req,
        select: { bufferMinutes: true, clientCancelMinHours: true },
      })) as { bufferMinutes?: number | null; clientCancelMinHours?: number | null }
      return {
        bufferMinutes: doc.bufferMinutes ?? 0,
        clientCancelMinHours: doc.clientCancelMinHours ?? 3,
      }
    },
    barberLocations: async (barberId: string): Promise<string[]> => {
      const { docs } = await req.payload.find({
        collection: 'barbers',
        ...base,
        where: { id: { equals: barberId } },
        limit: 1,
        select: { locations: true },
      })
      return ids((docs[0]?.locations ?? []) as RelationValue[])
    },
    client: async (clientId: string) => {
      const { docs } = await req.payload.find({
        collection: 'clients',
        ...base,
        where: { id: { equals: clientId } },
        limit: 1,
        select: { blocked: true, language: true },
      })
      return (docs[0] as { blocked?: boolean | null; language?: string | null } | undefined) ?? null
    },
    catalog: async (serviceId: string, extraIds: string[], barberId: string) => {
      const { docs: services } = await req.payload.find({
        collection: 'services',
        ...base,
        where: { id: { equals: serviceId } },
        limit: 1,
        select: { price: true, durationMinutes: true, active: true, onlineBooking: true },
      })
      const extras =
        extraIds.length === 0
          ? []
          : (
              await req.payload.find({
                collection: 'extras',
                ...base,
                where: { id: { in: extraIds } },
                limit: extraIds.length,
                select: {
                  price: true,
                  durationMinutes: true,
                  active: true,
                  onlineBooking: true,
                  appliesTo: true,
                },
              })
            ).docs
      const { docs: prices } = await req.payload.find({
        collection: 'barber-prices',
        ...base,
        where: {
          and: [
            { barber: { equals: barberId } },
            { 'item.value': { in: [serviceId, ...extraIds] } },
          ],
        },
        limit: 0,
        select: { item: true, price: true, durationMinutes: true },
      })
      return {
        service: services[0] as CatalogRow | undefined,
        extras: extras as unknown as CatalogRow[],
        overrides: (prices as unknown as PriceRow[]).map((row): PriceOverride => ({
          itemType: row.item.relationTo,
          itemId: relationId(row.item.value) ?? '',
          price: row.price,
          durationMinutes: row.durationMinutes,
        })),
      }
    },
  }
}

type CatalogRow = {
  id: string | number
  price: number
  durationMinutes: number
  active?: boolean | null
  onlineBooking?: boolean | null
  appliesTo?: RelationValue[] | null
}

type PriceRow = {
  item: { relationTo: 'services' | 'extras'; value: RelationValue }
  price?: number | null
  durationMinutes?: number | null
}

const toItem = (row: CatalogRow): CatalogItem => ({
  id: String(row.id),
  price: row.price,
  durationMinutes: row.durationMinutes,
})

/** Catalog items of the current selection (validated) — or of the stored snapshot. */
const priceItems = async (
  req: PayloadRequest,
  reads: SystemReads,
  args: {
    fromCatalog: boolean
    mode: BookingMode
    serviceId: string
    extraIds: string[]
    barberId: string
    lines: LineRow[]
  },
): Promise<{ service: CatalogItem; extras: CatalogItem[]; overrides: PriceOverride[] }> => {
  if (!args.fromCatalog && args.lines.length > 0) {
    const [service, ...extras] = args.lines
    const item = (line: LineRow): CatalogItem => ({
      id: line.item,
      price: line.price,
      durationMinutes: line.durationMinutes,
    })
    return { service: item(service), extras: extras.map(item), overrides: [] }
  }
  const catalog = await reads.catalog(args.serviceId, args.extraIds, args.barberId)
  const online = args.mode === 'online'
  const service = catalog.service
  if (!service || (online && !(service.active && service.onlineBooking)))
    return fail(req, 'SERVICE_NOT_FOUND', 404)
  const extras = args.extraIds.map((id) => {
    const extra = catalog.extras.find((row) => String(row.id) === id)
    if (!extra || (online && !(extra.active && extra.onlineBooking)))
      return fail(req, 'EXTRA_NOT_FOUND', 404)
    const appliesTo = ids(extra.appliesTo)
    // Empty `appliesTo` = offered with every service (decision 15).
    if (appliesTo.length > 0 && !appliesTo.includes(args.serviceId))
      return fail(req, 'EXTRA_NOT_APPLICABLE')
    return toItem(extra)
  })
  return { service: toItem(service), extras, overrides: catalog.overrides }
}

/**
 * The rules of §4.11 / §5.1 / §5.4 / §5.5 / §5.9 for every write of `appointments`.
 * `data` is the full document (Payload merges the stored values in `beforeValidate`).
 */
export const prepareAppointment: CollectionBeforeChangeHook = async ({
  data,
  originalDoc,
  operation,
  req,
}) => {
  const options = readOptions(req)
  const now = options.now ?? new Date()
  const result: AppointmentResult = { warnings: [] }
  req.context[APPOINTMENT_CONTEXT.result] = result
  const reads = systemReads(req)

  const prev = operation === 'update' ? (originalDoc as Row) : undefined
  const next = data as Row
  const isCreate = !prev
  const user = req.user as PolicyUser
  const staff = user ? await getStaffContext(req) : null
  const scope: PolicyScope | undefined = staff
    ? { barberId: staff.barberId, managedBarberIds: staff.managedBarberIds }
    : undefined
  const actorType: ActorType = options.actorType ?? (user ? 'user' : 'system')
  const mode: BookingMode = options.mode ?? 'staff'
  const ledger = req.context[APPOINTMENT_CONTEXT.ledger] === true

  // 1. Server-owned fields.
  if (prev) {
    for (const field of SERVER_FIELDS) (next as Record<string, unknown>)[field] = prev[field]
    if (!ledger) for (const field of PAYMENT_FIELDS) next[field] = prev[field] ?? 0
  } else {
    next.kind = next.kind ?? 'appointment'
    next.createdBy = user?.id ?? null
    next.source = user
      ? 'staff'
      : mode === 'online'
        ? 'online'
        : next.source === 'online'
          ? 'online'
          : (next.source ?? 'import')
    next.cancelTokenHash = null
    next.statusChangedAt = now.toISOString()
    next.cancelledAt = null
    if (!ledger) for (const field of PAYMENT_FIELDS) next[field] = 0
    next.paymentStatus = 'unpaid'
  }
  const kind: AppointmentKind = next.kind ?? 'appointment'

  // 2. Shape by kind.
  next.extras = ids(next.extras)
  if (kind === 'block') {
    next.client = null
    next.service = null
    next.extras = []
    next.promoCode = null
    next.manualDiscountType = null
    next.manualDiscountValue = null
    next.manualDiscountReason = null
    next.lines = []
    next.subtotal = 0
    next.promoDiscount = 0
    next.manualDiscount = 0
    next.total = 0
  } else {
    if (!relationId(next.service)) fail(req, 'SERVICE_REQUIRED')
    if (mode === 'online' && !relationId(next.client)) fail(req, 'CLIENT_REQUIRED')
  }

  const barberId = relationId(next.barber)
  const locationId = relationId(next.location)
  if (!barberId || !locationId) return fail(req, 'SLOT_UNAVAILABLE')

  // 3. The target must stay within the user's scope (manager — own locations, barber — own column).
  if (user && !allowed(user, isCreate ? 'create' : 'update', 'appointments', next, scope))
    fail(req, 'APPOINTMENT_FORBIDDEN', 403)

  // 4. What changes.
  const changed = (field: keyof Row) => isCreate || !sameValue(prev?.[field], next[field])
  const compositionChanged = changed('service') || changed('extras')
  const barberChanged = changed('barber')
  const promoChanged = changed('promoCode')
  const hasDiscountInput =
    typeof next.manualDiscountValue === 'number' && next.manualDiscountValue > 0
  const discountChanged =
    changed('manualDiscountType') ||
    changed('manualDiscountValue') ||
    changed('manualDiscountReason')
  const fromStatus: AppointmentStatus = prev?.status ?? 'scheduled'
  const requestedStatus: AppointmentStatus = next.status ?? 'scheduled'
  const restoring = !isCreate && !isActiveStatus(fromStatus) && isActiveStatus(requestedStatus)

  // 5. Permissions for price changes.
  const priceTouched =
    !isCreate && (compositionChanged || barberChanged || promoChanged || discountChanged)
  const prevPaid = prev?.status === 'paid' || prev?.paymentStatus === 'paid'
  if (priceTouched && prevPaid && user && !allowed(user, 'update', 'appointments.paid'))
    fail(req, 'APPOINTMENT_PAID_LOCKED', 403)
  if (discountChanged && hasDiscountInput) {
    const permitted = user ? allowed(user, 'update', 'appointments.discount') : mode !== 'online'
    if (!permitted) fail(req, 'DISCOUNT_FORBIDDEN', 403)
  }

  // 6. Price snapshot (§5.4 p.7): on creation and on every change of services, barber, promo or discount.
  if (
    kind === 'appointment' &&
    (compositionChanged || barberChanged || promoChanged || discountChanged)
  ) {
    const items = await priceItems(req, reads, {
      fromCatalog: compositionChanged || barberChanged,
      mode,
      serviceId: relationId(next.service)!,
      extraIds: next.extras as string[],
      barberId,
      lines: prev?.lines ?? [],
    })
    const promoId = relationId(next.promoCode)
    let rule = null
    if (promoId) {
      const promo = await findPromoById(req, promoId)
      if (promoChanged || restoring) {
        // A newly applied (or re-activated) code is validated in full (§5.5).
        const clientId = relationId(next.client)
        const clientUses =
          promo && clientId && typeof promo.maxUsesPerClient === 'number'
            ? await appointmentsPromoUsage({
                payload: req.payload,
                req,
                promoId,
                clientId,
                excludeAppointmentId: prev?.id === undefined ? undefined : String(prev.id),
              })
            : 0
        const check = checkPromo({
          promo,
          now,
          mode,
          lines: calculatePrice({ ...items }).lines,
          clientUses,
        })
        if (!check.ok) fail(req, check.code, PROMO_STATUS[check.code])
      }
      // A code already held by the appointment keeps working; only the amount is recalculated.
      if (promo) rule = toPromoRule(promo)
    }
    const manual =
      typeof next.manualDiscountValue === 'number'
        ? {
            type: next.manualDiscountType ?? 'amount',
            value: next.manualDiscountValue,
            reason: next.manualDiscountReason,
          }
        : null
    let price
    try {
      price = calculatePrice({ ...items, promo: rule, manualDiscount: manual })
    } catch (error) {
      throw toRuleError(req.t, error)
    }
    next.lines = price.lines
    next.subtotal = price.subtotal
    next.promoDiscount = price.promoDiscount
    next.manualDiscount = price.manualDiscount
    next.manualDiscountReason = price.manualDiscountReason
    if (price.manualDiscount === 0) {
      next.manualDiscountType = null
      next.manualDiscountValue = null
    }
    next.total = price.total
    next.durationMinutes = price.durationMinutes
  } else if (kind === 'appointment' && prev) {
    next.durationMinutes = prev.durationMinutes
  }

  // 7. Time: appointments last as long as their lines; blocks have their own duration.
  const start = toDate(next.startAt)
  if (!start || Number.isNaN(start.getTime())) return fail(req, 'SLOT_UNAVAILABLE')
  const duration = next.durationMinutes ?? 0
  if (kind === 'block' && (!Number.isInteger(duration) || duration <= 0))
    fail(req, 'BLOCK_TIME_INVALID')
  const end = addMinutes(start, duration)
  const date = toLocalDate(start)
  if (kind === 'block' && end > localDayRange(date).end) fail(req, 'BLOCK_TIME_INVALID')
  next.startAt = start.toISOString()
  next.endAt = end.toISOString()

  // 8. Status machine (§5.1).
  let status = requestedStatus
  if (isCreate) {
    if (status !== 'scheduled' && actorType !== 'system') fail(req, 'STATUS_TRANSITION_INVALID')
  } else if (status !== fromStatus) {
    const settings = await reads.settings()
    const actor: TransitionActor =
      actorType === 'user'
        ? { type: 'user', canRestore: allowed(user, 'update', 'appointments.restore') }
        : actorType === 'client'
          ? { type: 'client' }
          : { type: 'system' }
    const check = checkTransition({
      kind,
      from: fromStatus,
      to: status,
      actor,
      startAt: start,
      now,
      cancelReason: next.cancelReason,
      clientCancelMinHours: settings.clientCancelMinHours,
      fullyPaid: (next.paidAmount ?? 0) > 0 && (next.paidAmount ?? 0) >= (next.total ?? 0),
      ledger,
    })
    if (!check.ok) return fail(req, check.code)
    status = check.status
    next.statusChangedAt = now.toISOString()
    next.cancelledAt = isCancelledStatus(status) ? now.toISOString() : null
    if (isCancelledStatus(status) && (next.paidAmount ?? 0) > 0)
      result.warnings.push('REFUND_REQUIRED')
  }
  next.status = status

  // 9. Slot (§5.9): lock barber+day, then re-check overlaps against the database.
  const timeChanged =
    changed('startAt') ||
    changed('location') ||
    barberChanged ||
    compositionChanged ||
    !sameValue(prev?.durationMinutes, next.durationMinutes)
  if (isActiveStatus(status) && (isCreate || timeChanged || restoring)) {
    if (!(await reads.barberLocations(barberId)).includes(locationId))
      fail(req, 'BARBER_LOCATION_INVALID')
    await lockBarberDay(req, barberId, date)
    const excludeId = prev?.id === undefined ? null : String(prev.id)
    if (kind === 'appointment') {
      const clientId = relationId(next.client)
      const client = mode === 'online' && clientId ? await reads.client(clientId) : null
      const input = await loadSlotInput(
        req.payload,
        {
          mode,
          locationId,
          date,
          barberId,
          serviceId: relationId(next.service)!,
          extraIds: next.extras as string[],
          now,
          clientBlocked: client?.blocked === true,
          excludeAppointmentId: excludeId,
          durationMinutes: duration,
        },
        req,
      )
      const check = checkSlot(input, barberId, start)
      if (!check.ok) return fail(req, check.code, check.code === 'SLOT_TAKEN' ? 409 : 400)
      result.warnings.push(...check.warnings)
    } else {
      const { bufferMinutes } = await reads.settings()
      const busy = await appointmentsBusySource({
        payload: req.payload,
        req,
        barberIds: [barberId],
        from: addMinutes(start, -bufferMinutes),
        to: addMinutes(end, bufferMinutes),
        excludeAppointmentId: excludeId,
      })
      const overlaps = busy.some(
        (item) =>
          addMinutes(item.start, -bufferMinutes) < end &&
          start < addMinutes(item.end, bufferMinutes),
      )
      if (overlaps) fail(req, 'SLOT_TAKEN', 409)
    }
  }

  // 10. Promo usage counter (§5.5): +1 when applied, −1 when cancelled or removed.
  const usedBefore = prev && !isCancelledStatus(prev.status) ? relationId(prev.promoCode) : null
  const usedAfter = !isCancelledStatus(status) ? relationId(next.promoCode) : null
  if (usedBefore !== usedAfter) {
    if (usedBefore) await incrementPromoUsage(req, usedBefore, -1)
    if (usedAfter) await incrementPromoUsage(req, usedAfter, 1)
  }

  // 11. Cancel token, payment status, language.
  if (isCreate && kind === 'appointment') {
    const { token, hash } = generateCancelToken()
    next.cancelTokenHash = hash
    result.cancelToken = token
  }
  next.paymentStatus = derivePaymentStatus(
    next.paidAmount ?? 0,
    next.total ?? 0,
    prev?.paymentStatus,
  )
  if (!next.language) {
    const clientId = relationId(next.client)
    const client = clientId ? await reads.client(clientId) : null
    next.language = client?.language ?? 'ru'
  }
  return next
}

// ---------------------------------------------------------------------------
// afterChange: history (§5.11)
// ---------------------------------------------------------------------------

export type LogAction = 'create' | 'update' | 'move' | 'status' | 'payment' | 'refund' | 'email'

/** Fields whose changes are written to `appointment-logs`. */
export const LOGGED_FIELDS = [
  'kind',
  'location',
  'barber',
  'client',
  'service',
  'extras',
  'startAt',
  'endAt',
  'durationMinutes',
  'subtotal',
  'promoCode',
  'promoDiscount',
  'manualDiscount',
  'manualDiscountReason',
  'total',
  'paidAmount',
  'certificateAmount',
  'tipAmount',
  'paymentStatus',
  'status',
  'cancelReason',
  'clientComment',
  'internalNote',
  'language',
  'confirmationSentAt',
  'reminderSentAt',
] as const

const MOVE_FIELDS: readonly string[] = ['startAt', 'endAt', 'barber', 'location']

export type FieldChange = { field: string; from: unknown; to: unknown }

/** Changed significant fields between two versions (relations as ids, dates as ISO). */
export const diffAppointment = (
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown>,
): FieldChange[] =>
  LOGGED_FIELDS.flatMap((field) => {
    const from = comparable(before?.[field])
    const to = comparable(after[field])
    if (JSON.stringify(from) === JSON.stringify(to)) return []
    if (!before && (to === null || (Array.isArray(to) && to.length === 0))) return []
    return [{ field, from, to }]
  })

export const logActionFor = (operation: 'create' | 'update', changes: FieldChange[]): LogAction => {
  if (operation === 'create') return 'create'
  if (changes.some((change) => change.field === 'status')) return 'status'
  if (changes.some((change) => MOVE_FIELDS.includes(change.field))) return 'move'
  return 'update'
}

export const logAppointmentChange: CollectionAfterChangeHook = async ({
  doc,
  previousDoc,
  operation,
  req,
}) => {
  if (req.context[APPOINTMENT_CONTEXT.skipLog] || req.context[APPOINTMENT_CONTEXT.logging])
    return doc
  const isCreate = operation === 'create'
  const changes = diffAppointment(isCreate ? null : previousDoc, doc)
  if (!isCreate && changes.length === 0) return doc
  const options = readOptions(req)
  const actorType: ActorType = options.actorType ?? (req.user ? 'user' : 'system')
  req.context[APPOINTMENT_CONTEXT.logging] = true
  try {
    // Logs are server-only: nobody may create them through the API, so this write is a system one.
    await req.payload.create({
      collection: 'appointment-logs',
      data: {
        appointment: doc.id,
        location: relationId(doc.location),
        barber: relationId(doc.barber),
        actorType,
        actor: actorType === 'user' ? (req.user?.id ?? null) : null,
        action: options.logAction ?? logActionFor(isCreate ? 'create' : 'update', changes),
        changes: changes.map((change) => ({ ...change })),
        at: (options.now ?? new Date()).toISOString(),
      } as never,
      depth: 0,
      overrideAccess: true,
      req,
    })
  } finally {
    req.context[APPOINTMENT_CONTEXT.logging] = false
  }
  return doc
}

/** Appointments of a barber with a `scheduled` status within local dates (schedule-exception warning). */
export const scheduledAppointmentIds = async (
  req: PayloadRequest,
  barberId: string,
  dateFrom: string,
  dateTo: string,
): Promise<string[]> => {
  const { docs } = await req.payload.find({
    collection: 'appointments',
    where: {
      and: [
        { barber: { equals: barberId } },
        { kind: { equals: 'appointment' } },
        { status: { equals: 'scheduled' } },
        { startAt: { greater_than_equal: localDayRange(dateFrom).start.toISOString() } },
        { startAt: { less_than: localDayRange(dateTo).end.toISOString() } },
      ],
    },
    depth: 0,
    limit: 0,
    pagination: false,
    overrideAccess: true,
    sort: 'startAt',
    select: {},
    req,
  })
  return docs.map((doc) => String(doc.id))
}
