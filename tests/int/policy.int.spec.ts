import { getPayload, type Payload, type PayloadRequest } from 'payload'
import { createLocalReq } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { allowed, can, getStaffContext, type PolicyUser } from '@/access/policy'
import config from '@/payload.config'
import { up as defaultLocationUp } from '@/migrations/20261113_000000_default_location'

const u = (roles: string[], extra: Partial<NonNullable<PolicyUser>> = {}): PolicyUser => ({
  id: 'u1',
  roles,
  ...extra,
})

describe('policy.can (pure)', () => {
  it('content: everyone reads, admin and editor write', () => {
    expect(can(null, 'read', 'content')).toBe(true)
    for (const action of ['create', 'update', 'delete'] as const) {
      expect(can(u(['admin']), action, 'content')).toBe(true)
      expect(can(u(['editor']), action, 'content')).toBe(true)
      expect(can(u(['manager']), action, 'content')).toBe(false)
      expect(can(u(['barber']), action, 'content')).toBe(false)
      expect(can(null, action, 'content')).toBe(false)
    }
  })

  it('finance view: admin and manager read, barber/editor/anonymous do not (A35)', () => {
    expect(can(u(['admin']), 'read', 'finance')).toBe(true)
    expect(can(u(['manager']), 'read', 'finance')).toBe(true)
    for (const role of ['barber', 'editor']) expect(can(u([role]), 'read', 'finance')).toBe(false)
    expect(can(null, 'read', 'finance')).toBe(false)
    expect(can(u(['admin']), 'update', 'finance')).toBe(false)
  })

  it('users: admin all, others only self (read/update), nobody else creates/deletes', () => {
    expect(can(u(['admin']), 'delete', 'users')).toBe(true)
    for (const role of ['manager', 'barber', 'editor']) {
      expect(can(u([role]), 'read', 'users')).toEqual({ id: { equals: 'u1' } })
      expect(can(u([role]), 'update', 'users', { id: 'u1' })).toBe(true)
      expect(can(u([role]), 'update', 'users', { id: 'u2' })).toBe(false)
      expect(can(u([role]), 'create', 'users')).toBe(false)
      expect(can(u([role]), 'delete', 'users', { id: 'u1' })).toBe(false)
    }
    expect(can(null, 'read', 'users')).toBe(false)
  })

  it('users.privileged: only admin writes roles/locations', () => {
    expect(allowed(u(['admin']), 'update', 'users.privileged')).toBe(true)
    for (const role of ['manager', 'barber', 'editor']) {
      expect(allowed(u([role]), 'update', 'users.privileged', { id: 'u1' })).toBe(false)
      expect(allowed(u([role]), 'create', 'users.privileged')).toBe(false)
    }
  })

  it('locations: anon active only, manager own, roles combine with OR', () => {
    expect(can(null, 'read', 'locations')).toEqual({ active: { equals: true } })
    expect(can(u(['manager'], { locations: ['l1', { id: 'l2' }] }), 'read', 'locations')).toEqual({
      id: { in: ['l1', 'l2'] },
    })
    expect(can(u(['manager']), 'read', 'locations')).toBe(false)
    expect(can(u(['manager', 'barber'], { locations: ['l1'] }), 'read', 'locations')).toBe(true)
    expect(can(u(['manager'], { locations: ['l1'] }), 'update', 'locations')).toBe(false)
    expect(can(u(['admin']), 'delete', 'locations')).toBe(true)
  })

  it('booking-settings: public read, admin update, private fields for logged-in users', () => {
    expect(can(null, 'read', 'booking-settings')).toBe(true)
    expect(can(u(['manager']), 'update', 'booking-settings')).toBe(false)
    expect(can(u(['admin']), 'update', 'booking-settings')).toBe(true)
    expect(can(null, 'read', 'booking-settings.private')).toBe(false)
    expect(can(u(['editor']), 'read', 'booking-settings.private')).toBe(true)
  })
})

describe('getStaffContext', () => {
  let payload: Payload

  beforeAll(async () => {
    payload = await getPayload({ config: await config })
  })

  it('resolves roles/locations and caches the result in req.context', async () => {
    const req = (await createLocalReq({}, payload)) as PayloadRequest
    req.user = {
      id: 'u1',
      collection: 'users',
      roles: ['manager', 'barber'],
      locations: ['l1'],
    } as never

    const ctx = await getStaffContext(req)
    expect(ctx).toMatchObject({
      userId: 'u1',
      roles: ['manager', 'barber'],
      isManager: true,
      isBarber: true,
      isAdmin: false,
      isStaff: true,
      locationIds: ['l1'],
      // `barbers.user` does not exist yet (stage 3): no barber link.
      barberId: null,
    })
    expect(await getStaffContext(req)).toBe(ctx)

    // A different user on the same req is not served from the stale cache.
    req.user = { id: 'u2', collection: 'users', roles: ['editor'] } as never
    const other = await getStaffContext(req)
    expect(other).toMatchObject({ userId: 'u2', isEditor: true, isStaff: false, locationIds: [] })
  })

  it('anonymous context is empty', async () => {
    const req = (await createLocalReq({}, payload)) as PayloadRequest
    expect(await getStaffContext(req)).toMatchObject({ userId: null, roles: [], isStaff: false })
  })
})

describe('migration: default location', () => {
  let payload: Payload

  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    // Make sure collections/indexes exist before transactions start (avoids catalog-change errors).
    await Promise.all(Object.values(payload.db.collections).map((model) => model.init()))
  })

  afterAll(async () => {
    await payload.delete({ collection: 'locations', where: { id: { exists: true } } })
  })

  it('creates "Bălți, Decebal 142" in ru/ro/en once, leaves user roles untouched', async () => {
    // The very first user always becomes admin (Users hook), so create one before the editor.
    const admin = await payload.create({
      collection: 'users',
      data: { email: `mig-admin-${Date.now()}@test.local`, password: 'test', roles: ['admin'] },
    })
    const editor = await payload.create({
      collection: 'users',
      data: { email: `mig-${Date.now()}@test.local`, password: 'test', roles: ['editor'] },
    })
    await payload.delete({ collection: 'locations', where: { id: { exists: true } } })

    const req = await createLocalReq({}, payload)
    await defaultLocationUp({ payload, req } as Parameters<typeof defaultLocationUp>[0])
    await defaultLocationUp({ payload, req } as Parameters<typeof defaultLocationUp>[0])

    const { docs } = await payload.find({ collection: 'locations', locale: 'all' })
    expect(docs).toHaveLength(1)
    expect(docs[0]).toMatchObject({
      active: true,
      name: { ru: 'Бельцы, Дечебал 142', ro: 'Bălți, Decebal 142', en: 'Bălți, Decebal 142' },
    })

    const settings = await payload.findGlobal({ slug: 'booking-settings' })
    expect(settings.slotStepMinutes).toBe(15)

    const stored = await payload.findByID({ collection: 'users', id: editor.id, depth: 0 })
    expect(stored.roles).toEqual(['editor'])
    await payload.delete({ collection: 'users', where: { id: { in: [admin.id, editor.id] } } })
  })
})
