import { createLocalReq, getPayload, type Payload, type PayloadRequest } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { can, getStaffContext, type PolicyUser } from '@/access/policy'
import type { Role } from '@/access'
import { getWorkingIntervals, type BarberSchedule, type ScheduleException } from '@/crm/schedule'
import config from '@/payload.config'
import {
  BARBER_PRICE_INDEX,
  BARBER_USER_INDEX,
  up as barbersCrmUp,
} from '@/migrations/20261113_000001_barbers_crm'

/** Minimal Lexical document with one paragraph. */
const richText = (text: string) =>
  ({
    root: {
      type: 'root',
      format: '',
      indent: 0,
      version: 1,
      direction: 'ltr',
      children: [
        {
          type: 'paragraph',
          format: '',
          indent: 0,
          version: 1,
          direction: 'ltr',
          textFormat: 0,
          textStyle: '',
          children: [{ type: 'text', text, format: 0, style: '', mode: 'normal', detail: 0, version: 1 }],
        },
      ],
    },
  }) as never

/** Payload returns a field without read access as absent, and array fields as an empty array. */
const hiddenValue = (doc: unknown, field: string): boolean => {
  const value = (doc as Record<string, unknown>)[field]
  return value === undefined || (Array.isArray(value) && value.length === 0)
}

const u = (roles: string[], extra: Partial<NonNullable<PolicyUser>> = {}): PolicyUser => ({
  id: 'u1',
  roles,
  ...extra,
})

describe('policy: barbers (pure)', () => {
  it('anonymous reads only public working barbers, logged-in roles read all', () => {
    expect(can(null, 'read', 'barbers')).toEqual({
      and: [{ showOnSite: { equals: true } }, { active: { equals: true } }],
    })
    for (const role of ['admin', 'manager', 'barber', 'editor']) {
      expect(can(u([role]), 'read', 'barbers')).toBe(true)
    }
  })

  it('commission: admin and the linked barber read, only admin writes', () => {
    const own = { user: 'u1' }
    const other = { user: { id: 'u2' } }
    expect(can(u(['admin']), 'update', 'barbers.commission', other)).toBe(true)
    expect(can(u(['barber']), 'read', 'barbers.commission', own)).toBe(true)
    expect(can(u(['barber']), 'read', 'barbers.commission', other)).toBe(false)
    expect(can(u(['barber']), 'update', 'barbers.commission', own)).toBe(false)
    expect(can(u(['manager'], { locations: ['l1'] }), 'read', 'barbers.commission', own)).toBe(false)
    expect(can(u(['editor']), 'read', 'barbers.commission', own)).toBe(false)
    expect(can(null, 'read', 'barbers.commission', own)).toBe(false)
  })

  it('schedule: manager of the barber location reads and writes, barber reads own', () => {
    const doc = { user: 'u1', locations: ['l1'] }
    const manager = u(['manager'], { id: 'm', locations: ['l1'] })
    expect(can(manager, 'update', 'barbers.schedule', doc)).toBe(true)
    expect(can(manager, 'update', 'barbers.schedule', { locations: ['l2'] })).toBe(false)
    expect(can(u(['barber']), 'read', 'barbers.schedule', doc)).toBe(true)
    expect(can(u(['barber']), 'update', 'barbers.schedule', doc)).toBe(false)
    expect(can(u(['barber'], { id: 'u2' }), 'read', 'barbers.schedule', doc)).toBe(false)
    expect(can(null, 'read', 'barbers.schedule', doc)).toBe(false)
  })

  it('user link: admin only', () => {
    expect(can(u(['admin']), 'read', 'barbers.user')).toBe(true)
    for (const role of ['manager', 'barber', 'editor']) {
      expect(can(u([role]), 'read', 'barbers.user')).toBe(false)
    }
    expect(can(null, 'read', 'barbers.user')).toBe(false)
  })

  it('schedule-exceptions use the scope', () => {
    const scope = { barberId: 'b1', managedBarberIds: ['b1', 'b2'] }
    expect(can(u(['manager']), 'read', 'schedule-exceptions', undefined, scope)).toEqual({
      barber: { in: ['b1', 'b2'] },
    })
    expect(can(u(['barber']), 'read', 'schedule-exceptions', undefined, scope)).toEqual({
      barber: { equals: 'b1' },
    })
    expect(can(u(['barber']), 'create', 'schedule-exceptions', { barber: 'b1' }, scope)).toBe(false)
    expect(can(u(['manager']), 'create', 'schedule-exceptions', { barber: 'b3' }, scope)).toBe(false)
    expect(can(u(['manager']), 'create', 'schedule-exceptions', { barber: 'b2' }, scope)).toBe(true)
    expect(can(u(['editor']), 'read', 'schedule-exceptions', undefined, scope)).toBe(false)
    expect(can(null, 'read', 'schedule-exceptions')).toBe(false)
  })
})

describe('barbers, schedule-exceptions, barber-prices', () => {
  let payload: Payload
  type User = { id: string | number; roles?: Role[] | null; locations?: unknown }
  const users: Record<string, User> = {}
  const suffix = Date.now()
  let locA: string, locB: string
  let b1: string, b2: string, hidden: string
  let service: string, extra: string

  const as = (key: string) => ({
    user: { ...users[key], collection: 'users' as const } as never,
    overrideAccess: false as const,
  })
  const anon = { overrideAccess: false as const }

  // Generated create types require fields that have defaults; tests rely on the defaults.
  const create = (args: Record<string, unknown>) =>
    payload.create(args as never) as unknown as Promise<Record<string, unknown> & { id: string }>

  const makeUser = async (key: string, roles: Role[], locations?: string[]) => {
    users[key] = await payload.create({
      collection: 'users',
      data: { email: `${key}-${suffix}@test.local`, password: 'test', roles, locations },
    })
  }

  const schedule = (location: string) => [
    {
      weekday: '1',
      location,
      start: '09:00',
      end: '18:00',
      breaks: [{ start: '13:00', end: '14:00' }],
    },
  ]

  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    await Promise.all(Object.values(payload.db.collections).map((model) => model.init()))
    const req = await createLocalReq({}, payload)
    await barbersCrmUp({ payload, req } as Parameters<typeof barbersCrmUp>[0])

    locA = (await create({ collection: 'locations', data: { name: 'A' } })).id
    locB = (await create({ collection: 'locations', data: { name: 'B' } })).id

    await makeUser('admin', ['admin'])
    await makeUser('manager', ['manager'], [locA])
    await makeUser('barber', ['barber'])
    await makeUser('barber2', ['barber'])
    await makeUser('editor', ['editor'])

    service = (await create({ collection: 'services', data: { name: 'Cut', durationMinutes: 30, price: 30000 } })).id
    extra = (await create({ collection: 'extras', data: { name: 'Wash', durationMinutes: 0, price: 5000 } })).id

    const base = { description: 'Barber', about: richText('About') }
    b1 = (
      await create({
        collection: 'barbers',
        data: {
          ...base,
          name: 'One',
          order: 1,
          position: 'top barber',
          user: users.barber.id,
          locations: [locA],
          services: [service],
          commissionServicesPercent: 40,
          commissionExtrasPercent: 20,
          weeklySchedule: schedule(locA),
        },
        ...as('admin'),
      })
    ).id
    b2 = (
      await create({
        collection: 'barbers',
        data: {
          ...base,
          name: 'Two',
          order: 2,
          user: users.barber2.id,
          locations: [locB],
          commissionServicesPercent: 50,
          weeklySchedule: schedule(locB),
        },
        ...as('admin'),
      })
    ).id
    hidden = (
      await create({
        collection: 'barbers',
        data: { name: 'Staff only', order: 0, showOnSite: false, locations: [locA] },
        ...as('admin'),
      })
    ).id
  })

  afterAll(async () => {
    for (const collection of [
      'barber-prices',
      'schedule-exceptions',
      'barbers',
      'services',
      'extras',
      'locations',
      'users',
    ] as const) {
      await payload.delete({ collection, where: { id: { exists: true } } })
    }
  })

  describe('public API for the landing', () => {
    it('anonymous gets only public barbers sorted by order, without CRM fields', async () => {
      const { docs } = await payload.find({ collection: 'barbers', ...anon })
      expect(docs.map((d) => d.name)).toEqual(['One', 'Two'])
      for (const doc of docs) {
        expect(doc).toHaveProperty('description', 'Barber')
        expect(doc).toHaveProperty('about')
        for (const field of [
          'user',
          'commissionServicesPercent',
          'commissionExtrasPercent',
          'weeklySchedule',
          'locations',
          'services',
          'active',
          'color',
          'prices',
          'exceptions',
        ]) {
          expect(hiddenValue(doc, field)).toBe(true)
        }
      }
      expect(docs[0]).toMatchObject({ position: 'top barber', showOnSite: true, order: 1 })
    })

    it('a barber hidden from the site is not readable anonymously', async () => {
      await expect(payload.findByID({ collection: 'barbers', id: hidden, ...anon })).rejects.toThrow()
    })
  })

  describe('field-level read', () => {
    const read = async (id: string, who: string) =>
      (await payload.findByID({ collection: 'barbers', id, depth: 0, ...as(who) })) as unknown as Record<
        string,
        unknown
      >

    it('admin sees everything, including the user link and commission', async () => {
      const doc = await read(b1, 'admin')
      expect(doc).toMatchObject({
        user: users.barber.id,
        commissionServicesPercent: 40,
        commissionExtrasPercent: 20,
        active: true,
        onlineBooking: true,
      })
      expect(doc.color).toMatch(/^#[0-9A-F]{6}$/i)
    })

    it('a barber sees own commission and schedule, not another barber’s; never the user link', async () => {
      const own = await read(b1, 'barber')
      expect(own).toMatchObject({ commissionServicesPercent: 40, commissionExtrasPercent: 20 })
      expect(own.weeklySchedule).toHaveLength(1)
      expect(hiddenValue(own, 'user')).toBe(true)

      const other = await read(b2, 'barber')
      expect(hiddenValue(other, 'commissionServicesPercent')).toBe(true)
      expect(hiddenValue(other, 'weeklySchedule')).toBe(true)
      expect(hiddenValue(other, 'user')).toBe(true)
      // Colors and locations of others are needed for the calendar.
      expect(other).toHaveProperty('color')
      expect(other).toHaveProperty('locations')
    })

    it('a manager never sees commission; sees schedules of barbers in own locations only', async () => {
      const inOwn = await read(b1, 'manager')
      expect(hiddenValue(inOwn, 'commissionServicesPercent')).toBe(true)
      expect(hiddenValue(inOwn, 'commissionExtrasPercent')).toBe(true)
      expect(hiddenValue(inOwn, 'user')).toBe(true)
      expect(inOwn.weeklySchedule).toHaveLength(1)

      const elsewhere = await read(b2, 'manager')
      expect(hiddenValue(elsewhere, 'weeklySchedule')).toBe(true)
      expect(hiddenValue(elsewhere, 'commissionServicesPercent')).toBe(true)
    })

    it('an editor sees the profile but no CRM fields', async () => {
      const doc = await read(b1, 'editor')
      expect(doc).toHaveProperty('name', 'One')
      for (const field of ['user', 'commissionServicesPercent', 'weeklySchedule', 'locations', 'color']) {
        expect(hiddenValue(doc, field)).toBe(true)
      }
    })
  })

  describe('writes', () => {
    it('a manager edits the weekly schedule of own-location barbers only, nothing else', async () => {
      await payload.update({
        collection: 'barbers',
        id: b1,
        data: {
          weeklySchedule: [...schedule(locA), { weekday: '2', location: locA, start: '10:00', end: '16:00' }],
          name: 'Hacked',
          commissionServicesPercent: 99,
          active: false,
        } as never,
        ...as('manager'),
      })
      const stored = await payload.findByID({ collection: 'barbers', id: b1, depth: 0 })
      expect(stored.weeklySchedule).toHaveLength(2)
      expect(stored).toMatchObject({ name: 'One', commissionServicesPercent: 40, active: true })

      await expect(
        payload.update({
          collection: 'barbers',
          id: b2,
          data: { weeklySchedule: [] },
          ...as('manager'),
        }),
      ).rejects.toThrow()
    })

    it('barber and editor cannot change the schedule, commission or user link', async () => {
      await expect(
        payload.update({ collection: 'barbers', id: b1, data: { weeklySchedule: [] }, ...as('barber') }),
      ).rejects.toThrow()

      await payload.update({
        collection: 'barbers',
        id: b1,
        data: { description: 'Edited', weeklySchedule: [], commissionServicesPercent: 1, user: null } as never,
        ...as('editor'),
      })
      const stored = await payload.findByID({ collection: 'barbers', id: b1, depth: 0 })
      expect(stored).toMatchObject({ description: 'Edited', commissionServicesPercent: 40, user: users.barber.id })
      expect(stored.weeklySchedule).toHaveLength(2)
    })

    it('description/about are required only when shown on the site (A12)', async () => {
      await expect(
        create({ collection: 'barbers', data: { name: 'No profile', locations: [locA] }, ...as('admin') }),
      ).rejects.toMatchObject({
        data: {
          errors: expect.arrayContaining([
            expect.objectContaining({ path: 'description' }),
            expect.objectContaining({ path: 'about' }),
          ]),
        },
      })
      await expect(
        create({
          collection: 'barbers',
          data: { name: 'Empty about', description: 'x', about: richText(' '), locations: [locA] },
          ...as('admin'),
        }),
      ).rejects.toMatchObject({ data: { errors: [expect.objectContaining({ path: 'about' })] } })
    })

    it('validates the weekly schedule', async () => {
      const update = (weeklySchedule: unknown[]) =>
        payload.update({ collection: 'barbers', id: b1, data: { weeklySchedule } as never, ...as('admin') })
      const row = { weekday: '3', location: locA, start: '09:00', end: '18:00' }
      await expect(update([row, { ...row }])).rejects.toThrow()
      await expect(update([{ ...row, end: '08:00' }])).rejects.toThrow()
      await expect(update([{ ...row, start: '9:00' }])).rejects.toThrow()
      await expect(update([{ ...row, breaks: [{ start: '17:00', end: '19:00' }] }])).rejects.toThrow()
      await expect(
        update([{ ...row, breaks: [{ start: '12:00', end: '13:00' }, { start: '12:30', end: '14:00' }] }]),
      ).rejects.toThrow()
      await expect(update([{ ...row, location: locB }])).rejects.toThrow()
      await expect(update([row, ...Array.from({ length: 7 }, (_, i) => ({ ...row, weekday: String(i + 1) }))])).rejects.toThrow()
    })

    it('validates color and commission range', async () => {
      await expect(
        payload.update({ collection: 'barbers', id: b1, data: { color: 'red' }, ...as('admin') }),
      ).rejects.toThrow()
      await expect(
        payload.update({ collection: 'barbers', id: b1, data: { commissionExtrasPercent: 101 }, ...as('admin') }),
      ).rejects.toThrow()
    })

    it('barbers.user is unique and must be a barber-role user', async () => {
      await expect(
        payload.update({ collection: 'barbers', id: b2, data: { user: users.barber.id } as never, ...as('admin') }),
      ).rejects.toMatchObject({ data: { errors: [expect.objectContaining({ path: 'user' })] } })
      await expect(
        payload.update({ collection: 'barbers', id: hidden, data: { user: users.editor.id } as never, ...as('admin') }),
      ).rejects.toMatchObject({ data: { errors: [expect.objectContaining({ path: 'user' })] } })
      // The partial unique index also guards the database.
      await expect(
        payload.db.collections.barbers.collection.updateOne(
          { _id: (await payload.db.collections.barbers.findById(b2))!._id },
          { $set: { user: (await payload.db.collections.barbers.findById(b1))!.user } },
        ),
      ).rejects.toThrow(/duplicate key/)
    })

    it('with a single active location a new barber gets it by default', async () => {
      await payload.update({ collection: 'locations', id: locB, data: { active: false } })
      try {
        const doc = await create({
          collection: 'barbers',
          data: { name: 'By editor', description: 'x', about: richText('x') },
          ...as('editor'),
        })
        const stored = await payload.findByID({ collection: 'barbers', id: doc.id, depth: 0 })
        expect(stored).toMatchObject({ locations: [locA], active: true, showOnSite: true, onlineBooking: true })
        expect(stored.color).toMatch(/^#[0-9A-F]{6}$/i)
        expect(stored.user ?? null).toBeNull()
        await payload.delete({ collection: 'barbers', id: doc.id })
      } finally {
        await payload.update({ collection: 'locations', id: locB, data: { active: true } })
      }
    })
  })

  describe('staff context', () => {
    it('links the barber user to the barber and the manager to barbers of own locations', async () => {
      const req = (await createLocalReq({}, payload)) as PayloadRequest
      req.user = { ...users.barber, collection: 'users' } as never
      expect((await getStaffContext(req)).barberId).toBe(b1)

      req.user = { ...users.manager, collection: 'users' } as never
      expect((await getStaffContext(req)).managedBarberIds.sort()).toEqual([b1, hidden].sort())

      req.user = { ...users.editor, collection: 'users' } as never
      expect(await getStaffContext(req)).toMatchObject({ barberId: null, managedBarberIds: [] })
    })
  })

  describe('schedule-exceptions', () => {
    const exceptionIds: string[] = []
    const add = async (who: string, data: Record<string, unknown>) => {
      const doc = await create({ collection: 'schedule-exceptions', data, ...as(who) })
      exceptionIds.push(doc.id)
      return doc
    }

    it('admin creates exceptions; one barber’s exceptions cannot overlap', async () => {
      await add('admin', { barber: b1, kind: 'vacation', dateFrom: '2026-12-01', dateTo: '2026-12-07' })
      await expect(
        add('admin', { barber: b1, kind: 'day_off', dateFrom: '2026-12-07', dateTo: '2026-12-07' }),
      ).rejects.toMatchObject({ data: { errors: [expect.objectContaining({ path: 'dateFrom' })] } })
      // Another barber on the same dates is fine; adjacent dates are fine.
      await add('admin', { barber: b2, kind: 'sick', dateFrom: '2026-12-01', dateTo: '2026-12-03' })
      await add('admin', { barber: b1, kind: 'day_off', dateFrom: '2026-12-08', dateTo: '2026-12-08' })
    })

    it('validates dates and custom hours', async () => {
      await expect(
        add('admin', { barber: b1, kind: 'day_off', dateFrom: '2027-01-05', dateTo: '2027-01-04' }),
      ).rejects.toMatchObject({ data: { errors: [expect.objectContaining({ path: 'dateTo' })] } })
      await expect(
        add('admin', { barber: b1, kind: 'day_off', dateFrom: '05.01.2027', dateTo: '2027-01-05' }),
      ).rejects.toThrow()
      await expect(
        add('admin', { barber: b1, kind: 'custom_hours', dateFrom: '2027-01-05', dateTo: '2027-01-05' }),
      ).rejects.toThrow()
      await expect(
        add('admin', {
          barber: b1,
          kind: 'custom_hours',
          dateFrom: '2027-01-05',
          dateTo: '2027-01-05',
          location: locB,
          start: '10:00',
          end: '12:00',
        }),
      ).rejects.toMatchObject({ data: { errors: [expect.objectContaining({ path: 'location' })] } })
    })

    it('custom_hours defaults to the barber’s only location; other kinds drop hours', async () => {
      const custom = await add('admin', {
        barber: b1,
        kind: 'custom_hours',
        dateFrom: '2027-01-05',
        dateTo: '2027-01-05',
        start: '10:00',
        end: '14:00',
        breaks: [{ start: '12:00', end: '12:30' }],
      })
      expect(custom.location).toMatchObject({ id: locA })

      const dayOff = await add('admin', {
        barber: b1,
        kind: 'day_off',
        dateFrom: '2027-01-06',
        dateTo: '2027-01-06',
        start: '10:00',
        end: '14:00',
      })
      expect(dayOff).toMatchObject({ start: null, end: null, location: null })
    })

    it('getWorkingIntervals works on stored documents', async () => {
      const barber = await payload.findByID({ collection: 'barbers', id: b1, depth: 0 })
      const { docs } = await payload.find({
        collection: 'schedule-exceptions',
        where: { barber: { equals: b1 } },
        depth: 0,
        pagination: false,
      })
      const exceptions = docs as unknown as ScheduleException[]
      const schedule = barber as unknown as BarberSchedule
      // 2027-01-05 is a Tuesday: custom hours instead of the 10:00–16:00 template row.
      expect(getWorkingIntervals(schedule, '2027-01-05', exceptions)).toMatchObject({
        working: true,
        source: 'exception',
        locationId: locA,
        intervals: [
          { startTime: '10:00', endTime: '12:00' },
          { startTime: '12:30', endTime: '14:00' },
        ],
      })
      // 2026-12-07 is a Monday inside the vacation.
      expect(getWorkingIntervals(schedule, '2026-12-07', exceptions)).toMatchObject({
        working: false,
        reason: 'vacation',
      })
      // 2026-12-14 is a Monday without exceptions.
      expect(getWorkingIntervals(schedule, '2026-12-14', exceptions)).toMatchObject({
        working: true,
        locationId: locA,
        intervals: [{ startTime: '09:00' }, { startTime: '14:00', endTime: '18:00' }],
      })
    })

    it('a manager manages exceptions of own-location barbers only', async () => {
      const own = await add('manager', { barber: b1, kind: 'day_off', dateFrom: '2027-02-01', dateTo: '2027-02-01' })
      await expect(
        add('manager', { barber: b2, kind: 'day_off', dateFrom: '2027-02-01', dateTo: '2027-02-01' }),
      ).rejects.toThrow()
      await expect(
        payload.update({ collection: 'schedule-exceptions', id: own.id, data: { barber: b2 }, ...as('manager') }),
      ).rejects.toThrow()
      await payload.update({
        collection: 'schedule-exceptions',
        id: own.id,
        data: { comment: 'ok' },
        ...as('manager'),
      })

      const { docs } = await payload.find({ collection: 'schedule-exceptions', depth: 0, ...as('manager') })
      expect(new Set(docs.map((d) => d.barber))).toEqual(new Set([b1]))

      const foreign = exceptionIds.length > 0
        ? (await payload.find({ collection: 'schedule-exceptions', where: { barber: { equals: b2 } }, depth: 0 })).docs[0]
        : undefined
      await expect(
        payload.delete({ collection: 'schedule-exceptions', id: foreign!.id, ...as('manager') }),
      ).rejects.toThrow()
      await payload.delete({ collection: 'schedule-exceptions', id: own.id, ...as('manager') })
    })

    it('a barber reads only own exceptions and cannot write; editor and anonymous see nothing', async () => {
      const { docs } = await payload.find({ collection: 'schedule-exceptions', depth: 0, ...as('barber') })
      expect(docs.length).toBeGreaterThan(0)
      expect(new Set(docs.map((d) => d.barber))).toEqual(new Set([b1]))
      await expect(
        add('barber', { barber: b1, kind: 'day_off', dateFrom: '2027-03-01', dateTo: '2027-03-01' }),
      ).rejects.toThrow()

      await expect(payload.find({ collection: 'schedule-exceptions', ...as('editor') })).rejects.toThrow()
      await expect(payload.find({ collection: 'schedule-exceptions', ...anon })).rejects.toThrow()
    })
  })

  describe('barber-prices', () => {
    it('admin overrides price/duration; the (barber, item) pair is unique', async () => {
      const price = await create({
        collection: 'barber-prices',
        data: { barber: b1, item: { relationTo: 'services', value: service }, price: 35000 },
        ...as('admin'),
      })
      expect(price).toMatchObject({ price: 35000 })

      await expect(
        create({
          collection: 'barber-prices',
          data: { barber: b1, item: { relationTo: 'services', value: service }, durationMinutes: 45 },
          ...as('admin'),
        }),
      ).rejects.toMatchObject({ data: { errors: [expect.objectContaining({ path: 'item' })] } })

      // Same item for another barber, and an extra for the same barber: fine.
      await create({
        collection: 'barber-prices',
        data: { barber: b2, item: { relationTo: 'services', value: service }, durationMinutes: 45 },
        ...as('admin'),
      })
      await create({
        collection: 'barber-prices',
        data: { barber: b1, item: { relationTo: 'extras', value: extra }, durationMinutes: 0 },
        ...as('admin'),
      })

      // The unique index also guards the database.
      await expect(
        payload.db.collections['barber-prices'].collection.insertOne({
          barber: (await payload.db.collections['barber-prices'].findById(price.id))!.barber,
          item: (await payload.db.collections['barber-prices'].findById(price.id))!.item,
        }),
      ).rejects.toThrow(/duplicate key/)
    })

    it('validates duration overrides by item type', async () => {
      await expect(
        create({
          collection: 'barber-prices',
          data: { barber: hidden, item: { relationTo: 'services', value: service }, durationMinutes: 7 },
          ...as('admin'),
        }),
      ).rejects.toThrow()
      await expect(
        create({
          collection: 'barber-prices',
          data: { barber: hidden, item: { relationTo: 'services', value: service }, price: -1 },
          ...as('admin'),
        }),
      ).rejects.toThrow()
    })

    it('everyone reads, only admin writes', async () => {
      const { totalDocs } = await payload.find({ collection: 'barber-prices', ...anon })
      expect(totalDocs).toBeGreaterThanOrEqual(3)
      for (const who of ['manager', 'barber', 'editor']) {
        await expect(
          create({
            collection: 'barber-prices',
            data: { barber: hidden, item: { relationTo: 'extras', value: extra }, price: 1 },
            ...as(who),
          }),
        ).rejects.toThrow()
      }
    })

    it('admin sees the overrides on the barber (join), anonymous does not', async () => {
      const doc = (await payload.findByID({ collection: 'barbers', id: b1, depth: 0, ...as('admin') })) as {
        prices?: { docs?: unknown[] }
      }
      expect(doc.prices?.docs).toHaveLength(2)
    })
  })

  describe('migration: CRM defaults for existing barbers', () => {
    it('fills active/showOnSite/onlineBooking/color/locations and keeps existing values', async () => {
      const model = payload.db.collections.barbers
      const legacy = await model.collection.insertMany([
        { name: 'Legacy 1', order: 10, description: { ru: 'x' } },
        { name: 'Legacy 2', order: 11, description: { ru: 'y' }, color: '#123456', showOnSite: false },
      ])
      const req = await createLocalReq({}, payload)
      await barbersCrmUp({ payload, req } as Parameters<typeof barbersCrmUp>[0])
      await barbersCrmUp({ payload, req } as Parameters<typeof barbersCrmUp>[0])

      const [first, second] = await Promise.all(
        Object.values(legacy.insertedIds).map((id) => model.collection.findOne({ _id: id })),
      )
      expect(first).toMatchObject({ active: true, showOnSite: true, onlineBooking: true })
      expect(first!.color).toMatch(/^#[0-9A-F]{6}$/i)
      expect(first!.locations.map(String)).toHaveLength(1)
      expect(second).toMatchObject({ color: '#123456', showOnSite: false, active: true })

      const indexes = (await model.collection.indexes()).map((index) => index.name)
      expect(indexes).toContain(BARBER_USER_INDEX)
      const priceIndexes = (await payload.db.collections['barber-prices'].collection.indexes()).map(
        (index) => index.name,
      )
      expect(priceIndexes).toContain(BARBER_PRICE_INDEX)

      // Existing barbers created through the API were not touched.
      const one = await payload.findByID({ collection: 'barbers', id: b1, depth: 0 })
      expect(one.locations).toEqual([locA])
      await model.collection.deleteMany({ _id: { $in: Object.values(legacy.insertedIds) } })
    })
  })
})
