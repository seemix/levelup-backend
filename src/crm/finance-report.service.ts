/**
 * Loading of the finance and salary reports (spec §8, A38). The data are read by the system
 * (`overrideAccess`, `depth: 0`, always `select`): the endpoint has already checked the role and
 * passes the allowed locations / barber explicitly. A fixed number of queries, independent of the
 * number of operations; they run one after another (the request may carry a transaction session).
 */
import type { PayloadRequest, Where } from 'payload'

import { mongo, sessionOf } from './appointments'
import {
  buildFinanceReport,
  type FinanceReport,
  type PromoUse,
  type ReportCertificate,
  type ReportOperation,
  type ReportRegister,
  type ReversedOriginal,
} from './finance-report'
import type { TransactionType } from './ledger'
import {
  calculateSalary,
  type Commission,
  type ItemType,
  type SalaryAppointment,
  type SalaryOperation,
  type SalaryReport,
} from './salary'
import { relationId, type RelationValue } from './schedule'

const SYSTEM = { overrideAccess: true, depth: 0, pagination: false } as const

export type ReportScope = {
  /** Half-open period `[from, to)` (local days converted by the caller). */
  from: Date
  to: Date
  /** `null` = every location (admin); otherwise the allowed ids (may be empty → nothing). */
  locations: readonly string[] | null
  barber: string | null
  now?: Date
}

type Raw = Record<string, unknown> & { id: string | number }

const num = (value: unknown): number => (typeof value === 'number' ? value : 0)
const id = (value: unknown): string | null => relationId(value as RelationValue)
const unique = (values: (string | null)[]): string[] => [
  ...new Set(values.filter((value): value is string => Boolean(value))),
]

const locationWhere = (scope: ReportScope, field = 'location'): Where[] =>
  scope.locations ? [{ [field]: { in: [...scope.locations] } }] : []

const periodWhere = (scope: ReportScope, field: string): Where[] => [
  { [field]: { greater_than_equal: scope.from.toISOString() } },
  { [field]: { less_than: scope.to.toISOString() } },
]

const toOperation = (doc: Raw): ReportOperation => ({
  id: String(doc.id),
  type: doc.type as TransactionType,
  occurredAt: new Date(doc.occurredAt as string),
  location: id(doc.location) ?? '',
  entries: ((doc.entries as Raw[] | undefined) ?? []).map((entry) => ({
    cashRegister: id(entry.cashRegister) ?? '',
    amount: num(entry.amount),
  })),
  barber: id(doc.barber),
  appointment: id(doc.appointment),
  certificate: id(doc.certificate),
  certificateAmount: num(doc.certificateAmount),
  tipAmount: num(doc.tipAmount),
  expenseCategory: id(doc.expenseCategory),
  reverses: id(doc.reverses),
})

const OPERATION_SELECT = {
  type: true,
  occurredAt: true,
  location: true,
  entries: true,
  barber: true,
  appointment: true,
  certificate: true,
  certificateAmount: true,
  tipAmount: true,
  expenseCategory: true,
  reverses: true,
} as const

const loadOperations = async (
  req: PayloadRequest,
  scope: ReportScope,
  types?: readonly TransactionType[],
): Promise<ReportOperation[]> => {
  const { docs } = await req.payload.find({
    collection: 'transactions',
    ...SYSTEM,
    req,
    sort: 'occurredAt',
    where: {
      and: [
        ...periodWhere(scope, 'occurredAt'),
        ...locationWhere(scope),
        ...(types ? [{ type: { in: [...types] } }] : []),
      ],
    },
    select: OPERATION_SELECT,
  })
  return (docs as unknown as Raw[]).map(toOperation)
}

const loadAppointments = async (
  req: PayloadRequest,
  ids: string[],
): Promise<Map<string, SalaryAppointment>> => {
  const map = new Map<string, SalaryAppointment>()
  if (ids.length === 0) return map
  const { docs } = await req.payload.find({
    collection: 'appointments',
    ...SYSTEM,
    req,
    where: { id: { in: ids } },
    select: { lines: true, subtotal: true, total: true },
  })
  for (const doc of docs as unknown as Raw[])
    map.set(String(doc.id), {
      subtotal: num(doc.subtotal),
      total: num(doc.total),
      lines: ((doc.lines as Raw[] | undefined) ?? []).map((line) => ({
        itemType: (line.itemType === 'extra' ? 'extra' : 'service') as ItemType,
        item: typeof line.item === 'string' ? line.item : null,
        price: num(line.price),
      })),
    })
  return map
}

const paymentOps = (operations: readonly ReportOperation[]): SalaryOperation[] =>
  operations
    .filter((op) => op.type === 'appointment_payment' || op.type === 'refund')
    .map((op) => ({
      id: op.id,
      type: op.type === 'refund' ? 'refund' : 'appointment_payment',
      occurredAt: op.occurredAt,
      barber: op.barber,
      appointment: op.appointment,
      cash: op.entries.reduce((sum, entry) => sum + entry.amount, 0),
      certificateAmount: op.certificateAmount,
      tipAmount: op.tipAmount,
    }))

type BarberInfo = { name: string; order: number | null } & Partial<Commission>

const loadBarbers = async (
  req: PayloadRequest,
  ids: string[],
  locale: string,
): Promise<Map<string, BarberInfo>> => {
  const map = new Map<string, BarberInfo>()
  if (ids.length === 0) return map
  const { docs } = await req.payload.find({
    collection: 'barbers',
    ...SYSTEM,
    req,
    locale: locale as never,
    where: { id: { in: ids } },
    select: {
      name: true,
      order: true,
      commissionServicesPercent: true,
      commissionExtrasPercent: true,
    },
  })
  for (const doc of docs as unknown as Raw[])
    map.set(String(doc.id), {
      name: typeof doc.name === 'string' ? doc.name : '',
      order: typeof doc.order === 'number' ? doc.order : null,
      servicesPercent: num(doc.commissionServicesPercent),
      extrasPercent: num(doc.commissionExtrasPercent),
    })
  return map
}

/** Barber ids by `order` (empty last), then id. */
const barberOrder = (barbers: Map<string, BarberInfo>): string[] =>
  [...barbers.entries()]
    .sort(
      ([a, x], [b, y]) =>
        (x.order ?? Number.MAX_SAFE_INTEGER) - (y.order ?? Number.MAX_SAFE_INTEGER) ||
        a.localeCompare(b),
    )
    .map(([key]) => key)

const salaryFrom = async (
  req: PayloadRequest,
  operations: readonly ReportOperation[],
  appointments: Map<string, SalaryAppointment>,
  locale: string,
): Promise<{ salary: SalaryReport; barbers: Map<string, BarberInfo> }> => {
  const ops = paymentOps(operations)
  const barbers = await loadBarbers(req, unique(ops.map((op) => op.barber)), locale)
  const commissions = new Map<string, Partial<Commission>>(
    [...barbers.entries()].map(([key, info]) => [
      key,
      { servicesPercent: info.servicesPercent, extrasPercent: info.extrasPercent },
    ]),
  )
  return { salary: calculateSalary(ops, appointments, commissions, barberOrder(barbers)), barbers }
}

// ---------------------------------------------------------------------------
// Salary (§8 «Зарплата»)
// ---------------------------------------------------------------------------

export type SalaryResult = SalaryReport & { names: { barbers: Record<string, string> } }

export const runSalaryReport = async (
  req: PayloadRequest,
  scope: ReportScope,
  locale: string,
): Promise<SalaryResult> => {
  if (scope.locations && scope.locations.length === 0)
    return { ...calculateSalary([], new Map(), new Map()), names: { barbers: {} } }
  const operations = (await loadOperations(req, scope, ['appointment_payment', 'refund'])).filter(
    (op) => !scope.barber || op.barber === scope.barber,
  )
  const appointments = await loadAppointments(req, unique(operations.map((op) => op.appointment)))
  const { salary, barbers } = await salaryFrom(req, operations, appointments, locale)
  return {
    ...salary,
    names: {
      barbers: Object.fromEntries([...barbers.entries()].map(([key, info]) => [key, info.name])),
    },
  }
}

// ---------------------------------------------------------------------------
// Finance (§8 «Дохід», «Витрати», «Залишки кас», «Промокоди та сертифікати»)
// ---------------------------------------------------------------------------

export type FinanceNames = Record<
  'locations' | 'registers' | 'barbers' | 'categories' | 'services' | 'extras' | 'promoCodes',
  Record<string, string>
>

export type FinanceResult = {
  report: FinanceReport
  /** Salaries of the same operations (for the admin's profit only). */
  salaryTotal: number
  names: FinanceNames
}

const namesOf = async (
  req: PayloadRequest,
  collection: 'locations' | 'expense-categories' | 'services' | 'extras',
  ids: string[],
  locale: string,
): Promise<Record<string, string>> => {
  if (ids.length === 0) return {}
  const { docs } = await req.payload.find({
    collection,
    ...SYSTEM,
    req,
    locale: locale as never,
    where: { id: { in: ids } },
    select: { name: true },
  })
  return Object.fromEntries(
    (docs as unknown as Raw[]).map((doc) => [String(doc.id), String(doc.name ?? '')]),
  )
}

const loadRegisters = async (
  req: PayloadRequest,
  scope: ReportScope,
  locale: string,
): Promise<ReportRegister[]> => {
  const { docs } = await req.payload.find({
    collection: 'cash-registers',
    ...SYSTEM,
    req,
    locale: locale as never,
    sort: 'name',
    where: scope.locations ? { location: { in: [...scope.locations] } } : {},
    select: { name: true, type: true, location: true, active: true, balance: true },
  })
  return (docs as unknown as Raw[]).map((doc) => ({
    id: String(doc.id),
    name: String(doc.name ?? ''),
    type: String(doc.type ?? ''),
    location: id(doc.location) ?? '',
    active: doc.active !== false,
    balance: num(doc.balance),
  }))
}

/** Σ entries of each register before `from` (raw aggregation, registers of the scope only). */
const loadOpening = async (
  req: PayloadRequest,
  registers: readonly ReportRegister[],
  from: Date,
): Promise<Map<string, number>> => {
  if (registers.length === 0) return new Map()
  const db = mongo(req).collections
  const { Types } = db['transactions'].base
  const ids = registers.map((register) => new Types.ObjectId(register.id))
  const rows = (await db['transactions']
    .aggregate([
      { $match: { occurredAt: { $lt: from }, 'entries.cashRegister': { $in: ids } } },
      { $unwind: '$entries' },
      { $match: { 'entries.cashRegister': { $in: ids } } },
      { $group: { _id: '$entries.cashRegister', total: { $sum: '$entries.amount' } } },
    ] as never[])
    .session((await sessionOf(req)) ?? null)) as { _id: unknown; total: number }[]
  return new Map(rows.map((row) => [String(row._id), row.total]))
}

const loadReversedOriginals = async (
  req: PayloadRequest,
  operations: readonly ReportOperation[],
): Promise<Map<string, ReversedOriginal>> => {
  const ids = unique(operations.filter((op) => op.type === 'reversal').map((op) => op.reverses))
  const map = new Map<string, ReversedOriginal>()
  if (ids.length === 0) return map
  const { docs } = await req.payload.find({
    collection: 'transactions',
    ...SYSTEM,
    req,
    where: { id: { in: ids } },
    select: { type: true, expenseCategory: true },
  })
  for (const doc of docs as unknown as Raw[])
    map.set(String(doc.id), {
      type: doc.type as TransactionType,
      expenseCategory: id(doc.expenseCategory),
    })
  return map
}

/** Certificates sold in the allowed locations (all of them for an admin). */
const loadCertificates = async (
  req: PayloadRequest,
  scope: ReportScope,
): Promise<ReportCertificate[]> => {
  const { docs } = await req.payload.find({
    collection: 'gift-certificates',
    ...SYSTEM,
    req,
    select: {
      nominal: true,
      balance: true,
      issuedAt: true,
      expiresAt: true,
      voided: true,
      saleTransaction: true,
    },
  })
  let rows = docs as unknown as Raw[]
  if (scope.locations) {
    const sales = unique(rows.map((doc) => id(doc.saleTransaction)))
    const { docs: saleDocs } = sales.length
      ? await req.payload.find({
          collection: 'transactions',
          ...SYSTEM,
          req,
          where: { and: [{ id: { in: sales } }, ...locationWhere(scope)] },
          select: { location: true },
        })
      : { docs: [] }
    const allowedSales = new Set((saleDocs as unknown as Raw[]).map((doc) => String(doc.id)))
    rows = rows.filter((doc) => allowedSales.has(id(doc.saleTransaction) ?? ''))
  }
  return rows.map((doc) => ({
    id: String(doc.id),
    nominal: num(doc.nominal),
    balance: num(doc.balance),
    issuedAt: new Date(doc.issuedAt as string),
    expiresAt: new Date(doc.expiresAt as string),
    voided: doc.voided === true,
  }))
}

/** Appointments of the period that use a promo code (not cancelled, A22), by their start. */
const loadPromoUses = async (req: PayloadRequest, scope: ReportScope): Promise<PromoUse[]> => {
  const { docs } = await req.payload.find({
    collection: 'appointments',
    ...SYSTEM,
    req,
    where: {
      and: [
        { kind: { equals: 'appointment' } },
        { promoCode: { exists: true } },
        { status: { not_in: ['cancelled_by_client', 'cancelled_by_salon'] } },
        ...periodWhere(scope, 'startAt'),
        ...locationWhere(scope),
        ...(scope.barber ? [{ barber: { equals: scope.barber } }] : []),
      ],
    },
    select: { promoCode: true, promoDiscount: true },
  })
  return (docs as unknown as Raw[])
    .map((doc) => ({ promoCode: id(doc.promoCode) ?? '', promoDiscount: num(doc.promoDiscount) }))
    .filter((use) => use.promoCode !== '')
}

export const runFinanceReport = async (
  req: PayloadRequest,
  scope: ReportScope,
  locale: string,
): Promise<FinanceResult> => {
  const now = scope.now ?? new Date()
  const empty = scope.locations !== null && scope.locations.length === 0
  const operations = empty ? [] : await loadOperations(req, scope)
  const registers = empty ? [] : await loadRegisters(req, scope, locale)
  const opening = await loadOpening(req, registers, scope.from)
  const reversedOriginals = await loadReversedOriginals(req, operations)
  const paymentOperations = operations.filter(
    (op) =>
      (op.type === 'appointment_payment' || op.type === 'refund') &&
      (!scope.barber || op.barber === scope.barber),
  )
  const appointments = await loadAppointments(
    req,
    unique(paymentOperations.map((op) => op.appointment)),
  )
  const certificates = empty ? [] : await loadCertificates(req, scope)
  const promoUses = empty ? [] : await loadPromoUses(req, scope)

  const report = buildFinanceReport({
    from: scope.from,
    to: scope.to,
    now,
    barber: scope.barber,
    registers,
    opening,
    operations,
    reversedOriginals,
    appointments,
    certificates,
    promoUses,
  })
  const { salary, barbers } = await salaryFrom(req, paymentOperations, appointments, locale)

  // Names for the UI and the CSV.
  const lineIds = (type: ItemType) =>
    unique(report.revenue.items.filter((row) => row.itemType === type).map((row) => row.item))
  const locationIds = unique([
    ...report.income.byLocation.map((row) => row.id),
    ...registers.map((register) => register.location),
  ])
  const promoIds = report.promo.codes.map((row) => row.promoCode)
  const { docs: promoDocs } = promoIds.length
    ? await req.payload.find({
        collection: 'promo-codes',
        ...SYSTEM,
        req,
        where: { id: { in: promoIds } },
        select: { code: true },
      })
    : { docs: [] }

  return {
    report,
    salaryTotal: salary.totals.total,
    names: {
      locations: await namesOf(req, 'locations', locationIds, locale),
      registers: Object.fromEntries(registers.map((register) => [register.id, register.name])),
      barbers: Object.fromEntries([...barbers.entries()].map(([key, info]) => [key, info.name])),
      categories: await namesOf(
        req,
        'expense-categories',
        unique(report.expenses.byCategory.map((row) => row.id)),
        locale,
      ),
      services: await namesOf(req, 'services', lineIds('service'), locale),
      extras: await namesOf(req, 'extras', lineIds('extra'), locale),
      promoCodes: Object.fromEntries(
        (promoDocs as unknown as Raw[]).map((doc) => [String(doc.id), String(doc.code ?? '')]),
      ),
    },
  }
}
