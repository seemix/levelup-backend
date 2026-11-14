/**
 * Salary and revenue allocation (spec §8 «Зарплата», decisions 10, 31, A13, A38): pure functions, no
 * database. Amounts are integer bani.
 *
 * - The net of each line = line price × `total / subtotal`: discounts (promo code + manual) are spread
 *   proportionally over the lines (A13). Rounding uses the largest remainder, so Σ net = `total` exactly.
 * - The base is the payments of the period by their date (A13): each `appointment_payment` brings the
 *   part paid to the appointment (money + certificate − tips, §5.8), spread over the net lines the
 *   same way. A partial payment / prepayment therefore pays the barber its share.
 * - A `refund` is subtracted in the period it is made (§8), mirroring the payment it undoes.
 * - Tips go 100% to the barber (decision 10, 31), the certificate part counts like money.
 * - Commission: `servicesPercent` of the services base + `extrasPercent` of the extras base, rounded
 *   half up once per barber (`percentOf`).
 */
import { percentOf, sumBani } from './money'

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
  tipAmount: number
}

export type LineShare = { itemType: ItemType; item: string | null; amount: number }

export type OperationBreakdown = {
  /** Paid to the appointment (signed): money + certificate − tips. */
  applied: number
  /** Signed tips. */
  tips: number
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
  const tips = s * operation.tipAmount
  const certificate = s * operation.certificateAmount
  // Payment: Σentries + certificate − tips; refund: mirror entries (negative) − certificate + tips.
  const applied = operation.cash + certificate - tips
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
    tips,
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
  tips: number
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
  tips: number
  /** Commissions + tips. */
  total: number
}

export type SalaryTotals = Omit<SalaryRow, 'barber' | 'servicesPercent' | 'extrasPercent'>

export type SalaryReport = { rows: SalaryRow[]; totals: SalaryTotals; items: SalaryItem[] }

const clampPercent = (value: number | null | undefined): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0

/**
 * Salary of each barber over the operations of the period (§8, A13). Operations without a barber are
 * skipped. `items` lists every operation (for the detail view), oldest first. Rows are sorted by
 * `order` of the barber ids given in `barberOrder` (unknown ones last, by id).
 */
export const calculateSalary = (
  operations: readonly SalaryOperation[],
  appointments: ReadonlyMap<string, SalaryAppointment>,
  commissions: ReadonlyMap<string, Partial<Commission>>,
  barberOrder: readonly string[] = [],
): SalaryReport => {
  type Acc = Pick<SalaryRow, 'payments' | 'refunds' | 'servicesBase' | 'extrasBase' | 'tips'>
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
    const acc = byBarber.get(operation.barber) ?? {
      payments: 0,
      refunds: 0,
      servicesBase: 0,
      extrasBase: 0,
      tips: 0,
    }
    if (operation.type === 'refund') acc.refunds += 1
    else acc.payments += 1
    acc.servicesBase += parts.servicesBase
    acc.extrasBase += parts.extrasBase
    acc.tips += parts.tips
    byBarber.set(operation.barber, acc)
    items.push({
      id: operation.id,
      type: operation.type,
      occurredAt: operation.occurredAt,
      appointment: operation.appointment,
      servicesBase: parts.servicesBase,
      extrasBase: parts.extrasBase,
      tips: parts.tips,
    })
  }

  const rank = (id: string) => {
    const index = barberOrder.indexOf(id)
    return index === -1 ? Number.MAX_SAFE_INTEGER : index
  }
  const rows: SalaryRow[] = [...byBarber.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([barber, acc]) => {
      const commission = commissions.get(barber) ?? {}
      const servicesPercent = clampPercent(commission.servicesPercent)
      const extrasPercent = clampPercent(commission.extrasPercent)
      const servicesCommission = percentOf(acc.servicesBase, servicesPercent)
      const extrasCommission = percentOf(acc.extrasBase, extrasPercent)
      return {
        barber,
        ...acc,
        servicesPercent,
        extrasPercent,
        servicesCommission,
        extrasCommission,
        total: servicesCommission + extrasCommission + acc.tips,
      }
    })

  const totals: SalaryTotals = {
    payments: 0,
    refunds: 0,
    servicesBase: 0,
    extrasBase: 0,
    servicesCommission: 0,
    extrasCommission: 0,
    tips: 0,
    total: 0,
  }
  for (const row of rows)
    for (const key of Object.keys(totals) as (keyof SalaryTotals)[]) totals[key] += row[key]
  return { rows, totals, items }
}
