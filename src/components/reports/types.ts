import type { ClientReportRow, ClientStats } from '@/crm/client-report'
import type { FinanceReport } from '@/crm/finance-report'
import type { SalaryItem, SalaryRow, SalaryTotals } from '@/crm/salary'

export type ReportResponse = { rows: ClientReportRow[]; total: number; page: number; limit: number }

export type CardVisit = {
  id: string
  start: string
  status: string
  barber: string
  service: string
  location: string
  total: number
  paidAmount: number
}

export type CardResponse = {
  client: {
    id: string
    firstName: string
    lastName: string | null
    phone: string
    blocked: boolean
  }
  stats: ClientStats
  visits: CardVisit[]
  page: number
  hasNext: boolean
}

export type FinanceNames = Record<
  'locations' | 'registers' | 'barbers' | 'categories' | 'services' | 'extras' | 'promoCodes',
  Record<string, string>
>

export type FinanceResponse = FinanceReport & {
  from: string
  to: string
  /** Admin only (decision 35). */
  profit: { income: number; expenses: number; salary: number; profit: number } | null
  names: FinanceNames
}

export type SalaryResponse = {
  from: string
  to: string
  barber: string | null
  rows: SalaryRow[]
  totals: SalaryTotals
  items: (Omit<SalaryItem, 'occurredAt'> & { occurredAt: string })[]
  names: { barbers: Record<string, string> }
}
