import { getPayload, Payload } from 'payload'
import type { Role } from '@/access'
import config from '@/payload.config'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

let payload: Payload
const created: { collection: 'users'; id: string | number }[] = []

const makeUser = async (roles: Role[]) => {
  const user = await payload.create({
    collection: 'users',
    data: { email: `${roles.join('-')}-${Date.now()}@test.local`, password: 'test', roles },
  })
  created.push({ collection: 'users', id: user.id })
  return user
}

describe('access control', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    // Make sure collections/indexes exist before transactions start (avoids lock timeouts).
    await Promise.all(Object.values(payload.db.collections).map((model) => model.init()))
  })

  afterAll(async () => {
    for (const { collection, id } of created) await payload.delete({ collection, id })
  })

  it('denies anonymous user operations', async () => {
    const data = { email: 'anon@test.local', password: 'test', roles: ['admin' as const] }
    await expect(
      payload.create({ collection: 'users', data, overrideAccess: false }),
    ).rejects.toThrow()

    await expect(payload.find({ collection: 'users', overrideAccess: false })).rejects.toThrow()
  })

  it('denies anonymous writes to content', async () => {
    await expect(
      payload.create({
        collection: 'barbers',
        data: { name: 'x', description: 'x', about: undefined as never },
        overrideAccess: false,
      }),
    ).rejects.toThrow()
  })

  it('allows anonymous reads of public content', async () => {
    await expect(
      payload.find({ collection: 'barbers', overrideAccess: false }),
    ).resolves.toBeDefined()
  })

  it('lets an editor read only themselves and forbids user management', async () => {
    const admin = await makeUser(['admin'])
    const editor = await makeUser(['editor'])

    const { docs } = await payload.find({
      collection: 'users',
      user: { ...editor, collection: 'users' },
      overrideAccess: false,
    })
    expect(docs.map((d) => d.id)).toEqual([editor.id])

    await expect(
      payload.delete({
        collection: 'users',
        id: admin.id,
        user: { ...editor, collection: 'users' },
        overrideAccess: false,
      }),
    ).rejects.toThrow()
  })

  it('lets an admin read all users', async () => {
    const admin = await makeUser(['admin'])
    const { totalDocs } = await payload.find({
      collection: 'users',
      user: { ...admin, collection: 'users' },
      overrideAccess: false,
    })
    expect(totalDocs).toBeGreaterThanOrEqual(1)
  })
})

describe('roles: users, locations, booking-settings (stage 1)', () => {
  type U = Awaited<ReturnType<typeof makeUser>>
  let admin: U, manager: U, barber: U, editor: U
  let locA: string, locB: string, locInactive: string

  const as = (user: U) => ({
    user: { ...user, collection: 'users' as const },
    overrideAccess: false as const,
  })

  beforeAll(async () => {
    payload ??= await getPayload({ config: await config })
    const mk = async (name: string, active = true) =>
      String((await payload.create({ collection: 'locations', data: { name, active } })).id)
    locA = await mk('A')
    locB = await mk('B')
    locInactive = await mk('Closed', false)

    admin = await makeUser(['admin'])
    barber = await makeUser(['barber'])
    editor = await makeUser(['editor'])
    manager = await payload.create({
      collection: 'users',
      data: {
        email: `manager-${Date.now()}@test.local`,
        password: 'test',
        roles: ['manager'],
        locations: [locA],
      },
    })
    created.push({ collection: 'users', id: manager.id })
  })

  afterAll(async () => {
    await payload.delete({
      collection: 'locations',
      where: { id: { in: [locA, locB, locInactive] } },
    })
  })

  describe('users', () => {
    it('admin reads everybody, other roles read only themselves', async () => {
      const all = await payload.find({ collection: 'users', ...as(admin) })
      expect(all.totalDocs).toBeGreaterThanOrEqual(4)
      for (const user of [manager, barber, editor]) {
        const { docs } = await payload.find({ collection: 'users', ...as(user) })
        expect(docs.map((d) => d.id)).toEqual([user.id])
      }
    })

    it('only admin creates users', async () => {
      for (const user of [manager, barber, editor]) {
        await expect(
          payload.create({
            collection: 'users',
            data: { email: `x-${Date.now()}@test.local`, password: 'test', roles: ['barber'] },
            ...as(user),
          }),
        ).rejects.toThrow()
      }
      const newUser = await payload.create({
        collection: 'users',
        data: { email: `b-${Date.now()}@test.local`, password: 'test', roles: ['barber'] },
        ...as(admin),
      })
      created.push({ collection: 'users', id: newUser.id })
      expect(newUser.roles).toEqual(['barber'])
    })

    it('admin can create a manager only with locations', async () => {
      await expect(
        payload.create({
          collection: 'users',
          data: { email: `m-${Date.now()}@test.local`, password: 'test', roles: ['manager'] },
          ...as(admin),
        }),
      ).rejects.toMatchObject({
        data: { errors: [expect.objectContaining({ path: 'locations' })] },
      })
    })

    it('manager cannot grant themselves a role or a location', async () => {
      const updated = await payload.update({
        collection: 'users',
        id: manager.id,
        data: { roles: ['admin', 'manager'], locations: [locA, locB], language: 'ro' },
        depth: 0,
        ...as(manager),
      })
      expect(updated.roles).toEqual(['manager'])
      expect(updated.locations).toEqual([locA])
      expect(updated.language).toBe('ro')

      const stored = await payload.findByID({ collection: 'users', id: manager.id, depth: 0 })
      expect(stored.roles).toEqual(['manager'])
      expect(stored.locations).toEqual([locA])
    })

    it('barber and editor cannot grant themselves roles or locations either', async () => {
      for (const user of [barber, editor]) {
        const updated = await payload.update({
          collection: 'users',
          id: user.id,
          data: { roles: ['admin'], locations: [locA] },
          depth: 0,
          ...as(user),
        })
        expect(updated.roles).toEqual(user.roles)
        expect(updated.locations ?? []).toEqual([])
      }
    })

    it('non-admins cannot update or delete other users', async () => {
      for (const user of [manager, barber, editor]) {
        await expect(
          payload.update({
            collection: 'users',
            id: admin.id,
            data: { language: 'en' },
            ...as(user),
          }),
        ).rejects.toThrow()
        const victim = user === barber ? editor : barber
        await expect(
          payload.delete({ collection: 'users', id: victim.id, ...as(user) }),
        ).rejects.toThrow()
      }
    })

    it('admin assigns roles and locations', async () => {
      const updated = await payload.update({
        collection: 'users',
        id: barber.id,
        data: { roles: ['barber', 'manager'], locations: [locB] },
        depth: 0,
        ...as(admin),
      })
      expect(updated.roles).toEqual(['barber', 'manager'])
      expect(updated.locations).toEqual([locB])
      barber = await payload.update({
        collection: 'users',
        id: barber.id,
        data: { roles: ['barber'], locations: [] },
        ...as(admin),
      })
    })
  })

  describe('locations', () => {
    const ids = async (user?: U) =>
      (
        await payload.find({
          collection: 'locations',
          where: { id: { in: [locA, locB, locInactive] } },
          depth: 0,
          ...(user ? as(user) : { overrideAccess: false }),
        })
      ).docs
        .map((d) => String(d.id))
        .sort()

    it('anonymous reads only active locations', async () => {
      expect(await ids()).toEqual([locA, locB].sort())
    })

    it('admin, barber and editor read all locations', async () => {
      for (const user of [admin, barber, editor])
        expect(await ids(user)).toEqual([locA, locB, locInactive].sort())
    })

    it('manager reads only own locations', async () => {
      expect(await ids(manager)).toEqual([locA])
    })

    it('only admin creates, updates and deletes locations', async () => {
      for (const user of [manager, barber, editor]) {
        await expect(
          payload.create({
            collection: 'locations',
            data: { name: 'X', active: true },
            ...as(user),
          }),
        ).rejects.toThrow()
        await expect(
          payload.update({
            collection: 'locations',
            id: locA,
            data: { name: 'X', active: true },
            ...as(user),
          }),
        ).rejects.toThrow()
        await expect(
          payload.delete({ collection: 'locations', id: locA, ...as(user) }),
        ).rejects.toThrow()
      }
      await expect(
        payload.create({
          collection: 'locations',
          data: { name: 'X', active: true },
          overrideAccess: false,
        }),
      ).rejects.toThrow()

      const loc = await payload.create({
        collection: 'locations',
        data: { name: 'New', active: true, phone: '069 123 456' },
        ...as(admin),
      })
      expect(loc.active).toBe(true)
      expect(loc.phone).toBe('+37369123456')
      await payload.delete({ collection: 'locations', id: loc.id, ...as(admin) })
    })

    it('rejects an invalid phone', async () => {
      await expect(
        payload.create({
          collection: 'locations',
          data: { name: 'Y', active: true, phone: '123' },
          ...as(admin),
        }),
      ).rejects.toMatchObject({ data: { errors: [expect.objectContaining({ path: 'phone' })] } })
    })
  })

  describe('booking-settings', () => {
    beforeAll(async () => {
      await payload.updateGlobal({
        slug: 'booking-settings',
        data: { senderName: 'LevelUp', replyTo: 'hello@test.local' },
      })
    })

    it('anonymous reads public fields with defaults, but not sender settings', async () => {
      const settings = await payload.findGlobal({ slug: 'booking-settings', overrideAccess: false })
      expect(settings).toMatchObject({
        slotStepMinutes: 15,
        minLeadMinutes: 120,
        horizonDays: 30,
        clientCancelMinHours: 3,
        reminderHoursBefore: 24,
        bufferMinutes: 0,
        onlineBookingEnabled: true,
      })
      expect(settings.senderName).toBeUndefined()
      expect(settings.replyTo).toBeUndefined()
    })

    it('every role reads all settings', async () => {
      for (const user of [admin, manager, barber, editor]) {
        const settings = await payload.findGlobal({ slug: 'booking-settings', ...as(user) })
        expect(settings.senderName).toBe('LevelUp')
      }
    })

    it('only admin updates settings', async () => {
      for (const user of [manager, barber, editor]) {
        await expect(
          payload.updateGlobal({ slug: 'booking-settings', data: { horizonDays: 7 }, ...as(user) }),
        ).rejects.toThrow()
      }
      await expect(
        payload.updateGlobal({
          slug: 'booking-settings',
          data: { horizonDays: 7 },
          overrideAccess: false,
        }),
      ).rejects.toThrow()

      const updated = await payload.updateGlobal({
        slug: 'booking-settings',
        data: { horizonDays: 45 },
        ...as(admin),
      })
      expect(updated.horizonDays).toBe(45)
      await payload.updateGlobal({ slug: 'booking-settings', data: { horizonDays: 30 } })
    })

    it('validates integer ranges', async () => {
      await expect(
        payload.updateGlobal({
          slug: 'booking-settings',
          data: { slotStepMinutes: 2.5 },
          ...as(admin),
        }),
      ).rejects.toThrow()
    })
  })

  describe('site content stays as before', () => {
    it('editor still edits content; manager and barber only read it', async () => {
      await expect(
        payload.updateGlobal({ slug: 'about-us', data: {}, ...as(editor) }),
      ).resolves.toBeDefined()
      for (const user of [manager, barber]) {
        await expect(
          payload.updateGlobal({ slug: 'about-us', data: {}, ...as(user) }),
        ).rejects.toThrow()
        await expect(payload.findGlobal({ slug: 'about-us', ...as(user) })).resolves.toBeDefined()
      }
    })
  })
})
