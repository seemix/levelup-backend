import { createLocalReq, getPayload, type Payload } from 'payload'
import { initI18n } from '@payloadcms/translations'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { can, type PolicyUser } from '@/access/policy'
import type { Role } from '@/access'
import config from '@/payload.config'
import { up as clientsUp } from '@/migrations/20261113_000002_clients'

const u = (roles: string[]): PolicyUser => ({ id: 'u1', roles })

describe('policy: clients (pure)', () => {
  it('admin and manager read/create/update, only admin deletes', () => {
    for (const role of ['admin', 'manager']) {
      for (const action of ['read', 'create', 'update'] as const) {
        expect(can(u([role]), action, 'clients')).toBe(true)
      }
    }
    expect(can(u(['admin']), 'delete', 'clients')).toBe(true)
    expect(can(u(['manager']), 'delete', 'clients')).toBe(false)
  })

  it('barber, editor and anonymous have no access', () => {
    for (const user of [u(['barber']), u(['editor']), null]) {
      for (const action of ['read', 'create', 'update', 'delete'] as const) {
        expect(can(user, action, 'clients')).toBe(false)
      }
    }
  })

  it('email is readable by admin and manager only', () => {
    expect(can(u(['admin']), 'read', 'clients.email')).toBe(true)
    expect(can(u(['manager']), 'read', 'clients.email')).toBe(true)
    expect(can(u(['barber']), 'read', 'clients.email')).toBe(false)
    expect(can(null, 'read', 'clients.email')).toBe(false)
  })
})

describe('clients collection', () => {
  let payload: Payload
  type User = { id: string | number; roles?: Role[] | null }
  const users: Record<string, User> = {}
  const suffix = Date.now()

  const as = (key: string) => ({
    user: { ...users[key], collection: 'users' as const } as never,
    overrideAccess: false as const,
  })

  const newClient = (phone: string, extra: Record<string, unknown> = {}, who = 'manager') =>
    payload.create({
      collection: 'clients',
      data: { firstName: 'Ion', phone, ...extra } as never,
      ...as(who),
    }) as unknown as Promise<{ id: string; phone: string; email?: string; language: string }>

  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    await Promise.all(Object.values(payload.db.collections).map((model) => model.init()))
    const req = await createLocalReq({}, payload)
    await clientsUp({ payload, req } as Parameters<typeof clientsUp>[0])

    const location = await payload.create({
      collection: 'locations',
      data: { name: 'Clients test' } as never,
    })

    for (const [key, roles] of [
      ['admin', ['admin']],
      ['manager', ['manager']],
      ['barber', ['barber']],
    ] as const) {
      users[key] = await payload.create({
        collection: 'users',
        data: {
          email: `${key}-clients-${suffix}@test.local`,
          password: 'test',
          roles: [...roles],
          ...(key === 'manager' ? { locations: [location.id] } : {}),
        } as never,
        overrideAccess: true,
      })
    }
  })

  afterAll(async () => {
    await payload.delete({ collection: 'clients', where: { id: { exists: true } } })
    await payload.delete({ collection: 'locations', where: { name: { equals: 'Clients test' } } })
    await payload.delete({
      collection: 'users',
      where: { email: { like: `-clients-${suffix}@test.local` } },
    })
  })

  it('normalizes 069…, +373 69…, 0037369… to E.164', async () => {
    const cases = ['069 123 456', '+373 69 234 567', '0037369345678', '(069) 456-789']
    const expected = ['+37369123456', '+37369234567', '+37369345678', '+37369456789']
    for (const [i, phone] of cases.entries()) {
      const client = await newClient(phone)
      expect(client.phone).toBe(expected[i])
    }
  })

  it('applies defaults: language ru, not blocked', async () => {
    const client = await newClient('069 500 001')
    expect(client.language).toBe('ru')
    expect((client as unknown as { blocked: boolean }).blocked).toBe(false)
  })

  it('stores externalId and source', async () => {
    const client = await newClient('069 500 002', { externalId: 'old-42', source: 'import' })
    const found = await payload.find({
      collection: 'clients',
      where: { externalId: { equals: 'old-42' } },
      overrideAccess: true,
    })
    expect(found.docs.map((d) => d.id)).toEqual([client.id])
    expect((found.docs[0] as unknown as { source: string }).source).toBe('import')
  })

  it.each(['', '   ', 'abc', '123', '+37312345', '069 12'])(
    'rejects invalid phone %j with PHONE_INVALID',
    async (phone) => {
      await expect(newClient(phone)).rejects.toMatchObject({
        status: 400,
        data: { code: 'PHONE_INVALID' },
      })
    },
  )

  it('rejects a duplicate in any format with PHONE_TAKEN', async () => {
    await newClient('069 600 001')
    for (const phone of ['069600001', '+373 69 600 001', '0037369600001']) {
      await expect(newClient(phone)).rejects.toMatchObject({
        status: 409,
        data: { code: 'PHONE_TAKEN' },
      })
    }
  })

  it('update: keeps own phone, rejects another client phone, normalizes a new one', async () => {
    const a = await newClient('069 700 001')
    const b = await newClient('069 700 002')
    const update = (id: string, data: Record<string, unknown>) =>
      payload.update({ collection: 'clients', id, data: data as never, ...as('manager') })

    // Saving the same number (any format) is not a duplicate of itself.
    expect((await update(a.id, { phone: '069700001', notes: 'vip' })).phone).toBe('+37369700001')
    // Updating another field without phone keeps it.
    expect((await update(a.id, { firstName: 'Vasile' })).phone).toBe('+37369700001')
    await expect(update(b.id, { phone: '+37369700001' })).rejects.toMatchObject({
      data: { code: 'PHONE_TAKEN' },
    })
    await expect(update(b.id, { phone: 'nope' })).rejects.toMatchObject({
      data: { code: 'PHONE_INVALID' },
    })
    expect((await update(b.id, { phone: '069 700 003' })).phone).toBe('+37369700003')
  })

  it('the unique index rejects duplicates that bypass the hook', async () => {
    await newClient('069 800 001')
    const model = payload.db.collections['clients']
    await expect(
      model.collection.insertOne({ firstName: 'X', phone: '+37369800001', language: 'ru' }),
    ).rejects.toMatchObject({ code: 11000 })
  })

  it('error messages are translated', async () => {
    const message = async (lng: 'ru' | 'ro' | 'en') => {
      const req = await createLocalReq({}, payload)
      const i18n = await initI18n({ config: payload.config.i18n, context: 'api', language: lng })
      req.i18n = i18n as never
      req.t = i18n.t as never
      return payload
        .create({ collection: 'clients', data: { firstName: 'X', phone: 'bad' } as never, req })
        .catch((e: Error) => e.message)
    }
    const [ru, ro, en] = await Promise.all([message('ru'), message('ro'), message('en')])
    expect(new Set([ru, ro, en]).size).toBe(3)
    expect(en).toBe('Invalid phone number')
  })

  describe('access by role', () => {
    it('admin and manager create and read; barber is denied everything', async () => {
      const own = await newClient('069 900 001', { email: 'a@b.md' }, 'admin')
      await newClient('069 900 002', {}, 'manager')
      expect(
        (await payload.findByID({ collection: 'clients', id: own.id, ...as('manager') })).id,
      ).toBe(own.id)

      await expect(newClient('069 900 003', {}, 'barber')).rejects.toThrow()
      await expect(payload.find({ collection: 'clients', ...as('barber') })).rejects.toThrow()
      await expect(
        payload.findByID({ collection: 'clients', id: own.id, ...as('barber') }),
      ).rejects.toThrow()
      await expect(
        payload.update({
          collection: 'clients',
          id: own.id,
          data: { notes: 'x' },
          ...as('barber'),
        }),
      ).rejects.toThrow()
    })

    it('anonymous is denied', async () => {
      await expect(payload.find({ collection: 'clients', overrideAccess: false })).rejects.toThrow()
    })

    it('only admin deletes', async () => {
      const client = await newClient('069 900 010')
      await expect(
        payload.delete({ collection: 'clients', id: client.id, ...as('manager') }),
      ).rejects.toThrow()
      await payload.delete({ collection: 'clients', id: client.id, ...as('admin') })
    })

    it('email is returned to admin and manager', async () => {
      const client = await newClient('069 900 020', { email: 'client@test.local' }, 'admin')
      for (const who of ['admin', 'manager']) {
        const doc = await payload.findByID({ collection: 'clients', id: client.id, ...as(who) })
        expect(doc.email).toBe('client@test.local')
      }
    })
  })
})
