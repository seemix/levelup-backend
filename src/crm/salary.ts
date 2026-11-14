/**
 * Salary and revenue allocation (spec §8 «Зарплата», decisions 10, 31, A13, A38): pure functions, no
 * database. Amounts are integer bani.
 *
 * - The net of each line = line price × `total / subtotal`: discounts (promo code + manual) are spread
 *   proportionally over the lines (A13). Rounding uses the largest remainder, so Σ net = `total` exactly.
 * - The base is the payments of the period by their date (A13): each `appointment_payment` brings the
 *   part paid to the appointment (money + certificate, §5.8), spread over the net lines the same way. A partial payment / prepayment therefore pays the barber its share.
 * - A `refund` is subtracted in the period it is made (§8), mirroring the payment it undoes.
 * - Tips are not recorded at all (A45); the certificate part counts like money.
 * - Commission: `servicesPercent` of the services base + `extrasPercent` of the extras base, rounded
 *   half up once per barber (`percentOf`).
 * - Fixed monthly salary (optional, A45): prorated by calendar days of each month in the period.
 */
import { percentOf, sumBani } from './money'
import { eachLocalDate } from './time'

export type ItemType = 'service' | 'extra'

export type SalaryLine = { itemType: ItemType; item: string | null; price: number }

/** Snapshot of the appointment a payment belongs to. */
export type SalaryAppointment = {
  lines: readonly SalaryLine[]
  subtotal: number
  total: number
}

/** One ledger operation of the period that concerns a barber. */
export type SalaryOperation = {
  id: string
  type: 'appointment_payment' | 'refund'
  occurredAt: Date
  barber: string | null
  appointment: string | null
  /** Σ entries with the sign of the ledger (negative for a refund). */
  cash: number
  /** Unsigned, as stored in the operation (a refund copies it from the payment). */
  certificateAmount: number
}

export type LineShare = { itemType: ItemType; item: string | null; amount: number }

export type OperationBreakdown = {
  /** Paid to the appointment (signed): money + certificate. */
  applied: number
  /** Signed certificate part. */
  certificate: number
  /** `applied` spread over the lines. */
  lines: LineShare[]
  servicesBase: number
  extrasBase: number
}

/**
 * Splits an integer amount proportionally to non-negative integer weights with the largest remainder
 * (ties to the earlier weight): the parts add up to `amount` exactly. Zero weights get nothing unless
 * every weight is zero — then the first part takes everything.
 */
export const allocate = (amount: number, weights: readonly number[]): number[] => {
  if (weights.length === 0) return []
  const sign = amount < 0 ? -1 : 1
  const abs = Math.abs(amount)
  const total = sumBani(weights)
  if (total <= 0) return weights.map((_, index) => (index === 0 ? amount : 0))
  const parts = weights.map((weight) => Math.floor((abs * weight) / total))
  let rest = abs - sumBani(parts)
  const order = weights
    .map((weight, index) => ({ index, remainder: (abs * weight) % total }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index)
  for (const { index } of order) {
    if (rest <= 0) break
    parts[index]! += 1
    rest -= 1
  }
  return parts.map((part) => sign * part + 0)
}

/** Net of each line after the appointment's discounts (A13): Σ = `total`. */
export const netLines = (appointment: SalaryAppointment): LineShare[] => {
  const lines = appointment.lines
  if (lines.length === 0) return []
  // `allocate` spreads `total` proportionally to the prices, i.e. price × total / subtotal.
  const amounts = allocate(
    appointment.total,
    lines.map((line) => Math.max(0, line.price)),
  )
  return lines.map((line, index) => ({
    itemType: line.itemType,
    item: line.item,
    amount: amounts[index]!,
  }))
}

const sign = (type: SalaryOperation['type']) => (type === 'refund' ? -1 : 1)

/**
 * What one payment / refund brings: the applied part spread over the net lines. Without the appointment
 * (deleted by an admin) or its lines the whole applied part counts as services.
 */
export const breakdownOperation = (
  operation: SalaryOperation,
  appointment: SalaryAppointment | null | undefined,
): OperationBreakdown => {
  const s = sign(operation.type)
  const certificate = s * operation.certificateAmount
  // Payment: Σentries + certificate; refund: mirror entries (negative) − certificate.
  const applied = operation.cash + certificate
  const net = appointment ? netLines(appointment) : []
  const shares = net.length
    ? allocate(
        applied,
        net.map((line) => Math.max(0, line.amount)),
      )
    : []
  const lines: LineShare[] = net.length
    ? net.map((line, index) => ({
        itemType: line.itemType,
        item: line.item,
        amount: shares[index]!,
      }))
    : [{ itemType: 'service', item: null, amount: applied }]
  const base = (type: ItemType) =>
    sumBani(lines.filter((line) => line.itemType === type).map((line) => line.amount))
  return {
    applied,
    certificate,
    lines,
    servicesBase: base('service'),
    extrasBase: base('extra'),
  }
}

export type Commission = { servicesPercent: number; extrasPercent: number }

export type SalaryItem = {
  id: string
  type: SalaryOperation['type']
  occurredAt: Date
  appointment: string | null
  servicesBase: number
  extrasBase: number
}

export type SalaryRow = {
  barber: string
  payments: number
  refunds: number
  servicesBase: number
  extrasBase: number
  servicesPercent: number
  extrasPercent: number
  servicesCommission: number
  extrasCommission: number
  /** Fixed monthly salary prorated to the period (0 without one). */
  fixedSalary: number
  /** Commissions + fixed salary. */
  total: number
}

export type SalaryTotals = Omit<SalaryRow, 'barber' | 'servicesPercent' | 'extrasPercent'>

export type SalaryReport = { rows: SalaryRow[]; totals: SalaryTotals; items: SalaryItem[] }

const clampPercent = (value: number | null | undefined): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0

/** Days in the month of a local date `YYYY-MM-DD`. */
const daysInMonth = (date: string): number => {
  const [y, m] = date.split('-').map(Number)
  return new Date(Date.UTC(y!, m!, 0)).getUTCDate()
}

/**
 * Fixed monthly salary for the local days `[from, to]` (inclusive, A45): for each month touched,
 * `monthly × days of the period in the month / days in the month`, rounded half up per month.
 * A whole month gives exactly `monthly`.
 */
export const fixedSalaryForPeriod = (monthly: number, from: string, to: string): number => {
  if (!Number.isFinite(monthly) || monthly <= 0 || from > to) return 0
  const byMonth = new Map<string, number>()
  for (const date of eachLocalDate(from, to))
    byMonth.set(date.slice(0, 7), (byMonth.get(date.slice(0, 7)) ?? 0) + 1)
  let total = 0
  for (const [month, days] of byMonth) {
    const length = daysInMonth(`${month}-01`)
    total += Math.floor((2 * monthly * days + length) / (2 * length))
  }
  return total
}

/**
 * Salary of each barber over the operations of the period (§8, A13, A45). Operations without a barber
 * are skipped. `fixed` — the fixed salary of the period per barber: a barber with one gets a row even
 * without operations. `items` lists every operation (for the detail view), oldest first. Rows are
 * sorted by `order` of the barber ids given in `barberOrder` (unknown ones last, by id).
 */
export const calculateSalary = (
  operations: readonly SalaryOperation[],
  appointments: ReadonlyMap<string, SalaryAppointment>,
  commissions: ReadonlyMap<string, Partial<Commission>>,
  barberOrder: readonly string[] = [],
  fixed: ReadonlyMap<string, number> = new Map(),
): SalaryReport => {
  type Acc = Pick<SalaryRow, 'payments' | 'refunds' | 'servicesBase' | 'extrasBase'>
  const empty = (): Acc => ({ payments: 0, refunds: 0, servicesBase: 0, extrasBase: 0 })
  const byBarber = new Map<string, Acc>()
  const items: SalaryItem[] = []
  const sorted = [...operations].sort(
    (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || a.id.localeCompare(b.id),
  )
  for (const operation of sorted) {
    if (!operation.barber) continue
    const parts = breakdownOperation(
      operation,
      operation.appointment ? appointments.get(operation.appointment) : null,
    )
    const acc = byBarber.get(operation.barber) ?? empty()
    if (operation.type === 'refund') acc.refunds += 1
    else acc.payments += 1
    acc.servicesBase += parts.servicesBase
    acc.extrasBase += parts.extrasBase
    byBarber.set(operation.barber, acc)
    items.push({
      id: operation.id,
      type: operation.type,
      occurredAt: operation.occurredAt,
      appointment: operation.appointment,
      servicesBase: parts.servicesBase,
      extrasBase: parts.extrasBase,
    })
  }

  const rank = (id: string) => {
    const index = barberOrder.indexOf(id)
    return index === -1 ? Number.MAX_SAFE_INTEGER : index
  }
  for (const [barber, amount] of fixed)
    if (amount > 0 && !byBarber.has(barber)) byBarber.set(barber, empty())
  const rows: SalaryRow[] = [...byBarber.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([barber, acc]) => {
      const commission = commissions.get(barber) ?? {}
      const servicesPercent = clampPercent(commission.servicesPercent)
      const extrasPercent = clampPercent(commission.extrasPercent)
      const servicesCommission = percentOf(acc.servicesBase, servicesPercent)
      const extrasCommission = percentOf(acc.extrasBase, extrasPercent)
      const fixedSalary = Math.max(0, fixed.get(barber) ?? 0)
      return {
        barber,
        ...acc,
        servicesPercent,
        extrasPercent,
        servicesCommission,
        extrasCommission,
        fixedSalary,
        total: servicesCommission + extrasCommission + fixedSalary,
      }
    })

  const totals: SalaryTotals = {
    payments: 0,
    refunds: 0,
    servicesBase: 0,
    extrasBase: 0,
    servicesCommission: 0,
    extrasCommission: 0,
    fixedSalary: 0,
    total: 0,
  }
  for (const row of rows)
    for (const key of Object.keys(totals) as (keyof SalaryTotals)[]) totals[key] += row[key]
  return { rows, totals, items }
}
