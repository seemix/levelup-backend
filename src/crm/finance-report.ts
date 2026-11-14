/**
 * Finance report (spec §8 «Дохід», «Витрати», «Залишки кас», «Промокоди та сертифікати», A38): pure
 * functions over the ledger operations of the period, no database. The loading and the role rules
 * live in `finance-report.service.ts`. Amounts are integer bani.
 *
 * Every number is a sum of ledger entries, so the report reconciles with `transactions`:
 * opening + inflow − outflow = closing for each register, and the income / expense sections are the
 * entries of their operation types. Refunds and reversals count in the period they are made.
 */
import type { TransactionType } from './ledger'
import { sumBani } from './money'
import {
  breakdownOperation,
  type ItemType,
  type SalaryAppointment,
  type SalaryOperation,
} from './salary'

export type ReportEntry = { cashRegister: string; amount: number }

/** One ledger operation of the period (ids as strings). */
export type ReportOperation = {
  id: string
  type: TransactionType
  occurredAt: Date
  location: string
  entries: readonly ReportEntry[]
  barber: string | null
  appointment: string | null
  certificate: string | null
  certificateAmount: number
  expenseCategory: string | null
  reverses: string | null
}

export type ReportRegister = {
  id: string
  name: string
  type: string
  location: string
  active: boolean
  /** Stored balance now (ledger hook). */
  balance: number
}

/** The original of a reversal (to attribute a reversed expense to its category). */
export type ReversedOriginal = { type: TransactionType; expenseCategory: string | null }

export type ReportCertificate = {
  id: string
  nominal: number
  balance: number
  issuedAt: Date
  expiresAt: Date
  voided: boolean
}

export type PromoUse = { promoCode: string; promoDiscount: number }

export type FinanceInput = {
  /** Half-open period `[from, to)`. */
  from: Date
  to: Date
  now: Date
  /** When set, the payment-based sections (income from payments, barbers, services, promo codes) only. */
  barber: string | null
  registers: readonly ReportRegister[]
  /** Σ entries of each register before `from`. */
  opening: ReadonlyMap<string, number>
  operations: readonly ReportOperation[]
  reversedOriginals: ReadonlyMap<string, ReversedOriginal>
  appointments: ReadonlyMap<string, SalaryAppointment>
  /** Certificates of the scope (sold in the allowed locations). */
  certificates: readonly ReportCertificate[]
  promoUses: readonly PromoUse[]
}

export type IncomeTotals = {
  /** Money of appointment payments. */
  payments: number
  /** Money returned by refunds (≤ 0). */
  refunds: number
  certificateSales: number
  net: number
}

export type IncomeRow = IncomeTotals & { id: string }

export type BarberIncomeRow = {
  barber: string
  payments: number
  refunds: number
  /** Money in the registers: payments + refunds. */
  net: number
  /** Paid with certificates (net of refunds). */
  certificate: number
  /** Paid to appointments: money + certificate. */
  revenue: number
}

export type RevenueRow = {
  itemType: ItemType
  item: string | null
  /** Appointments with this item among the payments of the period. */
  appointments: number
  amount: number
}

export type ExpenseRow = { id: string | null; amount: number; count: number }

export type RegisterMovement = {
  register: string
  location: string
  opening: number
  inflow: number
  /** Positive number: money that left the register. */
  outflow: number
  closing: number
  balance: number
}

export type PromoRow = { promoCode: string; uses: number; discount: number }

export type FinanceReport = {
  income: {
    totals: IncomeTotals
    byLocation: IncomeRow[]
    byRegister: IncomeRow[]
    byBarber: BarberIncomeRow[]
  }
  revenue: { total: number; certificate: number; items: RevenueRow[] }
  expenses: { total: number; byCategory: ExpenseRow[]; byRegister: ExpenseRow[] }
  registers: { rows: RegisterMovement[]; totals: Omit<RegisterMovement, 'register' | 'location'> }
  promo: { uses: number; discount: number; codes: PromoRow[] }
  certificates: {
    sold: { count: number; amount: number }
    /** Paid with certificates in the period (refunds subtracted). */
    redeemed: number
    /** Valid now: not void, not expired, balance > 0. */
    outstanding: { count: number; amount: number }
    /** Expired within the period with an unused balance. */
    expired: { count: number; amount: number }
  }
}

const INCOME_TYPES: readonly TransactionType[] = [
  'appointment_payment',
  'refund',
  'certificate_sale',
]

const emptyIncome = (): IncomeTotals => ({
  payments: 0,
  refunds: 0,
  certificateSales: 0,
  net: 0,
})

const addIncome = (acc: IncomeTotals, operation: ReportOperation, amount: number) => {
  if (operation.type === 'appointment_payment') acc.payments += amount
  else if (operation.type === 'refund') acc.refunds += amount
  else if (operation.type === 'certificate_sale') acc.certificateSales += amount
  acc.net += amount
}

const toSalaryOperation = (operation: ReportOperation): SalaryOperation => ({
  id: operation.id,
  type: operation.type === 'refund' ? 'refund' : 'appointment_payment',
  occurredAt: operation.occurredAt,
  barber: operation.barber,
  appointment: operation.appointment,
  cash: sumBani(operation.entries.map((entry) => entry.amount)),
  certificateAmount: operation.certificateAmount,
})

const isPaymentType = (type: TransactionType) => type === 'appointment_payment' || type === 'refund'

/** Is this operation an expense (or the reversal of one) for the expense section? */
const expenseCategoryOf = (
  operation: ReportOperation,
  originals: ReadonlyMap<string, ReversedOriginal>,
): { expense: boolean; category: string | null } => {
  if (operation.type === 'expense') return { expense: true, category: operation.expenseCategory }
  if (operation.type === 'reversal' && operation.reverses) {
    const original = originals.get(operation.reverses)
    if (original?.type === 'expense') return { expense: true, category: original.expenseCategory }
  }
  return { expense: false, category: null }
}

const sortRows = <T extends { amount: number }>(rows: T[], key: (row: T) => string): T[] =>
  rows.sort((a, b) => b.amount - a.amount || key(a).localeCompare(key(b)))

export const buildFinanceReport = (input: FinanceInput): FinanceReport => {
  const inPeriod = input.operations.filter(
    (operation) => operation.occurredAt >= input.from && operation.occurredAt < input.to,
  )
  // The barber filter cuts the payment-based sections only (A38).
  const matchesBarber = (operation: ReportOperation) =>
    !input.barber || !isPaymentType(operation.type) || operation.barber === input.barber
  const incomeOps = inPeriod.filter(
    (operation) => INCOME_TYPES.includes(operation.type) && matchesBarber(operation),
  )

  // --- Income ---------------------------------------------------------------
  const totals = emptyIncome()
  const byLocation = new Map<string, IncomeTotals>()
  const byRegister = new Map<string, IncomeTotals>()
  const byBarber = new Map<string, BarberIncomeRow>()
  const revenueByItem = new Map<string, RevenueRow & { seen: Set<string> }>()
  let revenueTotal = 0
  let revenueCertificate = 0

  for (const operation of incomeOps) {
    const cash = sumBani(operation.entries.map((entry) => entry.amount))
    addIncome(totals, operation, cash)
    const location = byLocation.get(operation.location) ?? emptyIncome()
    addIncome(location, operation, cash)
    byLocation.set(operation.location, location)
    for (const entry of operation.entries) {
      const register = byRegister.get(entry.cashRegister) ?? emptyIncome()
      addIncome(register, operation, entry.amount)
      byRegister.set(entry.cashRegister, register)
    }
    if (!isPaymentType(operation.type)) continue

    const parts = breakdownOperation(
      toSalaryOperation(operation),
      operation.appointment ? input.appointments.get(operation.appointment) : null,
    )
    revenueTotal += parts.applied
    revenueCertificate += parts.certificate

    if (operation.barber) {
      const row = byBarber.get(operation.barber) ?? {
        barber: operation.barber,
        payments: 0,
        refunds: 0,
        net: 0,
        certificate: 0,
        revenue: 0,
      }
      if (operation.type === 'refund') row.refunds += cash
      else row.payments += cash
      row.net += cash
      row.certificate += parts.certificate
      row.revenue += parts.applied
      byBarber.set(operation.barber, row)
    }

    for (const line of parts.lines) {
      const key = `${line.itemType}:${line.item ?? ''}`
      const row = revenueByItem.get(key) ?? {
        itemType: line.itemType,
        item: line.item,
        appointments: 0,
        amount: 0,
        seen: new Set<string>(),
      }
      row.amount += line.amount
      // Count each appointment once per item, and only through its payments (not refunds).
      if (operation.type === 'appointment_payment' && operation.appointment) {
        if (!row.seen.has(operation.appointment)) {
          row.seen.add(operation.appointment)
          row.appointments += 1
        }
      }
      revenueByItem.set(key, row)
    }
  }

  const incomeRows = (map: Map<string, IncomeTotals>): IncomeRow[] =>
    [...map.entries()]
      .map(([id, values]) => ({ id, ...values }))
      .sort((a, b) => b.net - a.net || a.id.localeCompare(b.id))

  // --- Expenses -------------------------------------------------------------
  const byCategory = new Map<string, ExpenseRow>()
  const expenseRegisters = new Map<string, ExpenseRow>()
  let expensesTotal = 0
  for (const operation of inPeriod) {
    const { expense, category } = expenseCategoryOf(operation, input.reversedOriginals)
    if (!expense) continue
    // Expense entries are negative; a reversal of an expense gives the money back.
    const amount = -sumBani(operation.entries.map((entry) => entry.amount))
    // A reversal reduces the amount; the count is the number of expense operations.
    const counted = operation.type === 'expense' ? 1 : 0
    expensesTotal += amount
    const key = category ?? ''
    const row = byCategory.get(key) ?? { id: category, amount: 0, count: 0 }
    row.amount += amount
    row.count += counted
    byCategory.set(key, row)
    for (const entry of operation.entries) {
      const register = expenseRegisters.get(entry.cashRegister) ?? {
        id: entry.cashRegister,
        amount: 0,
        count: 0,
      }
      register.amount += -entry.amount
      register.count += counted
      expenseRegisters.set(entry.cashRegister, register)
    }
  }

  // --- Registers: movement over the period ---------------------------------
  const flows = new Map<string, { inflow: number; outflow: number }>()
  for (const operation of inPeriod)
    for (const entry of operation.entries) {
      const flow = flows.get(entry.cashRegister) ?? { inflow: 0, outflow: 0 }
      if (entry.amount > 0) flow.inflow += entry.amount
      else flow.outflow += -entry.amount
      flows.set(entry.cashRegister, flow)
    }
  const registerRows: RegisterMovement[] = input.registers.map((register) => {
    const opening = input.opening.get(register.id) ?? 0
    const flow = flows.get(register.id) ?? { inflow: 0, outflow: 0 }
    return {
      register: register.id,
      location: register.location,
      opening,
      inflow: flow.inflow,
      outflow: flow.outflow,
      closing: opening + flow.inflow - flow.outflow,
      balance: register.balance,
    }
  })
  const registerTotals = { opening: 0, inflow: 0, outflow: 0, closing: 0, balance: 0 }
  for (const row of registerRows)
    for (const key of Object.keys(registerTotals) as (keyof typeof registerTotals)[])
      registerTotals[key] += row[key]

  // --- Promo codes ----------------------------------------------------------
  const promoByCode = new Map<string, PromoRow>()
  for (const use of input.promoUses) {
    const row = promoByCode.get(use.promoCode) ?? { promoCode: use.promoCode, uses: 0, discount: 0 }
    row.uses += 1
    row.discount += use.promoDiscount
    promoByCode.set(use.promoCode, row)
  }
  const promoCodes = [...promoByCode.values()].sort(
    (a, b) => b.uses - a.uses || b.discount - a.discount || a.promoCode.localeCompare(b.promoCode),
  )

  // --- Certificates ---------------------------------------------------------
  const sales = inPeriod.filter((operation) => operation.type === 'certificate_sale')
  const valid = input.certificates.filter(
    (certificate) =>
      !certificate.voided && certificate.expiresAt > input.now && certificate.balance > 0,
  )
  const expired = input.certificates.filter(
    (certificate) =>
      !certificate.voided &&
      certificate.balance > 0 &&
      certificate.expiresAt >= input.from &&
      certificate.expiresAt < input.to &&
      certificate.expiresAt <= input.now,
  )

  return {
    income: {
      totals,
      byLocation: incomeRows(byLocation),
      byRegister: incomeRows(byRegister),
      byBarber: [...byBarber.values()].sort(
        (a, b) => b.revenue - a.revenue || a.barber.localeCompare(b.barber),
      ),
    },
    revenue: {
      total: revenueTotal,
      certificate: revenueCertificate,
      items: sortRows(
        [...revenueByItem.values()].map(({ seen: _seen, ...row }) => row),
        (row) => `${row.itemType}:${row.item ?? ''}`,
      ),
    },
    expenses: {
      total: expensesTotal,
      byCategory: sortRows([...byCategory.values()], (row) => row.id ?? ''),
      byRegister: sortRows([...expenseRegisters.values()], (row) => row.id ?? ''),
    },
    registers: { rows: registerRows, totals: registerTotals },
    promo: {
      uses: sumBani(promoCodes.map((row) => row.uses)),
      discount: sumBani(promoCodes.map((row) => row.discount)),
      codes: promoCodes,
    },
    certificates: {
      sold: {
        count: sales.length,
        amount: sumBani(sales.flatMap((sale) => sale.entries.map((entry) => entry.amount))),
      },
      redeemed: revenueCertificate,
      outstanding: {
        count: valid.length,
        amount: sumBani(valid.map((certificate) => certificate.balance)),
      },
      expired: {
        count: expired.length,
        amount: sumBani(expired.map((certificate) => certificate.balance)),
      },
    },
  }
}

/** Cash-basis profit (admin only, decision 35): net income − expenses − salaries (fixed included). */
export const cashProfit = (
  report: Pick<FinanceReport, 'income' | 'expenses'>,
  salaryTotal: number,
) => ({
  income: report.income.totals.net,
  expenses: report.expenses.total,
  salary: salaryTotal,
  profit: report.income.totals.net - report.expenses.total - salaryTotal,
})
