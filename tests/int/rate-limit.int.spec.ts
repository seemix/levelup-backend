import { afterEach, describe, expect, it } from 'vitest'

import {
  checkRateLimit,
  consumeRateLimit,
  createMemoryRateLimitStore,
  getRateLimitStore,
  setRateLimitStore,
} from '@/crm/rate-limit'

const rule = { name: 'test', limit: 3, windowMs: 60_000 }

describe('rate limit (in-memory store)', () => {
  const original = getRateLimitStore()
  afterEach(() => setRateLimitStore(original))

  it('allows `limit` events per sliding window and reports when to retry', async () => {
    setRateLimitStore(createMemoryRateLimitStore())
    const t0 = 1_000_000
    for (let i = 0; i < 3; i++)
      expect(await consumeRateLimit(rule, 'a', t0 + i * 10_000)).toEqual({ ok: true })
    expect(await consumeRateLimit(rule, 'a', t0 + 30_000)).toEqual({
      ok: false,
      retryAfterSeconds: 30,
    })
    // Another subject has its own window.
    expect(await consumeRateLimit(rule, 'b', t0 + 30_000)).toEqual({ ok: true })
    // The first event leaves the window after 60 s.
    expect(await consumeRateLimit(rule, 'a', t0 + 60_001)).toEqual({
      ok: false,
      retryAfterSeconds: 10,
    })
    expect(await consumeRateLimit(rule, 'a', t0 + 120_000)).toEqual({ ok: true })
  })

  it('checks without recording', async () => {
    setRateLimitStore(createMemoryRateLimitStore())
    for (let i = 0; i < 5; i++) expect(await checkRateLimit(rule, 'c', 0)).toEqual({ ok: true })
    for (let i = 0; i < 3; i++) await consumeRateLimit(rule, 'c', 0)
    expect((await checkRateLimit(rule, 'c', 1)).ok).toBe(false)
  })

  it('can be replaced by another store', async () => {
    const calls: string[] = []
    setRateLimitStore({
      hit: async (key) => (calls.push(key), 1),
      count: async () => 0,
      retryAfter: async () => 0,
      reset: async () => undefined,
    })
    expect(await consumeRateLimit(rule, 'x')).toEqual({ ok: true })
    expect(calls).toEqual(['test:x'])
  })
})
