// @vitest-environment node
import { createLocalReq, getPayload, type Payload } from 'payload'
import { beforeAll, describe, expect, it } from 'vitest'

import { recalculateBalances } from '@/crm/ledger.service'
import { up as appointmentsUp } from '@/migrations/20261113_000004_appointments'
import config from '@/payload.config'
import { resetSeed, runSeed } from '@/seed/run'

const PASSWORD = 'seed-test-password'

describe('seed', { timeout: 300_000 }, () => {
  let payload: Payload

  const total = async (collection: string) =>
    (await payload.count({ collection, overrideAccess: true } as never)).totalDocs

  const snapshot = async () =>
    Object.fromEntries(
      await Promise.all(
        [
          'locations',
          'users',
          'barbers',
          'service-categories',
          'services',
          'extras',
          'barber-prices',
          'schedule-exceptions',
          'clients',
          'promo-codes',
          'appointments',
          'cash-registers',
          'expense-categories',
          'transactions',
        ].map(async (collection) => [collection, await total(collection)] as const),
      ),
    )

  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    await Promise.all(Object.values(payload.db.collections).map((model) => model.init()))
    const req = await createLocalReq({}, payload)
    await appointmentsUp({ payload, req } as Parameters<typeof appointmentsUp>[0])
  })

  it('creates the dataset of spec §9', async () => {
    // A user that the seed did not create must survive everything below.
    await payload.create({
      collection: 'users',
      data: { email: 'real-editor@example.com', password: 'editor-password', roles: ['editor'] },
      overrideAccess: true,
    })

    const created = await runSeed(payload, { password: PASSWORD })
    expect(created.users).toBe(5)
    expect(created.barbers).toBe(3)
    expect(created.services).toBe(6)
    expect(created.extras).toBe(3)
    expect(created.clients).toBe(15)
    expect(created['promo-codes']).toBe(1)
    expect(created.appointments).toBeGreaterThan(20)
    expect(created['cash-registers']).toBe(2)
    expect(created['expense-categories']).toBe(4)
    // Opening balance + 3 expenses + 1 transfer.
    expect(created.transactions).toBe(5)
    const registers = await payload.find({
      collection: 'cash-registers',
      locale: 'en',
      pagination: false,
      overrideAccess: true,
      select: { name: true, balance: true },
    })
    expect(Object.fromEntries(registers.docs.map((doc) => [doc.name, doc.balance]))).toEqual({
      Cash: 300_000 - 45_000 - 150_000 - 8_000,
      'Card terminal': 150_000 - 120_000,
    })
    expect((await recalculateBalances(payload, { apply: false })).diffs).toEqual([])

    const { docs } = await payload.find({
      collection: 'appointments',
      pagination: false,
      depth: 0,
      overrideAccess: true,
      select: { status: true, kind: true },
    })
    const statuses = new Set(docs.map((doc) => doc.status))
    expect(statuses.has('scheduled')).toBe(true)
    expect(statuses.has('completed')).toBe(true)
    expect([...statuses].length).toBeGreaterThanOrEqual(3)

    const services = await payload.find({
      collection: 'services',
      locale: 'ro',
      pagination: false,
      overrideAccess: true,
    })
    expect(services.docs.every((doc) => doc.name)).toBe(true)
    expect(services.docs.map((doc) => doc.name)).toContain('Tunsoare bărbătească')
  })

  it('lets seed users log in with SEED_PASSWORD', async () => {
    for (const email of ['manager@levelup.local', 'barber1@levelup.local']) {
      const result = await payload.login({
        collection: 'users',
        data: { email, password: PASSWORD },
      })
      expect(result.token).toBeTruthy()
    }
  })

  it('is idempotent', async () => {
    const before = await snapshot()
    const created = await runSeed(payload, { password: PASSWORD })
    expect(created).toEqual({})
    expect(await snapshot()).toEqual(before)
  })

  it('reset removes CRM data only and restores the dataset', async () => {
    const before = await snapshot()
    const removed = await resetSeed(payload)
    expect(removed.users).toBe(5)
    expect(await total('appointments')).toBe(0)
    expect(await total('clients')).toBe(0)
    expect(await total('transactions')).toBe(0)
    expect(await total('cash-registers')).toBe(0)
    // Locations and users that the seed did not create are kept.
    expect(await total('locations')).toBe(before.locations)
    const editor = await payload.find({
      collection: 'users',
      where: { email: { equals: 'real-editor@example.com' } },
      overrideAccess: true,
    })
    expect(editor.totalDocs).toBe(1)

    await runSeed(payload, { password: PASSWORD, reset: true })
    expect((await snapshot()).users).toBe(before.users)
    expect((await snapshot()).clients).toBe(15)
    expect((await snapshot()).transactions).toBe(before.transactions)
  })
})
