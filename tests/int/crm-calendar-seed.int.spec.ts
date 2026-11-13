// @vitest-environment node
import { createLocalReq, getPayload, type Payload, type PayloadRequest } from 'payload'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { getStaffContext } from '@/access/policy'
import { createAppointment } from '@/crm/appointments'
import { addMinutes, localToInstant, todayLocal } from '@/crm/time'
import { loadCalendar, type CalendarQuery } from '@/endpoints/crm/calendar'
import { up as appointmentsUp } from '@/migrations/20261113_000004_appointments'
import config from '@/payload.config'
import { SEED_USERS } from '@/seed/data'
import { runSeed } from '@/seed/run'

/**
 * Calendar performance on the seed dataset (spec §9): one request, a fixed number of database
 * queries whatever the number of appointments, barbers' details and clients.
 */
describe('calendar on seed data', { timeout: 300_000 }, () => {
  let payload: Payload
  const users: Record<string, Record<string, unknown>> = {}

  const reqFor = async (key: string): Promise<PayloadRequest> =>
    createLocalReq({ user: { ...users[key], collection: 'users' } as never }, payload)

  const query = (patch: Partial<CalendarQuery> = {}): CalendarQuery => ({
    date: todayLocal(),
    view: 'day',
    locationId: null,
    barberId: null,
    includeCancelled: true,
    ...patch,
  })

  /** Every Local API read made while building the calendar (staff context included). */
  const measure = async (key: string, q: CalendarQuery = query()) => {
    const req = await reqFor(key)
    const spies = (['find', 'findGlobal', 'findByID', 'count'] as const).map((method) =>
      vi.spyOn(payload, method),
    )
    const started = performance.now()
    try {
      const staff = await getStaffContext(req)
      const calendar = await loadCalendar(req, staff, q)
      return {
        calendar,
        queries: spies.reduce((sum, spy) => sum + spy.mock.calls.length, 0),
        ms: performance.now() - started,
      }
    } finally {
      for (const spy of spies) spy.mockRestore()
    }
  }

  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    await Promise.all(Object.values(payload.db.collections).map((model) => model.init()))
    const req = await createLocalReq({}, payload)
    await appointmentsUp({ payload, req } as Parameters<typeof appointmentsUp>[0])
    await runSeed(payload, { password: 'seed-test-password' })
    const { docs } = await payload.find({
      collection: 'users',
      where: { email: { in: SEED_USERS.map((user) => user.email) } },
      depth: 0,
      pagination: false,
      overrideAccess: true,
    })
    for (const seedUser of SEED_USERS) {
      const doc = docs.find((item) => item.email === seedUser.email)
      if (doc) users[seedUser.key] = doc as unknown as Record<string, unknown>
    }
  })

  it('the number of queries does not depend on the amount of data', async () => {
    const before = await measure('admin')
    const appointments = before.calendar.columns.reduce(
      (sum, column) => sum + column.appointments.length,
      0,
    )
    expect(before.calendar.columns.length).toBe(3)
    expect(appointments).toBeGreaterThan(0)
    // settings, locations, barbers, exceptions, appointments, clients, services, extras (+ media).
    expect(before.queries).toBeLessThanOrEqual(9)

    // Twelve more appointments of every barber at night (staff mode allows it), new clients.
    const system = await createLocalReq({}, payload)
    const date = todayLocal()
    const service = (
      await payload.find({ collection: 'services', limit: 1, depth: 0, overrideAccess: true })
    ).docs[0]
    let phone = 700_000
    for (const column of before.calendar.columns) {
      for (let index = 0; index < 4; index++) {
        const client = await payload.create({
          collection: 'clients',
          data: { firstName: `Perf ${index}`, phone: `+37369${phone++}`, language: 'ru' },
          overrideAccess: true,
          req: system,
        })
        await createAppointment(
          await createLocalReq({}, payload),
          {
            location: before.calendar.location,
            barber: column.barber.id,
            client: String(client.id),
            service: String(service.id),
            startAt: addMinutes(localToInstant(date, '00:00'), index * 60),
          },
          { actorType: 'system', skipEmail: true },
        )
      }
    }

    const after = await measure('admin')
    expect(
      after.calendar.columns.reduce((sum, column) => sum + column.appointments.length, 0),
    ).toBe(appointments + 12)
    expect(after.queries).toBe(before.queries)
    // Informational: the spec target is < 300 ms for 10 barbers × 60 appointments.
    expect(after.ms).toBeLessThan(5_000)
  })

  it('manager, barber and the week view use a fixed number of queries too', async () => {
    const manager = await measure('manager')
    const barber = await measure('barber1')
    const week = await measure('barber1', query({ view: 'week' }))
    expect(manager.queries).toBeLessThanOrEqual(10)
    expect(barber.queries).toBeLessThanOrEqual(11)
    expect(week.queries).toBe(barber.queries)
    expect(week.calendar.columns).toHaveLength(7)
    // A barber sees details only in their own column.
    const [own, ...others] = barber.calendar.columns
    expect(own.barber.own).toBe(true)
    for (const column of others)
      for (const item of column.appointments)
        expect(Object.keys(item).sort()).toEqual(['busy', 'end', 'start'])
  })
})
