import { getPayload, type Payload, type PayloadRequest, createLocalReq } from 'payload'
import { initI18n } from '@payloadcms/translations'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { can, type PolicyUser } from '@/access/policy'
import config from '@/payload.config'
import { toRuleError } from '@/crm/errors'
import { buildLines, calculatePrice, PricingError, type PriceLine } from '@/crm/pricing'
import {
  checkPromo,
  normalizePromoCode,
  validatePromo,
  type PromoDoc,
  type PromoUsageSource,
} from '@/crm/promo'
import { localToInstant } from '@/crm/time'
import { up as promoUp } from '@/migrations/20261113_000003_promo_codes'

const lines: PriceLine[] = buildLines(
  { id: 's1', price: 30_000, durationMinutes: 45 },
  [{ id: 'e1', price: 10_000, durationMinutes: 15 }],
  [],
)

const doc = (patch: Partial<PromoDoc> = {}): PromoDoc => ({
  id: 'p1',
  code: 'WINTER',
  active: true,
  discountType: 'percent',
  value: 10,
  validFrom: null,
  validTo: null,
  maxUses: null,
  maxUsesPerClient: null,
  appliesToServices: [],
  appliesToExtras: [],
  onlineAllowed: true,
  usedCount: 0,
  ...patch,
})

const now = localToInstant('2026-11-20', '12:00')
const check = (
  patch: Partial<PromoDoc> = {},
  extra: Partial<Parameters<typeof checkPromo>[0]> = {},
) => checkPromo({ promo: doc(patch), now, mode: 'online', lines, clientUses: 0, ...extra })

describe('normalizePromoCode', () => {
  it('upper-cases and removes whitespace', () => {
    expect(normalizePromoCode('  win ter2026 ')).toBe('WINTER2026')
    expect(normalizePromoCode('зима')).toBe('ЗИМА')
    expect(normalizePromoCode('\tab\n')).toBe('AB')
  })
})

describe('checkPromo (pure)', () => {
  it('a valid code returns its rule', () => {
    expect(check({ appliesToServices: [{ id: 's1' }], appliesToExtras: ['e9'] })).toEqual({
      ok: true,
      promoId: 'p1',
      rule: {
        discountType: 'percent',
        value: 10,
        appliesToServices: ['s1'],
        appliesToExtras: ['e9'],
      },
    })
  })

  it('missing or inactive code -> PROMO_NOT_FOUND', () => {
    expect(checkPromo({ promo: null, now, mode: 'staff', lines, clientUses: 0 })).toEqual({
      ok: false,
      code: 'PROMO_NOT_FOUND',
    })
    expect(check({ active: false })).toEqual({ ok: false, code: 'PROMO_NOT_FOUND' })
  })

  it('staff-only code: hidden online, valid for staff', () => {
    expect(check({ onlineAllowed: false })).toEqual({ ok: false, code: 'PROMO_NOT_FOUND' })
    expect(check({ onlineAllowed: false }, { mode: 'staff' }).ok).toBe(true)
  })

  it('validity period is inclusive local days (Europe/Chisinau)', () => {
    // Stored as noon of the day (Payload "dayOnly" picker) — any time of the day counts.
    const day = (date: string) => localToInstant(date, '12:00').toISOString()
    expect(check({ validFrom: day('2026-11-20'), validTo: day('2026-11-20') }).ok).toBe(true)
    // First and last minute of the local day.
    for (const time of ['00:00', '23:59']) {
      expect(
        check(
          { validFrom: day('2026-11-20'), validTo: day('2026-11-20') },
          { now: localToInstant('2026-11-20', time) },
        ).ok,
      ).toBe(true)
    }
    expect(check({ validFrom: day('2026-11-21') })).toEqual({ ok: false, code: 'PROMO_EXPIRED' })
    expect(check({ validTo: day('2026-11-19') })).toEqual({ ok: false, code: 'PROMO_EXPIRED' })
    expect(check({ validFrom: day('2026-11-01') }).ok).toBe(true)
    expect(check({ validTo: day('2026-12-31') }).ok).toBe(true)
    // After local midnight the next day starts, although it is still the previous day in UTC.
    expect(
      check({ validTo: day('2026-11-20') }, { now: localToInstant('2026-11-21', '00:30') }),
    ).toEqual({ ok: false, code: 'PROMO_EXPIRED' })
  })

  it('no applicable item -> PROMO_NOT_APPLICABLE', () => {
    expect(check({ appliesToServices: ['other'] })).toEqual({
      ok: false,
      code: 'PROMO_NOT_APPLICABLE',
    })
    expect(check({ appliesToExtras: ['e1'] }).ok).toBe(true)
  })

  it('total limit: usedCount < maxUses', () => {
    expect(check({ maxUses: 5, usedCount: 4 }).ok).toBe(true)
    expect(check({ maxUses: 5, usedCount: 5 })).toEqual({ ok: false, code: 'PROMO_LIMIT' })
    expect(check({ maxUses: 1, usedCount: 7 })).toEqual({ ok: false, code: 'PROMO_LIMIT' })
    expect(check({ maxUses: null, usedCount: 1_000 }).ok).toBe(true)
    // Re-validating an appointment that already holds this code does not count it twice.
    expect(check({ maxUses: 5, usedCount: 5 }, { alreadyApplied: true }).ok).toBe(true)
  })

  it('per-client limit: non-cancelled uses of the client < maxUsesPerClient', () => {
    expect(check({ maxUsesPerClient: 1 }, { clientUses: 0 }).ok).toBe(true)
    expect(check({ maxUsesPerClient: 1 }, { clientUses: 1 })).toEqual({
      ok: false,
      code: 'PROMO_CLIENT_LIMIT',
    })
    expect(check({ maxUsesPerClient: null }, { clientUses: 50 }).ok).toBe(true)
  })

  it('checks in a fixed order', () => {
    expect(check({ active: false, validTo: '2000-01-01T10:00:00.000Z' }).ok).toBe(false)
    expect(check({ active: false, validTo: '2000-01-01T10:00:00.000Z' })).toMatchObject({
      code: 'PROMO_NOT_FOUND',
    })
    expect(check({ validTo: '2000-01-01T10:00:00.000Z', maxUses: 1, usedCount: 1 })).toMatchObject({
      code: 'PROMO_EXPIRED',
    })
    expect(check({ appliesToServices: ['x'], maxUses: 1, usedCount: 1 })).toMatchObject({
      code: 'PROMO_NOT_APPLICABLE',
    })
    expect(
      check({ maxUses: 1, usedCount: 1, maxUsesPerClient: 1 }, { clientUses: 1 }),
    ).toMatchObject({ code: 'PROMO_LIMIT' })
  })

  it('the rule plugs into calculatePrice', () => {
    const result = check({ discountType: 'fixed', value: 100_000 })
    if (!result.ok) throw new Error(result.code)
    const price = calculatePrice({
      service: { id: 's1', price: 30_000, durationMinutes: 45 },
      extras: [{ id: 'e1', price: 10_000, durationMinutes: 15 }],
      promo: result.rule,
    })
    expect(price).toMatchObject({ promoDiscount: 40_000, total: 0 })
  })
})

describe('policy: promo-codes (pure)', () => {
  const u = (roles: string[]): PolicyUser => ({ id: 'u1', roles })
  it('admin CRUD; manager and barber read; editor and anonymous nothing', () => {
    for (const action of ['read', 'create', 'update', 'delete'] as const) {
      expect(can(u(['admin']), action, 'promo-codes')).toBe(true)
      expect(can(u(['editor']), action, 'promo-codes')).toBe(false)
      expect(can(null, action, 'promo-codes')).toBe(false)
      for (const role of ['manager', 'barber']) {
        expect(can(u([role]), action, 'promo-codes')).toBe(action === 'read')
      }
    }
  })
})

describe('promo-codes collection and validatePromo', () => {
  let payload: Payload
  let req: PayloadRequest
  const suffix = Date.now().toString(36).toUpperCase()
  const users: Record<string, { id: string | number }> = {}

  const as = (key: string) => ({
    user: { ...users[key], collection: 'users' as const } as never,
    overrideAccess: false as const,
  })

  const createPromo = (data: Record<string, unknown>, who = 'admin') =>
    payload.create({
      collection: 'promo-codes',
      data: { discountType: 'percent', value: 10, ...data } as never,
      ...as(who),
    }) as unknown as Promise<PromoDoc & { id: string }>

  const errorCode = async (promise: Promise<unknown>): Promise<string | undefined> => {
    try {
      await promise
    } catch (error) {
      return (error as { data?: { code?: string } }).data?.code ?? (error as Error).message
    }
    return undefined
  }

  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    await Promise.all(Object.values(payload.db.collections).map((model) => model.init()))
    req = await createLocalReq({}, payload)
    await promoUp({ payload, req } as Parameters<typeof promoUp>[0])
    const location = await payload.create({
      collection: 'locations',
      data: { name: 'Promo test' } as never,
    })
    for (const [key, roles] of [
      ['admin', ['admin']],
      ['manager', ['manager']],
      ['barber', ['barber']],
    ] as const) {
      users[key] = await payload.create({
        collection: 'users',
        data: {
          email: `${key}-promo-${suffix}@test.local`,
          password: 'test',
          roles: [...roles],
          ...(key === 'manager' ? { locations: [location.id] } : {}),
        } as never,
        overrideAccess: true,
      })
    }
  })

  afterAll(async () => {
    await payload.delete({ collection: 'promo-codes', where: { code: { contains: suffix } } })
  })

  it('stores the code upper-cased without spaces; usedCount starts at 0', async () => {
    const promo = await createPromo({ code: ` sale ${suffix.toLowerCase()} ` })
    expect(promo.code).toBe(`SALE${suffix}`)
    expect(promo.usedCount).toBe(0)
    expect(promo.onlineAllowed).toBe(true)
    expect(promo.active).toBe(true)
  })

  it('code is unique case-insensitively', async () => {
    await createPromo({ code: `DUP${suffix}` })
    const code = await errorCode(createPromo({ code: `dup${suffix.toLowerCase()}` }))
    expect(code).toBeDefined()
  })

  it('usedCount cannot be set through the API', async () => {
    const promo = await createPromo({ code: `CNT${suffix}`, usedCount: 50 })
    expect(promo.usedCount).toBe(0)
    const updated = (await payload.update({
      collection: 'promo-codes',
      id: promo.id,
      data: { usedCount: 9, description: 'x' } as never,
      ...as('admin'),
    })) as unknown as PromoDoc
    expect(updated.usedCount).toBe(0)
  })

  it('validates value by discount type and the period order', async () => {
    expect(await errorCode(createPromo({ code: `P0${suffix}`, value: 0 }))).toBeDefined()
    expect(await errorCode(createPromo({ code: `P1${suffix}`, value: 101 }))).toBeDefined()
    expect(await errorCode(createPromo({ code: `P2${suffix}`, value: 7.5 }))).toBeDefined()
    expect(
      await errorCode(createPromo({ code: `F1${suffix}`, discountType: 'fixed', value: 150_000 })),
    ).toBeUndefined()
    expect(
      await errorCode(
        createPromo({
          code: `D1${suffix}`,
          validFrom: '2026-12-10T10:00:00.000Z',
          validTo: '2026-12-01T10:00:00.000Z',
        }),
      ),
    ).toBeDefined()
    expect(await errorCode(createPromo({ code: ` ${suffix} !` }))).toBeDefined()
  })

  it('manager and barber read but cannot write', async () => {
    const promo = await createPromo({ code: `RO${suffix}` })
    for (const who of ['manager', 'barber']) {
      const found = await payload.findByID({ collection: 'promo-codes', id: promo.id, ...as(who) })
      expect(found.id).toBe(promo.id)
      expect(await errorCode(createPromo({ code: `X${who}${suffix}` }, who))).toBeDefined()
    }
  })

  it('validatePromo: case-insensitive lookup, rule, machine codes with translated messages', async () => {
    await createPromo({ code: `VAL${suffix}`, discountType: 'fixed', value: 5_000 })
    const { promoId, rule } = await validatePromo({
      req,
      code: ` val${suffix.toLowerCase()} `,
      mode: 'online',
      lines,
      now,
    })
    expect(promoId).toBeDefined()
    expect(rule).toMatchObject({ discountType: 'fixed', value: 5_000 })

    const i18n = await initI18n({
      config: payload.config.i18n,
      context: 'api',
      language: 'en',
    })
    let caught: { status?: number; data?: { code?: string }; message?: string } | undefined
    try {
      const enReq = await createLocalReq({}, payload)
      enReq.i18n = i18n as never
      enReq.t = i18n.t as never
      await validatePromo({ req: enReq, code: 'NOPE', mode: 'online', lines, now })
    } catch (error) {
      caught = error as typeof caught
    }
    expect(caught?.data?.code).toBe('PROMO_NOT_FOUND')
    expect(caught?.status).toBe(404)
    expect(caught?.message).toBe('Promo code not found')

    // Manual-discount violations from the pure pricing code get the same treatment.
    const converted = toRuleError(i18n.t, new PricingError('DISCOUNT_TOO_LARGE')) as {
      status: number
      message: string
      data: { code: string }
    }
    expect(converted).toMatchObject({
      status: 400,
      message: 'The discount exceeds the amount to pay',
      data: { code: 'DISCOUNT_TOO_LARGE' },
    })
    const other = new Error('boom')
    expect(toRuleError(i18n.t, other)).toBe(other)
  })

  it('validatePromo: per-client uses come from the usage source, excluding the edited appointment', async () => {
    await createPromo({ code: `CL${suffix}`, maxUsesPerClient: 1 })
    const calls: unknown[] = []
    const usage: PromoUsageSource = async (args) => {
      calls.push({ clientId: args.clientId, exclude: args.excludeAppointmentId })
      return args.excludeAppointmentId ? 0 : 1
    }
    const base = {
      req,
      code: `CL${suffix}`,
      mode: 'staff' as const,
      lines,
      now,
      usageSource: usage,
    }

    // No client yet (online quote before the phone step): the per-client limit is not checked.
    await expect(validatePromo(base)).resolves.toBeDefined()
    expect(calls).toHaveLength(0)

    expect(await errorCode(validatePromo({ ...base, clientId: 'c1' }))).toBe('PROMO_CLIENT_LIMIT')
    await expect(
      validatePromo({ ...base, clientId: 'c1', currentAppointmentId: 'a1' }),
    ).resolves.toBeDefined()
    expect(calls).toEqual([
      { clientId: 'c1', exclude: undefined },
      { clientId: 'c1', exclude: 'a1' },
    ])
  })

  it('validatePromo: inactive, expired, total limit, not applicable', async () => {
    await createPromo({ code: `IN${suffix}`, active: false })
    await createPromo({ code: `EX${suffix}`, validTo: '2026-11-19T10:00:00.000Z' })
    await createPromo({ code: `NA${suffix}`, appliesToServices: [], appliesToExtras: [] })
    const base = { req, mode: 'online' as const, lines, now }
    expect(await errorCode(validatePromo({ ...base, code: `IN${suffix}` }))).toBe('PROMO_NOT_FOUND')
    expect(await errorCode(validatePromo({ ...base, code: `EX${suffix}` }))).toBe('PROMO_EXPIRED')
    expect(await errorCode(validatePromo({ ...base, code: `NA${suffix}`, lines: [] }))).toBe(
      'PROMO_NOT_APPLICABLE',
    )
    expect(await errorCode(validatePromo({ ...base, code: '' }))).toBe('PROMO_NOT_FOUND')

    const limited = await createPromo({ code: `LIM${suffix}`, maxUses: 1 })
    // usedCount is maintained by the appointments service (stage 7) with $inc inside the transaction.
    await payload.db.collections['promo-codes'].updateOne(
      { _id: limited.id },
      { $inc: { usedCount: 1 } },
    )
    expect(await errorCode(validatePromo({ ...base, code: `LIM${suffix}` }))).toBe('PROMO_LIMIT')
    await expect(
      validatePromo({ ...base, code: `LIM${suffix}`, alreadyApplied: true }),
    ).resolves.toBeDefined()
  })
})
