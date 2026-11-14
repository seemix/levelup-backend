'use client'
import { useEffect, useState } from 'react'

import { useCrmApi } from '../calendar/api'

import type { ListResponse } from './types'

/**
 * Documents of a standard Payload REST list (`/cash-registers?…`, read with the user's rights).
 * `path = null` — nothing to load. `reload` re-reads the same path. The result is stored with the key
 * of its request, so "loading" is simply "the stored key differs".
 */
export const useRestList = <T>(path: string | null, reload = 0) => {
  const api = useCrmApi()
  const key = `${path}|${reload}`
  const [state, setState] = useState<{ key: string; docs: T[] | null } | null>(null)

  useEffect(() => {
    if (!path) return
    const controller = new AbortController()
    api<ListResponse<T>>(path, { signal: controller.signal })
      .then((response) => setState({ key, docs: response.docs }))
      .catch((error: unknown) => {
        if ((error as { name?: string }).name !== 'AbortError') setState({ key, docs: null })
      })
    return () => controller.abort()
  }, [api, path, key])

  const current = state?.key === key ? state : null
  return {
    docs: current?.docs ?? null,
    failed: path !== null && current !== null && current.docs === null,
    loading: path !== null && current === null,
  }
}

/** Query string of a list read: ids only (`depth=0`), all rows, in the admin language. */
export const listQuery = (language: string, extra: Record<string, string> = {}) =>
  new URLSearchParams({ depth: '0', limit: '0', locale: language, ...extra }).toString()
