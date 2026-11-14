import type { LedgerEntry } from '@/crm/ledger'

/** Cash register as the standard REST returns it (`depth=0`; the balance only for admin/manager). */
export type Register = {
  id: string
  name: string
  type: 'cash' | 'account'
  location: string
  active: boolean
  balance?: number
}

export type LocationOption = { id: string; name: string }

export type ExpenseCategory = { id: string; name: string; active?: boolean }

/** `transactions` document (`depth=0`). */
export type Operation = {
  id: string
  type: string
  occurredAt: string
  location: string
  entries: (LedgerEntry & { id?: string })[]
  comment?: string | null
  expenseCategory?: string | null
  appointment?: string | null
  certificate?: string | null
  certificateAmount?: number | null
  tipAmount?: number | null
  reverses?: string | null
  reversed?: boolean | null
}

/** `gift-certificates` document as the staff reads it. */
export type CertificateDoc = {
  id: string
  code: string
  nominal: number
  balance: number
  expiresAt: string
  status: 'active' | 'depleted' | 'expired' | 'void'
}

export type ListResponse<T> = {
  docs: T[]
  totalDocs: number
  hasNextPage: boolean
  page: number
}
