/**
 * Pure helpers of the finance admin view (spec §3.1, §4.15, A35): the operations query, the amount
 * shown in the list, who may be offered a reversal. Rules are enforced by the server; this only
 * decides what the UI shows.
 */
import type { LedgerEntry, TransactionType } from './ledger'
import { sumBani } from './money'
import { localDayRange, toLocalDate } from './time'

export type OperationFilters = {
  /** `YYYY-MM-DD` local dates, inclusive; empty = open. */
  from: string
  to: string
  type: string
  cashRegister: string
  location: string
}

export const emptyFilters = (): OperationFilters => ({
  from: '',
  to: '',
  type: '',
  cashRegister: '',
  location: '',
})

export const OPERATIONS_PAGE_SIZE = 30

/**
 * Query string of `GET /api/transactions` (Payload REST): filters become `where[and][i]…`, newest
 * first. `depth=0` keeps ids; `locale` is for the localized names of related documents.
 */
export const operationsQuery = (
  filters: OperationFilters,
  {
    page = 1,
    limit = OPERATIONS_PAGE_SIZE,
    locale,
  }: { page?: number; limit?: number; locale?: string } = {},
): URLSearchParams => {
  const params = new URLSearchParams({
    depth: '0',
    sort: '-occurredAt',
    limit: String(limit),
    page: String(page),
  })
  if (locale) params.set('locale', locale)
  let index = 0
  const add = (path: string, value: string) => params.set(`where[and][${index++}]${path}`, value)
  if (filters.from)
    add('[occurredAt][greater_than_equal]', localDayRange(filters.from).start.toISOString())
  if (filters.to) add('[occurredAt][less_than]', localDayRange(filters.to).end.toISOString())
  if (filters.type) add('[type][equals]', filters.type)
  if (filters.cashRegister) add('[entries.cashRegister][equals]', filters.cashRegister)
  if (filters.location) add('[location][equals]', filters.location)
  return params
}

/** The amount of an operation for the list: the net sum of entries; a transfer (net 0) — the moved amount. */
export const operationAmount = (entries: readonly LedgerEntry[]): number => {
  const net = sumBani(entries.map((entry) => entry.amount))
  return net !== 0
    ? net
    : sumBani(entries.filter((entry) => entry.amount > 0).map((entry) => entry.amount))
}

/** Types reversed with a `reversal`; a payment goes back with a refund, a certificate sale — not at all (A33, A34). */
export const REVERSIBLE_TYPES: readonly TransactionType[] = ['expense', 'transfer', 'adjustment']
const MANAGER_REVERSIBLE: readonly TransactionType[] = ['expense', 'transfer']

export type ReversalCheck = {
  type: string
  reversed?: boolean | null
  occurredAt: string | Date
  isAdmin: boolean
  isManager: boolean
  now?: Date
}

/** Show "reverse": admin — any reversible, not yet reversed; manager — an expense/transfer of today. */
export const canOfferReversal = ({
  type,
  reversed,
  occurredAt,
  isAdmin,
  isManager,
  now = new Date(),
}: ReversalCheck): boolean => {
  if (reversed) return false
  if (isAdmin) return REVERSIBLE_TYPES.includes(type as TransactionType)
  return (
    isManager &&
    MANAGER_REVERSIBLE.includes(type as TransactionType) &&
    toLocalDate(new Date(occurredAt)) === toLocalDate(now)
  )
}

/** Show "refund" (admin only) for an appointment payment that is not undone yet. */
export const canOfferRefund = (
  transaction: { type: string; reversed?: boolean | null },
  isAdmin: boolean,
): boolean => isAdmin && transaction.type === 'appointment_payment' && !transaction.reversed
