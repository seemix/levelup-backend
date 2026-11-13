/**
 * Ledger adapter (spec §4.13–§4.15, §5.6): collection hooks of `transactions`, the create / reverse
 * service and the balance recalculation. The rules themselves are pure functions in `./ledger`.
 *
 * - `prepareTransaction` (beforeChange): server fields (`author`, `reversed`), a reversal is built
 *   from the original (mirror entries, location, now), type invariants, registers of the location,
 *   expense category, permissions by role (policy `transactions`). On update only `comment` and
 *   `expenseCategory` may change.
 * - `applyTransaction` (afterChange, create): atomic `$inc` of every register balance and
 *   `reversed = true` of the original, in the same DB transaction (`req`).
 */
import {
  createLocalReq,
  type CollectionAfterChangeHook,
  type CollectionBeforeChangeHook,
  type Payload,
  type PayloadRequest,
} from 'payload'
import { APIError } from 'payload'

import { allowed, getStaffContext, type PolicyUser } from '@/access/policy'
import { crmT } from '@/i18n'

import { isTransientError, mongo, runBookingTransaction, sessionOf } from './appointments'
import { ruleError, type RuleErrorCode } from './errors'
import {
  balanceDeltas,
  LedgerError,
  mirrorEntries,
  SERVICE_ONLY_TYPES,
  UNDO_TYPES,
  validateTransaction,
  type LedgerEntry,
  type ReversalTarget,
  type TransactionInput,
  type TransactionType,
} from './ledger'
import { relationId, type RelationValue } from './schedule'

export type LedgerOptions = {
  /** Clock override (tests). */
  now?: Date
  /** Set by the payment / certificate services for `appointment_payment`, `certificate_sale`, `refund`. */
  allowServiceTypes?: boolean
  /** `certificate_sale`: nominal of the certificate being sold. */
  nominal?: number
}

/** A–8: a negative balance is allowed and reported as a warning. */
export type LedgerWarning = 'NEGATIVE_BALANCE'

export type LedgerResult = {
  warnings: LedgerWarning[]
  /** Registers whose balance is below zero after the operation. */
  negativeRegisters: string[]
}

export const LEDGER_CONTEXT = {
  options: 'ledgerOptions',
  result: 'ledgerResult',
} as const

/** Fields that never change after creation (§4.15); `comment` and `expenseCategory` stay editable. */
export const IMMUTABLE_TRANSACTION_FIELDS = [
  'type',
  'occurredAt',
  'location',
  'author',
  'entries',
  'appointment',
  'barber',
  'certificateAmount',
  'tipAmount',
  'certificate',
  'reverses',
  'reversed',
] as const

type Data = Record<string, unknown>

const STATUS: Partial<Record<RuleErrorCode, number>> = {
  ALREADY_REVERSED: 409,
  LEDGER_CONFLICT: 409,
  TRANSACTION_FORBIDDEN: 403,
}

const ledgerError = (req: PayloadRequest, code: RuleErrorCode): APIError =>
  ruleError(req.t, code, STATUS[code] ?? 400)

/** A write conflict on a register / the original: retried by `runLedgerTransaction`. */
const conflictError = (req: PayloadRequest): APIError =>
  new APIError(
    crmT(req.t, 'errors.ledgerConflict'),
    409,
    { code: 'LEDGER_CONFLICT', retryable: true },
    true,
  )

const readOptions = (req: PayloadRequest): LedgerOptions =>
  (req.context[LEDGER_CONTEXT.options] as LedgerOptions | undefined) ?? {}

const SYSTEM = { overrideAccess: true, depth: 0 } as const

const id = (value: unknown): string | null => relationId(value as RelationValue)

const toEntries = (value: unknown): LedgerEntry[] =>
  Array.isArray(value)
    ? value.map((row) => ({
        cashRegister: id((row as Data)?.cashRegister) ?? '',
        amount: (row as Data)?.amount as number,
      }))
    : []

const numberOrNull = (value: unknown): number | null => (typeof value === 'number' ? value : null)

// ---------------------------------------------------------------------------
// beforeChange
// ---------------------------------------------------------------------------

type Original = ReversalTarget & {
  id: string
  location: string | null
  occurredAt: string | null
  appointment: string | null
  barber: string | null
  certificate: string | null
  certificateAmount: number | null
  tipAmount: number | null
}

const loadOriginal = async (req: PayloadRequest, originalId: string): Promise<Original | null> => {
  const { docs } = await req.payload.find({
    collection: 'transactions',
    ...SYSTEM,
    req,
    where: { id: { equals: originalId } },
    limit: 1,
    pagination: false,
    select: {
      type: true,
      entries: true,
      location: true,
      occurredAt: true,
      appointment: true,
      barber: true,
      certificate: true,
      certificateAmount: true,
      tipAmount: true,
      reversed: true,
    },
  })
  const doc = docs[0] as Data | undefined
  if (!doc) return null
  return {
    id: originalId,
    type: doc.type as TransactionType,
    entries: toEntries(doc.entries),
    reversed: Boolean(doc.reversed),
    location: id(doc.location),
    occurredAt: (doc.occurredAt as string | null) ?? null,
    appointment: id(doc.appointment),
    barber: id(doc.barber),
    certificate: id(doc.certificate),
    certificateAmount: numberOrNull(doc.certificateAmount),
    tipAmount: numberOrNull(doc.tipAmount),
  }
}

/** Every register exists and belongs to the location; new money moves need active registers. */
const checkRegisters = async (
  req: PayloadRequest,
  entries: LedgerEntry[],
  location: string,
  requireActive: boolean,
) => {
  const ids = [...new Set(entries.map((entry) => entry.cashRegister))]
  if (ids.length === 0) return
  const { docs } = await req.payload.find({
    collection: 'cash-registers',
    ...SYSTEM,
    req,
    where: { id: { in: ids } },
    pagination: false,
    select: { location: true, active: true },
  })
  const byId = new Map(docs.map((doc) => [String(doc.id), doc as Data]))
  for (const registerId of ids) {
    const register = byId.get(registerId)
    if (!register || id(register.location) !== location || (requireActive && !register.active))
      throw ledgerError(req, 'CASH_REGISTER_INVALID')
  }
}

const checkExpenseCategory = async (req: PayloadRequest, categoryId: string) => {
  const { docs } = await req.payload.find({
    collection: 'expense-categories',
    ...SYSTEM,
    req,
    where: { id: { equals: categoryId } },
    limit: 1,
    pagination: false,
    select: { active: true },
  })
  if (!docs[0] || !(docs[0] as Data).active) throw ledgerError(req, 'EXPENSE_CATEGORY_INVALID')
}

const validate = (req: PayloadRequest, input: TransactionInput, target?: ReversalTarget) => {
  try {
    validateTransaction(input, target)
  } catch (error) {
    if (error instanceof LedgerError) throw ledgerError(req, error.code)
    throw error
  }
}

/** Update: only `comment` and `expenseCategory` (of an expense) change; everything else is kept. */
const prepareUpdate = async (req: PayloadRequest, data: Data, originalDoc: Data | undefined) => {
  for (const field of IMMUTABLE_TRANSACTION_FIELDS)
    if (field in data) data[field] = originalDoc?.[field]
  if (!('expenseCategory' in data)) return data
  const category = id(data.expenseCategory)
  if (originalDoc?.type !== 'expense') {
    if (category) throw ledgerError(req, 'EXPENSE_CATEGORY_NOT_ALLOWED')
    return data
  }
  if (!category) throw ledgerError(req, 'EXPENSE_CATEGORY_REQUIRED')
  if (category !== id(originalDoc.expenseCategory)) await checkExpenseCategory(req, category)
  return data
}

export const prepareTransaction: CollectionBeforeChangeHook = async ({
  data,
  operation,
  originalDoc,
  req,
}) => {
  if (operation === 'update') return prepareUpdate(req, data as Data, originalDoc as Data)

  const options = readOptions(req)
  const now = options.now ?? new Date()
  const type = data.type as TransactionType | undefined
  if (type && SERVICE_ONLY_TYPES.includes(type) && !options.allowServiceTypes)
    throw ledgerError(req, 'TRANSACTION_TYPE_UNSUPPORTED')

  // Server fields: never taken from the request.
  data.author = req.user?.collection === 'users' ? req.user.id : null
  data.reversed = false

  let target: Original | undefined
  if (type && UNDO_TYPES.includes(type)) {
    const originalId = id(data.reverses)
    const original = originalId ? await loadOriginal(req, originalId) : null
    if (!original) throw ledgerError(req, 'REVERSAL_TARGET_INVALID')
    target = original
    // The undo is the mirror of the original, now, in its location (§4.15).
    data.reverses = original.id
    data.location = original.location
    data.entries = mirrorEntries(original.entries)
    data.occurredAt = now.toISOString()
    data.expenseCategory = null
    data.appointment = type === 'refund' ? original.appointment : null
    data.barber = type === 'refund' ? original.barber : null
    // A refund carries the certificate and tip parts it returns (salary and certificate reports).
    data.certificate = type === 'refund' ? original.certificate : null
    data.certificateAmount = type === 'refund' ? original.certificateAmount : null
    data.tipAmount = type === 'refund' ? original.tipAmount : null
  } else {
    data.occurredAt ??= now.toISOString()
  }

  const location = id(data.location)
  // Missing required fields are reported by the field validation that runs after this hook.
  if (!type || !location) return data

  const entries = toEntries(data.entries)
  validate(
    req,
    {
      type,
      entries,
      comment: (data.comment as string | null) ?? null,
      expenseCategory: id(data.expenseCategory),
      appointment: id(data.appointment),
      certificateAmount: numberOrNull(data.certificateAmount),
      tipAmount: numberOrNull(data.tipAmount),
      reverses: id(data.reverses),
      certificate: id(data.certificate),
      nominal: options.nominal ?? null,
    },
    target,
  )
  await checkRegisters(req, entries, location, !target)
  const category = id(data.expenseCategory)
  if (category) await checkExpenseCategory(req, category)

  // Role rules (§3.1); a request without a user is a system operation (seed, scripts, services).
  if (req.user) {
    const { barberId, managedBarberIds } = await getStaffContext(req)
    const operationDoc = {
      type,
      location,
      barber: id(data.barber),
      occurredAt: data.occurredAt as string,
      now,
      target: target
        ? { type: target.type, location: target.location, occurredAt: target.occurredAt }
        : null,
    }
    if (
      !allowed(req.user as PolicyUser, 'create', 'transactions', operationDoc, {
        barberId,
        managedBarberIds,
      })
    )
      throw ledgerError(req, 'TRANSACTION_FORBIDDEN')
  }
  return data
}

// ---------------------------------------------------------------------------
// afterChange: balances and the reversed flag (§5.6)
// ---------------------------------------------------------------------------

const rethrowConflict = (req: PayloadRequest, error: unknown): never => {
  if (isTransientError(error)) throw conflictError(req)
  throw error
}

export const applyTransaction: CollectionAfterChangeHook = async ({ doc, operation, req }) => {
  if (operation !== 'create') return doc
  const session = await sessionOf(req)
  const registers = mongo(req).collections['cash-registers']
  const negativeRegisters: string[] = []

  for (const [registerId, delta] of balanceDeltas(toEntries(doc.entries))) {
    if (delta === 0) continue
    const updated = (await registers
      .findOneAndUpdate(
        { _id: registerId },
        { $inc: { balance: delta } },
        { new: true, session, projection: { balance: 1 } },
      )
      .lean()
      .catch((error: unknown) => rethrowConflict(req, error))) as { balance?: number } | null
    if (!updated) throw ledgerError(req, 'CASH_REGISTER_INVALID')
    if ((updated.balance ?? 0) < 0) negativeRegisters.push(registerId)
  }

  const reverses = id(doc.reverses)
  if (reverses) {
    // Conditional flip: a second undo of the same operation fails even under concurrency.
    const result = await mongo(req)
      .collections['transactions'].updateOne(
        { _id: reverses, reversed: { $ne: true } },
        { $set: { reversed: true } },
        { session },
      )
      .catch((error: unknown) => rethrowConflict(req, error))
    if (result.matchedCount === 0) throw ledgerError(req, 'ALREADY_REVERSED')
  }

  req.context[LEDGER_CONTEXT.result] = {
    warnings: negativeRegisters.length > 0 ? ['NEGATIVE_BALANCE'] : [],
    negativeRegisters,
  } satisfies LedgerResult
  return doc
}

// ---------------------------------------------------------------------------
// Service API
// ---------------------------------------------------------------------------

/** Runs `fn` in a DB transaction with retries on write conflicts, then `LEDGER_CONFLICT` (409). */
export const runLedgerTransaction = <T>(req: PayloadRequest, fn: () => Promise<T>): Promise<T> =>
  runBookingTransaction(req, fn, () => ledgerError(req, 'LEDGER_CONFLICT'))

export type TransactionDoc = Data & { id: string | number }

export type TransactionServiceResult = LedgerResult & { doc: TransactionDoc }

/** Fields a caller may send; server fields (`author`, `reversed`) are ignored by the hook. */
export type TransactionData = {
  type: TransactionType
  location?: string
  occurredAt?: string | Date
  comment?: string | null
  entries?: LedgerEntry[]
  expenseCategory?: string | null
  appointment?: string | null
  barber?: string | null
  certificateAmount?: number | null
  tipAmount?: number | null
  certificate?: string | null
  reverses?: string | null
}

/**
 * Creates an operation with the user's rights (`overrideAccess: false`) or as the system
 * (request without a user), in its own transaction (or the caller's).
 */
export const createTransaction = (
  req: PayloadRequest,
  data: TransactionData,
  options: LedgerOptions = {},
): Promise<TransactionServiceResult> =>
  runLedgerTransaction(req, async () => {
    req.context[LEDGER_CONTEXT.options] = options
    req.context[LEDGER_CONTEXT.result] = undefined
    const doc = await req.payload.create({
      collection: 'transactions',
      data: data as never,
      overrideAccess: !req.user,
      depth: 0,
      req,
    })
    const result = (req.context[LEDGER_CONTEXT.result] as LedgerResult | undefined) ?? {
      warnings: [],
      negativeRegisters: [],
    }
    return { ...result, doc: doc as unknown as TransactionDoc }
  })

/** Reversal (§5.6): the mirror operation; the original gets `reversed = true`. */
export const reverseTransaction = (
  req: PayloadRequest,
  originalId: string,
  { comment, ...options }: LedgerOptions & { comment?: string | null } = {},
): Promise<TransactionServiceResult> =>
  createTransaction(
    req,
    { type: 'reversal', reverses: originalId, comment: comment ?? null },
    options,
  )

// ---------------------------------------------------------------------------
// Recalculation (`pnpm crm:recalc-balances`)
// ---------------------------------------------------------------------------

export type BalanceDiff = { cashRegister: string; stored: number; computed: number }

/**
 * Recomputes every register balance from all entries (Σ amount) in one transaction and, with
 * `apply`, writes the differences. Returns the registers whose stored balance was wrong.
 */
export const recalculateBalances = async (
  payload: Payload,
  { apply = true }: { apply?: boolean } = {},
): Promise<{ registers: number; diffs: BalanceDiff[] }> => {
  const req = await createLocalReq({}, payload)
  return runLedgerTransaction(req, async () => {
    const session = (await sessionOf(req)) ?? null
    const db = mongo(req)
    const sums = (await db.collections['transactions']
      .aggregate([
        { $unwind: '$entries' },
        { $group: { _id: '$entries.cashRegister', total: { $sum: '$entries.amount' } } },
      ])
      .session(session)) as { _id: unknown; total: number }[]
    const computed = new Map(sums.map((row) => [String(row._id), row.total]))

    const registers = (await db.collections['cash-registers']
      .find({}, { balance: 1 })
      .session(session)
      .lean()) as { _id: unknown; balance?: number }[]
    const diffs: BalanceDiff[] = []
    for (const register of registers) {
      const registerId = String(register._id)
      const stored = register.balance ?? 0
      const expected = computed.get(registerId) ?? 0
      if (stored === expected) continue
      diffs.push({ cashRegister: registerId, stored, computed: expected })
      if (apply)
        await db.collections['cash-registers'].updateOne(
          { _id: register._id },
          { $set: { balance: expected } },
          { session: session ?? undefined },
        )
    }
    return { registers: registers.length, diffs }
  })
}
