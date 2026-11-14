'use client'
import { useConfig, useTranslation } from '@payloadcms/ui'
import { useCallback } from 'react'

import { errorKeyFor } from '@/crm/error-keys'
import type { CrmWarning } from '@/endpoints/crm/http'
import type { AppointmentView } from '@/endpoints/crm/view'

import { useCrmT } from './useCrmT'

/** An error of the CRM API: machine `code` (translated by the UI), HTTP status and `details`. */
export class CrmApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly details: Record<string, unknown> = {},
  ) {
    super(code)
    this.name = 'CrmApiError'
  }

  /** `409 CONFIRMATION_REQUIRED`: warnings the user must confirm (spec A29). */
  get confirmation(): {
    warnings: CrmWarning[]
    total: { from: number; to: number } | null
  } | null {
    if (this.code !== 'CONFIRMATION_REQUIRED') return null
    const warnings = Array.isArray(this.details.warnings)
      ? (this.details.warnings as CrmWarning[])
      : []
    const total = this.details.total as { from: number; to: number } | undefined
    return { warnings, total: total ?? null }
  }

  get fields(): string[] {
    return Array.isArray(this.details.fields) ? (this.details.fields as string[]) : []
  }
}

type RequestInitLite = { method?: string; body?: unknown; signal?: AbortSignal }

/** Calls `/api/crm/*` (or a standard collection route) with the session cookie; failures become `CrmApiError`. */
export const crmRequest = async <T>(
  apiRoute: string,
  path: string,
  init: RequestInitLite = {},
): Promise<T> => {
  let response: Response
  try {
    response = await fetch(`${apiRoute}${path}`, {
      method: init.method ?? 'GET',
      credentials: 'include',
      signal: init.signal,
      headers: init.body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    })
  } catch (error) {
    if ((error as { name?: string }).name === 'AbortError') throw error
    throw new CrmApiError('NETWORK_ERROR', 0)
  }
  const payload = (await response.json().catch(() => null)) as {
    error?: { code?: string; details?: Record<string, unknown> }
    // Standard Payload REST (collections): business rules carry the machine code in `data.code`.
    errors?: { data?: { code?: string } }[]
  } | null
  if (!response.ok)
    throw new CrmApiError(
      payload?.error?.code ??
        payload?.errors?.[0]?.data?.code ??
        (response.status >= 500 ? 'INTERNAL_ERROR' : 'UNKNOWN'),
      response.status,
      payload?.error?.details,
    )
  return payload as T
}

/** `request('/crm/…')` bound to the admin API route. */
export const useCrmApi = () => {
  const { config } = useConfig()
  const api = config.routes.api
  return useCallback(
    <T>(path: string, init?: RequestInitLite) => crmRequest<T>(api, path, init),
    [api],
  )
}

/** Translated text of any error thrown by the API layer (codes → `crm:errors.*`). */
export const useErrorText = () => {
  const t = useCrmT()
  return (error: unknown): string => {
    if (error instanceof CrmApiError) {
      if (error.code === 'VALIDATION_ERROR')
        return t('errors.validationError', { fields: error.fields.join(', ') })
      return t(errorKeyFor(error.code))
    }
    return t('errors.unknown')
  }
}

export const useLanguage = () => useTranslation().i18n.language

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

export type AppointmentDetail = {
  appointment: AppointmentView
  lines: {
    itemType: 'service' | 'extra'
    item: string
    name: string
    price: number
    durationMinutes: number
  }[]
  promoCode: string | null
  history: {
    id: string
    at: string
    action: string
    actorType: 'user' | 'client' | 'system'
    actor: string | null
    changes: { field: string; from: unknown; to: unknown }[]
  }[]
  can: { restore: boolean; discount: boolean; paid: boolean; update: boolean }
}

export type PricePreview = {
  lines: { itemType: 'service' | 'extra'; item: string; price: number; durationMinutes: number }[]
  durationMinutes: number
  subtotal: number
  promoDiscount: number
  manualDiscount: number
  total: number
}

export type ClientLookup = {
  client: {
    id: string
    firstName: string
    lastName: string | null
    phone: string
    blocked: boolean
  } | null
}

export type CatalogService = { id: string; name: string; price: number; durationMinutes: number }
export type CatalogExtra = CatalogService & { appliesTo: string[] }
