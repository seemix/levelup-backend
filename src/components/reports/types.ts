import type { ClientReportRow, ClientStats } from '@/crm/client-report'

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
