import { createLocalReq, getPayload, type Payload, type PayloadRequest } from 'payload'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { computeSlots } from '@/crm/slots'
import { loadSlotInput, type BusySource, type SlotQuery } from '@/crm/slots.loader'
import { localToInstant } from '@/crm/time'
import config from '@/payload.config'

// 2026-11-16 is a Monday.
const MON = '2026-11-16'
const NOW = new Date('2026-11-14T08:00:00Z')

describe('loadSlotInput', () => {
  let payload: Payload
  let req: PayloadRequest
  let locA: string, locB: string
  let service: string, otherService: string, extra1: string, extra2: string
  let b1: string, b2: string, b3: string

  const create = (args: Record<string, unknown>) =>
    payload.create(args as never) as unknown as Promise<{ id: string }>

  const weekly = (location: string) => [
    {
      weekday: '1',
      location,
      start: '09:00',
      end: '18:00',
      breaks: [{ start: '13:00', end: '14:00' }],
    },
  ]

  const barber = async (name: string, order: number, location: string, services: string[]) =>
    (
      await create({
        collection: 'barbers',
        data: {
          name,
          order,
          showOnSite: false,
          locations: [location],
          services,
          weeklySchedule: weekly(location),
        },
      })
    ).id

  const query = (overrides: Partial<SlotQuery> = {}): SlotQuery => ({
    mode: 'online',
    locationId: locA,
    date: MON,
    serviceId: service,
    extraIds: [extra1, extra2],
    now: NOW,
    ...overrides,
  })

  /** Counts every Local API read made through `payload` while running `fn`. */
  const countQueries = async (fn: () => Promise<unknown>) => {
    const find = vi.spyOn(payload, 'find')
    const findGlobal = vi.spyOn(payload, 'findGlobal')
    const findByID = vi.spyOn(payload, 'findByID')
    try {
      await fn()
      return find.mock.calls.length + findGlobal.mock.calls.length + findByID.mock.calls.length
    } finally {
      find.mockRestore()
      findGlobal.mockRestore()
      findByID.mockRestore()
    }
  }

  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    await Promise.all(Object.values(payload.db.collections).map((model) => model.init()))
    req = await createLocalReq({}, payload) // anonymous: the loader must not depend on the caller's access

    locA = (await create({ collection: 'locations', data: { name: 'A' } })).id
    locB = (await create({ collection: 'locations', data: { name: 'B' } })).id
    service = (
      await create({
        collection: 'services',
        data: { name: 'Cut', durationMinutes: 30, price: 30000 },
      })
    ).id
    otherService = (
      await create({
        collection: 'services',
        data: { name: 'Beard', durationMinutes: 20, price: 20000 },
      })
    ).id
    extra1 = (
      await create({
        collection: 'extras',
        data: { name: 'Wash', durationMinutes: 10, price: 5000 },
      })
    ).id
    extra2 = (
      await create({ collection: 'extras', data: { name: 'Wax', durationMinutes: 5, price: 3000 } })
    ).id

    b2 = await barber('Two', 2, locA, [service])
    b1 = await barber('One', 1, locA, [service, otherService])
    b3 = await barber('Three', 3, locB, [service])

    await create({
      collection: 'barber-prices',
      data: { barber: b1, item: { relationTo: 'services', value: service }, durationMinutes: 45 },
    })
    await create({
      collection: 'barber-prices',
      data: { barber: b2, item: { relationTo: 'extras', value: extra1 }, durationMinutes: 20 },
    })
    // Price-only override keeps the base duration; an override of an unselected item is ignored.
    await create({
      collection: 'barber-prices',
      data: { barber: b2, item: { relationTo: 'extras', value: extra2 }, price: 100 },
    })
    await create({
      collection: 'barber-prices',
      data: {
        barber: b1,
        item: { relationTo: 'services', value: otherService },
        durationMinutes: 90,
      },
    })

    await create({
      collection: 'schedule-exceptions',
      data: { barber: b2, kind: 'day_off', dateFrom: MON, dateTo: MON },
    })
    await create({
      collection: 'schedule-exceptions',
      data: { barber: b1, kind: 'vacation', dateFrom: '2026-12-01', dateTo: '2026-12-10' },
    })
  })

  afterAll(async () => {
    for (const collection of [
      'barber-prices',
      'schedule-exceptions',
      'barbers',
      'services',
      'extras',
      'locations',
    ] as const) {
      await payload.delete({ collection, where: { id: { exists: true } } })
    }
  })

  it('"any barber": loads the barbers of the location sorted by order, with per-barber durations', async () => {
    const input = await loadSlotInput(payload, query(), req)
    expect(input).toMatchObject({ mode: 'online', date: MON, locationId: locA, now: NOW })
    expect(input.settings).toEqual({
      slotStepMinutes: 15,
      minLeadMinutes: 120,
      horizonDays: 30,
      bufferMinutes: 0,
      onlineBookingEnabled: true,
    })
    expect(input.barbers.map((b) => b.id)).toEqual([b1, b2])
    const [one, two] = input.barbers
    expect(one).toMatchObject({
      order: 1,
      active: true,
      onlineBooking: true,
      providesService: true,
    })
    expect(one.durationMinutes).toBe(45 + 10 + 5) // service override
    expect(two.durationMinutes).toBe(30 + 20 + 5) // extra override; price-only override keeps 5
    expect(one.exceptions).toEqual([])
    expect(two.exceptions).toMatchObject([{ kind: 'day_off', dateFrom: MON, dateTo: MON }])
    expect(one.schedule.weeklySchedule).toMatchObject([
      {
        weekday: 1,
        location: locA,
        start: '09:00',
        end: '18:00',
        breaks: [{ start: '13:00', end: '14:00' }],
      },
    ])

    // b2 is off that day, so all slots belong to b1 with its own duration.
    const slots = computeSlots(input)
    expect(slots[0].time).toBe('09:00')
    expect(slots.every((s) => s.barbers.length === 1 && s.barbers[0].barberId === b1)).toBe(true)
    expect(slots.find((s) => s.time === '12:00')!.barbers[0].durationMinutes).toBe(60)
  })

  it('a specific barber: only that one; providesService reflects barbers.services', async () => {
    const input = await loadSlotInput(
      payload,
      query({ barberId: b2, serviceId: otherService, extraIds: [] }),
      req,
    )
    expect(input.barbers.map((b) => b.id)).toEqual([b2])
    expect(input.barbers[0]).toMatchObject({ providesService: false, durationMinutes: 20 })
  })

  it('passes the day range widened by the buffer to the busy source and distributes intervals per barber', async () => {
    await payload.updateGlobal({ slug: 'booking-settings', data: { bufferMinutes: 10 } })
    try {
      const busySource = vi.fn<BusySource>(async ({ barberIds }) =>
        barberIds.map((barberId, i) => ({
          barberId,
          kind: 'appointment' as const,
          start: localToInstant(MON, i === 0 ? '10:00' : '11:00'),
          end: localToInstant(MON, i === 0 ? '10:30' : '11:30'),
        })),
      )
      const input = await loadSlotInput(payload, query(), req, { busySource })
      expect(busySource).toHaveBeenCalledTimes(1)
      const args = busySource.mock.calls[0][0]
      expect(args.barberIds).toEqual([b1, b2])
      expect(args.from).toEqual(localToInstant('2026-11-15', '23:50'))
      expect(args.to).toEqual(localToInstant('2026-11-17', '00:10'))
      expect(args.req).toBe(req)
      expect(input.settings.bufferMinutes).toBe(10)
      expect(input.barbers[0].busy).toEqual([
        {
          kind: 'appointment',
          start: localToInstant(MON, '10:00'),
          end: localToInstant(MON, '10:30'),
        },
      ])
      expect(input.barbers[1].busy[0].start).toEqual(localToInstant(MON, '11:00'))
    } finally {
      await payload.updateGlobal({ slug: 'booking-settings', data: { bufferMinutes: 0 } })
    }
  })

  it('uses a fixed number of queries regardless of the number of barbers (no N+1)', async () => {
    const busySource = vi.fn<BusySource>(async () => [])
    const single = await countQueries(() =>
      loadSlotInput(payload, query({ barberId: b1 }), req, { busySource }),
    )
    const any = await countQueries(() => loadSlotInput(payload, query(), req, { busySource }))
    const extra = await barber('Four', 4, locA, [service])
    try {
      const more = await countQueries(() => loadSlotInput(payload, query(), req, { busySource }))
      // settings, service, extras, barbers, exceptions, prices
      expect([single, any, more]).toEqual([6, 6, 6])
      expect(busySource).toHaveBeenCalledTimes(3)
    } finally {
      await payload.delete({ collection: 'barbers', id: extra })
    }
  })

  it('a location without barbers skips the per-barber queries', async () => {
    const busySource = vi.fn<BusySource>(async () => [])
    const emptyLoc = (await create({ collection: 'locations', data: { name: 'Empty' } })).id
    const count = await countQueries(() =>
      loadSlotInput(payload, query({ locationId: emptyLoc }), req, { busySource }),
    )
    expect(count).toBe(4)
    expect(busySource).not.toHaveBeenCalled()
  })

  it('unknown service or extra → business error with a code', async () => {
    const missing = '000000000000000000000000'
    await expect(loadSlotInput(payload, query({ serviceId: missing }), req)).rejects.toMatchObject({
      status: 404,
      data: { code: 'SERVICE_NOT_FOUND' },
    })
    await expect(
      loadSlotInput(payload, query({ extraIds: [extra1, missing] }), req),
    ).rejects.toMatchObject({
      status: 404,
      data: { code: 'EXTRA_NOT_FOUND' },
    })
  })

  it('a barber of another location is not a candidate for "any barber"', async () => {
    const input = await loadSlotInput(payload, query({ locationId: locB }), req)
    expect(input.barbers.map((b) => b.id)).toEqual([b3])
  })
})
