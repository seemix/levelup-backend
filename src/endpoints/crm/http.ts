/**
 * Shared plumbing of the CRM API `/api/crm/*` (spec §6.2): the same error format as the public API
 * (`{ error: { code, details? } }`), staff authentication, the confirmation flow for warnings.
 */
import { APIError, type Endpoint, type PayloadHandler, type PayloadRequest } from 'payload'

import { getStaffContext, type StaffContext } from '@/access/policy'

import { errorResponse } from '../booking/http'

export type CrmErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'LOCATION_NOT_FOUND'
  | 'BARBER_NOT_FOUND'
  | 'PHONE_INVALID'
  | 'CONFIRMATION_REQUIRED'

/** A CRM API error; `message` is the code itself — texts are translated by the client. */
export const crmError = (
  code: CrmErrorCode,
  status: number,
  details?: Record<string, unknown>,
): APIError => new APIError(code, status, { code, ...(details ? { details } : {}) }, true)

/**
 * Warnings the client must confirm by repeating the request with `confirm: true` (decision 20, §5.10):
 * - `OUTSIDE_SCHEDULE` — the time is outside the barber's working hours;
 * - `PRICE_CHANGED` — a move (barber change) recalculated `total`;
 * - `HAS_PAYMENTS` — `total` changes on an appointment that already has payments;
 * - `REFUND_REQUIRED` — cancelling an appointment that has payments.
 */
export type CrmWarning = 'OUTSIDE_SCHEDULE' | 'PRICE_CHANGED' | 'HAS_PAYMENTS' | 'REFUND_REQUIRED'

/** Thrown inside the booking transaction to roll the operation back (409 `CONFIRMATION_REQUIRED`). */
export const confirmationRequired = (
  warnings: CrmWarning[],
  extra: Record<string, unknown> = {},
): APIError => crmError('CONFIRMATION_REQUIRED', 409, { warnings, ...extra })

type PayloadErrorLike = { status?: number; name?: string; data?: { code?: unknown } }

/** Payload's own access errors carry no code: give them one, the rest is handled like the public API. */
const crmErrorResponse = (req: PayloadRequest, error: unknown): Response => {
  const e = (error ?? {}) as PayloadErrorLike
  if (typeof e.data?.code !== 'string' && e.name !== 'ValidationError') {
    if (e.status === 401) return errorResponse(req, crmError('UNAUTHORIZED', 401))
    if (e.status === 403) return errorResponse(req, crmError('FORBIDDEN', 403))
    if (e.status === 404) return errorResponse(req, crmError('NOT_FOUND', 404))
  }
  return errorResponse(req, error)
}

/** Staff-only endpoint: no user → 401, a non-staff role (editor) → 403; every error → the API format. */
export const crmEndpoint = (
  method: Endpoint['method'],
  path: string,
  handler: (req: PayloadRequest, staff: StaffContext) => Promise<Response>,
): Endpoint => ({
  method,
  path: `/crm${path}`,
  handler: (async (req) => {
    try {
      if (!req.user) throw crmError('UNAUTHORIZED', 401)
      const staff = await getStaffContext(req)
      if (!staff.isStaff) throw crmError('FORBIDDEN', 403)
      return await handler(req, staff)
    } catch (error) {
      return crmErrorResponse(req, error)
    }
  }) satisfies PayloadHandler,
})

/** Route parameter (`:id`). */
export const routeParam = (req: PayloadRequest, name: string): string =>
  String((req.routeParams as Record<string, unknown> | undefined)?.[name] ?? '')

/** `true` for `confirm: true` / `"true"` / `1`. */
export const isConfirmed = (value: unknown): boolean =>
  value === true || value === 'true' || value === 1 || value === '1'
