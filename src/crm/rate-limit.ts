/**
 * Rate limiting of the public booking API (spec §6.1, decision 25, A11).
 *
 * The store is behind an interface: the default keeps sliding-window logs in process memory
 * (one application instance). Several instances need a shared store (e.g. Redis) passed to
 * `setRateLimitStore` — out of scope for v1.
 */

export type RateLimitStore = {
  /** Records one event for `key` and returns the number of events within the window (including it). */
  hit: (key: string, windowMs: number, now: number) => Promise<number>
  /** Number of events of `key` within the window, without recording one. */
  count: (key: string, windowMs: number, now: number) => Promise<number>
  /** Milliseconds until the oldest event of `key` leaves the window (0 if none). */
  retryAfter: (key: string, windowMs: number, now: number) => Promise<number>
  reset: () => Promise<void>
}

export type RateLimitRule = {
  /** Bucket name, e.g. `read`, `create`. */
  name: string
  limit: number
  windowMs: number
}

export type RateLimitResult = { ok: true } | { ok: false; retryAfterSeconds: number }

/** Limits of spec §6.1 (+ attempt limits against enumeration, see A26). */
export const RATE_LIMITS = {
  /** Reads (config, days, slots, quote, cancel lookup): 30 requests per minute per IP. */
  read: { name: 'read', limit: 30, windowMs: 60_000 },
  /** Booking attempts per IP (validation errors and conflicts included). */
  createAttempt: { name: 'create-attempt', limit: 20, windowMs: 3_600_000 },
  /** Created appointments per IP. */
  create: { name: 'create', limit: 5, windowMs: 3_600_000 },
  /** Booking attempts per phone number. */
  phoneAttempt: { name: 'phone-attempt', limit: 10, windowMs: 3_600_000 },
} as const satisfies Record<string, RateLimitRule>

/** Active future appointments per phone (spec §6.1). */
export const MAX_ACTIVE_BOOKINGS_PER_PHONE = 3

/** Sliding-window log in memory; keys whose events have all expired are swept periodically. */
export const createMemoryRateLimitStore = (): RateLimitStore => {
  const events = new Map<string, number[]>()
  let operations = 0
  let longestWindow = 0

  const recent = (key: string, windowMs: number, now: number): number[] => {
    const list = (events.get(key) ?? []).filter((at) => at > now - windowMs)
    if (list.length === 0) events.delete(key)
    else events.set(key, list)
    return list
  }

  const sweep = (now: number) => {
    for (const [key, list] of events) {
      if ((list[list.length - 1] ?? 0) <= now - longestWindow) events.delete(key)
    }
  }

  return {
    hit: async (key, windowMs, now) => {
      longestWindow = Math.max(longestWindow, windowMs)
      if (++operations % 1000 === 0) sweep(now)
      const list = recent(key, windowMs, now)
      list.push(now)
      events.set(key, list)
      return list.length
    },
    count: async (key, windowMs, now) => recent(key, windowMs, now).length,
    retryAfter: async (key, windowMs, now) => {
      const oldest = recent(key, windowMs, now)[0]
      return oldest === undefined ? 0 : Math.max(0, oldest + windowMs - now)
    },
    reset: async () => {
      events.clear()
    },
  }
}

let store: RateLimitStore = createMemoryRateLimitStore()

export const getRateLimitStore = (): RateLimitStore => store

/** Replaces the store (shared storage for several instances, tests). */
export const setRateLimitStore = (next: RateLimitStore): void => {
  store = next
}

const keyOf = (rule: RateLimitRule, subject: string) => `${rule.name}:${subject}`

const denied = async (rule: RateLimitRule, subject: string, now: number) => ({
  ok: false as const,
  retryAfterSeconds: Math.max(
    1,
    Math.ceil((await store.retryAfter(keyOf(rule, subject), rule.windowMs, now)) / 1000),
  ),
})

/** Records an event and tells whether it is within the limit. */
export const consumeRateLimit = async (
  rule: RateLimitRule,
  subject: string,
  now: number = Date.now(),
): Promise<RateLimitResult> => {
  const count = await store.hit(keyOf(rule, subject), rule.windowMs, now)
  return count <= rule.limit ? { ok: true } : denied(rule, subject, now)
}

/** Tells whether one more event would be within the limit, without recording it. */
export const checkRateLimit = async (
  rule: RateLimitRule,
  subject: string,
  now: number = Date.now(),
): Promise<RateLimitResult> => {
  const count = await store.count(keyOf(rule, subject), rule.windowMs, now)
  return count < rule.limit ? { ok: true } : denied(rule, subject, now)
}
