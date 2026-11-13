import { getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { can, type PolicyUser } from '@/access/policy'
import type { Role } from '@/access'
import config from '@/payload.config'

const u = (roles: string[]): PolicyUser => ({ id: 'u1', roles })

describe('policy: catalog (pure)', () => {
  it('anonymous reads active only, never writes', () => {
    expect(can(null, 'read', 'catalog')).toEqual({ active: { equals: true } })
    for (const action of ['create', 'update', 'delete'] as const) {
      expect(can(null, action, 'catalog')).toBe(false)
    }
  })

  it('staff and editor read everything, only admin writes', () => {
    for (const role of ['admin', 'manager', 'barber', 'editor']) {
      expect(can(u([role]), 'read', 'catalog')).toBe(true)
    }
    for (const action of ['create', 'update', 'delete'] as const) {
      expect(can(u(['admin']), action, 'catalog')).toBe(true)
      for (const role of ['manager', 'barber', 'editor']) {
        expect(can(u([role]), action, 'catalog')).toBe(false)
      }
    }
  })
})

describe('catalog collections', () => {
  let payload: Payload
  const users: Record<string, { id: string | number; roles?: Role[] | null }> = {}
  const suffix = Date.now()

  let locationId: string | number

  // Fields with defaults are required in generated create types; tests rely on the defaults.
  const make = (args: Record<string, unknown>) =>
    payload.create(args as never) as unknown as Promise<{ id: string; [key: string]: unknown }>

  const makeUser = (roles: Role[]) =>
    payload.create({
      collection: 'users',
      data: {
        email: `${roles.join('-')}-cat-${suffix}@test.local`,
        password: 'test',
        roles,
        locations: roles.includes('manager') ? [locationId as never] : undefined,
      },
    })

  const as = (role: string) => ({ user: { ...users[role], collection: 'users' as const } as never })

  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    await Promise.all(Object.values(payload.db.collections).map((model) => model.init()))
    locationId = (await make({ collection: 'locations', data: { name: 'Catalog test' } })).id
    // The very first user always becomes admin, so create the admin first.
    users.admin = await makeUser(['admin'])
    users.manager = await makeUser(['manager'])
    users.barber = await makeUser(['barber'])
    users.editor = await makeUser(['editor'])
  })

  afterAll(async () => {
    await payload.delete({ collection: 'locations', where: { id: { equals: locationId } } })
    await payload.delete({ collection: 'extras', where: { id: { exists: true } } })
    await payload.delete({ collection: 'services', where: { id: { exists: true } } })
    await payload.delete({ collection: 'service-categories', where: { id: { exists: true } } })
    await payload.delete({
      collection: 'users',
      where: { id: { in: Object.values(users).map((x) => x.id) } },
    })
  })

  it('admin creates category, service and extra in three languages; price stays in bani', async () => {
    const category = await make({
      collection: 'service-categories',
      data: { name: 'Стрижки' },
      locale: 'ru',
      ...as('admin'),
      overrideAccess: false,
    })
    await payload.update({
      collection: 'service-categories',
      id: category.id,
      data: { name: 'Tunsori' },
      locale: 'ro',
    })
    await payload.update({
      collection: 'service-categories',
      id: category.id,
      data: { name: 'Haircuts' },
      locale: 'en',
    })

    const service = await make({
      collection: 'services',
      data: { name: 'Стрижка', category: category.id, durationMinutes: 45, price: 25000 },
      locale: 'ru',
      ...as('admin'),
      overrideAccess: false,
    })
    const extra = await make({
      collection: 'extras',
      data: { name: 'Мытьё', durationMinutes: 0, price: 0, appliesTo: [service.id] },
      locale: 'ru',
      ...as('admin'),
      overrideAccess: false,
    })

    const all = await payload.findByID({
      collection: 'service-categories',
      id: category.id,
      locale: 'all',
    })
    expect(all.name).toEqual({ ru: 'Стрижки', ro: 'Tunsori', en: 'Haircuts' })
    expect(service).toMatchObject({ price: 25000, active: true, onlineBooking: true })
    expect(extra.price).toBe(0)
  })

  it('anonymous sees active items only, staff see all', async () => {
    await make({
      collection: 'services',
      data: { name: 'Архив', durationMinutes: 30, price: 100, active: false },
    })
    await make({
      collection: 'extras',
      data: { name: 'Архив', durationMinutes: 5, price: 100, active: false },
    })
    await make({
      collection: 'service-categories',
      data: { name: 'Архив', active: false },
    })

    for (const collection of ['services', 'extras', 'service-categories'] as const) {
      const anon = await payload.find({ collection, overrideAccess: false, pagination: false })
      expect(anon.docs.length, collection).toBeGreaterThan(0)
      expect(
        anon.docs.every((d) => d.active),
        collection,
      ).toBe(true)

      for (const role of ['manager', 'barber', 'editor']) {
        const staff = await payload.find({
          collection,
          ...as(role),
          overrideAccess: false,
          pagination: false,
        })
        expect(
          staff.docs.some((d) => !d.active),
          `${collection}/${role}`,
        ).toBe(true)
      }
    }
  })

  it('anonymous cannot read an inactive item by id', async () => {
    const hidden = await make({
      collection: 'services',
      data: { name: 'Скрытая', durationMinutes: 30, price: 100, active: false },
    })
    await expect(
      payload.findByID({ collection: 'services', id: hidden.id, overrideAccess: false }),
    ).rejects.toThrow()
  })

  it('only admin writes to the catalog', async () => {
    const data = { name: 'X', durationMinutes: 30, price: 100 }
    await expect(make({ collection: 'services', data, overrideAccess: false })).rejects.toThrow()
    for (const role of ['manager', 'barber', 'editor']) {
      await expect(
        make({ collection: 'services', data, ...as(role), overrideAccess: false }),
      ).rejects.toThrow()
      await expect(
        make({ collection: 'extras', data, ...as(role), overrideAccess: false }),
      ).rejects.toThrow()
      await expect(
        make({
          collection: 'service-categories',
          data: { name: 'X' },
          ...as(role),
          overrideAccess: false,
        }),
      ).rejects.toThrow()
    }
  })

  it('validates duration and price', async () => {
    const base = { name: 'V', durationMinutes: 30, price: 100 }
    const create = (data: Record<string, unknown>) =>
      payload.create({ collection: 'services', data: data as never })

    await expect(create({ ...base, durationMinutes: 7 })).rejects.toThrow()
    await expect(create({ ...base, durationMinutes: 0 })).rejects.toThrow()
    await expect(create({ ...base, price: -1 })).rejects.toThrow()
    await expect(create({ ...base, price: 10.5 })).rejects.toThrow()
    await expect(create({ ...base, price: undefined })).rejects.toThrow()
    await expect(create({ ...base, price: 0 })).resolves.toBeDefined()

    const extra = (data: Record<string, unknown>) =>
      payload.create({ collection: 'extras', data: data as never })
    await expect(extra({ ...base, durationMinutes: -5 })).rejects.toThrow()
    await expect(extra({ ...base, durationMinutes: 0 })).resolves.toBeDefined()
  })
})
