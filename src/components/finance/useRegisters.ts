'use client'
import { useMemo } from 'react'

import { useLanguage } from '../calendar/api'

import type { Register } from './types'
import { listQuery, useRestList } from './useRestList'

/**
 * Cash registers of a location (`null` — all the user may read) via the standard REST: admin — all,
 * manager — own locations, barber — all without the balance (§3.1). `reload` re-reads them.
 */
export const useRegisters = (location: string | null, reload = 0) => {
  const language = useLanguage()
  const path = `/cash-registers?${listQuery(language, {
    sort: 'name',
    ...(location ? { 'where[location][equals]': location } : {}),
  })}`
  const { docs, failed, loading } = useRestList<Register>(path, reload)
  const registers = useMemo(
    () =>
      (docs ?? []).map((doc) => ({
        ...doc,
        id: String(doc.id),
        location: String((doc.location as unknown) ?? ''),
      })),
    [docs],
  )
  return { registers, failed, loading }
}
