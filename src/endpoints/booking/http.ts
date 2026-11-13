/**
 * Shared plumbing of the public booking API (spec §6.1): error format `{ error: { code, details? } }`,
 * rate limits, client IP, input parsing.
 */
import { APIError, type Endpoint, type PayloadHandler, type PayloadRequest } from 'payload'

import {
  consumeRateLimit,
  RATE_LIMITS,
  type RateLimitResult,
  type RateLimitRule,
} from '@/crm/rate-limit'
import { env } from '@/env'
import { supportedLocales } from '@/i18n'

export type BookingErrorCode =
  | 'VALIDATION_ERROR'
  | 'RATE_LIMITED'
  | 'BOOKING_REJECTED'
  | 'BOOKING_DISABLED'
  | 'LOCATION_NOT_FOUND'
  | 'BARBER_NOT_FOUND'
  | 'SERVICE_NOT_FOUND'
  | 'EXTRA_NOT_FOUND'
  | 'EXTRA_NOT_APPLICABLE'
  | 'CERTIFICATE_NOT_FOUND'
  | 'ACTIVE_BOOKINGS_LIMIT'
  | 'TOKEN_INVALID'
  | 'CANCEL_NOT_ALLOWED'
  | 'PHONE_INVALID'
  | 'INTERNAL_ERROR'

/** A public API error; `message` is the code itself — texts are translated by the client. */
export const bookingError = (
  code: BookingErrorCode,
  status: number,
  details?: Record<string, unknown>,
): APIError => new APIError(code, status, { code, ...(details ? { details } : {}) }, true)

const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store', ...headers },
  })

export const ok = (body: unknown, headers?: Record<string, string>): Response =>
  json(body, 200, headers)

type ErrorLike = {
  status?: number
  name?: string
  isPublic?: boolean
  data?: { code?: unknown; details?: unknown; errors?: { path?: string }[] }
}

/** Any thrown error → `{ error: { code, details? } }` with its HTTP status; internals are logged, not shown. */
export const errorResponse = (req: PayloadRequest, error: unknown): Response => {
  const e = (error ?? {}) as ErrorLike
  if (e.name === 'ValidationError') {
    const fields = (e.data?.errors ?? []).map((item) => item.path).filter(Boolean)
    return json({ error: { code: 'VALIDATION_ERROR', details: { fields } } }, 400)
  }
  const status = typeof e.status === 'number' ? e.status : 500
  if (typeof e.data?.code === 'string' && status < 500) {
    const details = e.data.details as Record<string, unknown> | undefined
    const headers: Record<string, string> =
      e.data.code === 'RATE_LIMITED' && typeof details?.retryAfter === 'number'
        ? { 'Retry-After': String(details.retryAfter) }
        : {}
    return json({ error: { code: e.data.code, ...(details ? { details } : {}) } }, status, headers)
  }
  req.payload.logger.error({ err: error, msg: 'booking endpoint failed' })
  return json({ error: { code: 'INTERNAL_ERROR' } }, 500)
}

/**
 * Client IP for rate limits: the `X-Forwarded-For` entry appended by the outermost trusted proxy
 * (`TRUSTED_PROXY_HOPS` from the right), then `X-Real-IP`.
 */
export const clientIp = (req: PayloadRequest, hops: number = env.trustedProxyHops): string => {
  const forwarded = (req.headers.get('x-forwarded-for') ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
  if (hops > 0 && forwarded.length > 0)
    return forwarded[Math.max(0, forwarded.length - hops)] ?? 'unknown'
  return req.headers.get('x-real-ip')?.trim() || 'unknown'
}

export const enforce = (result: RateLimitResult): void => {
  if (!result.ok) throw bookingError('RATE_LIMITED', 429, { retryAfter: result.retryAfterSeconds })
}

export const limit = async (rule: RateLimitRule, subject: string): Promise<void> =>
  enforce(await consumeRateLimit(rule, subject))

/** Public endpoint: catches every error into the API error format; `read` endpoints are rate limited. */
export const bookingEndpoint = (
  method: Endpoint['method'],
  path: string,
  handler: PayloadHandler,
  { rateLimit = 'read' }: { rateLimit?: 'read' | 'none' } = {},
): Endpoint => ({
  method,
  path,
  handler: async (req) => {
    try {
      if (rateLimit === 'read') await limit(RATE_LIMITS.read, clientIp(req))
      return await handler(req)
    } catch (error) {
      return errorResponse(req, error)
    }
  },
})

// ---------------------------------------------------------------------------
// Input parsing
// ---------------------------------------------------------------------------

export type Locale = (typeof supportedLocales)[number]

export const isLocale = (value: unknown): value is Locale =>
  typeof value === 'string' && (supportedLocales as readonly string[]).includes(value)

/** `?locale=` (or the request locale) when supported, else `ru`. */
export const localeOf = (req: PayloadRequest): Locale => {
  const value = req.searchParams.get('locale') ?? req.locale
  return isLocale(value) ? value : 'ru'
}

const ID_RE = /^[0-9a-f]{24}$/i
export const isId = (value: unknown): value is string =>
  typeof value === 'string' && ID_RE.test(value)

/** Collects invalid field names, then throws one `VALIDATION_ERROR` with all of them. */
export class InputErrors {
  readonly fields: string[] = []
  add(field: string): void {
    if (!this.fields.includes(field)) this.fields.push(field)
  }
  throwIfAny(): void {
    if (this.fields.length > 0) throw bookingError('VALIDATION_ERROR', 400, { fields: this.fields })
  }
}

/** JSON body (`{}` when empty); a malformed body is a validation error. */
export const readBody = async (req: PayloadRequest): Promise<Record<string, unknown>> => {
  let data: unknown = req.data
  if (data === undefined && typeof req.json === 'function') {
    try {
      data = await req.json()
    } catch {
      throw bookingError('VALIDATION_ERROR', 400, { fields: ['body'] })
    }
  }
  if (data === undefined || data === null) return {}
  if (typeof data !== 'object' || Array.isArray(data))
    throw bookingError('VALIDATION_ERROR', 400, { fields: ['body'] })
  return data as Record<string, unknown>
}

/** Optional trimmed string with a maximum length; `''` and missing → `null`. */
export const optionalText = (
  errors: InputErrors,
  field: string,
  value: unknown,
  max: number,
): string | null => {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') {
    errors.add(field)
    return null
  }
  const text = value.trim()
  if (text.length > max) errors.add(field)
  return text === '' ? null : text
}

/** `extras[]=a&extras[]=b`, `extras=a&extras=b` or `extras=a,b`. */
export const queryList = (params: URLSearchParams, name: string): string[] =>
  [...params.getAll(`${name}[]`), ...params.getAll(name)]
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter(Boolean)
