// @vitest-environment node
import { createLocalReq, getPayload, handleEndpoints, type Payload } from 'payload'
import { beforeAll, describe, expect, it } from 'vitest'

import { createAppointment } from '@/crm/appointments'
import { localToInstant } from '@/crm/time'
import { up as appointmentsUp } from '@/migrations/20261113_000004_appointments'
import config from '@/payload.config'

// 2026-12-14 is a Monday; every barber works 09:00–18:00 every day.
const DAY = '2026-12-14'
const iso = (time: string, date = DAY) => localToInstant(date, time).toISOString()

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
type Doc = Record<string, unknown> & { id: string }
type Who = 'admin' | 'manager' | 'managerB' | 'barber1' | 'barber2' | 'editor' | 'anon'

describe('CRM API', () => {
  let payload: Payload
  const ids: Record<string, string> = {}
  const tokens: Partial<Record<Who, string>> = {}

  const call = async (who: Who, method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown) => {
    const headers = new Headers()
    if (tokens[who]) headers.set('Authorization', `Bearer ${tokens[who]}`)
    if (body !== undefined) headers.set('Content-Type', 'application/json')
    const response = await handleEndpoints({
      config,
      request: new Request(`http://localhost:3000/api${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    })
    const text = await response.text()
    return { status: response.status, text, json: (text ? JSON.parse(text) : null) as Json }
  }

  const create = async (collection: string, data: Record<string, unknown>) =>
    (await payload.create({ collection, data, overrideAccess: true } as never)) as unknown as Doc

  const findRaw = async (id: string) =>
    (await payload.findByID({
      collection: 'appointments',
      id,
      depth: 0,
      overrideAccess: true,
    })) as unknown as Doc

  /** System-created appointment (skips emails). */
  const appointment = async (data: Record<string, unknown>) => {
    const req = await createLocalReq({}, payload)
    const { doc } = await createAppointment(
      req,
      { location: ids.locA, service: ids.cut, ...data } as never,
      { actorType: 'system', skipEmail: true },
    )
    return String(doc.id)
  }

  /** Simulates a payment (the ledger arrives in stage 18). */
  const setPaid = (id: string, paidAmount: number) =>
    payload.db.collections.appointments.updateOne({ _id: id }, { $set: { paidAmount } })

  const calendar = (who: Who, query = '') => call(who, 'GET', `/crm/calendar?date=${DAY}${query}`)

  const allAppointments = (body: Json) =>
    (body.columns as Json[]).flatMap((column) => column.appointments as Json[])

  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    await Promise.all(Object.values(payload.db.collections).map((model) => model.init()))
    const req = await createLocalReq({}, payload)
    await appointmentsUp({ payload, req } as Parameters<typeof appointmentsUp>[0])

    ids.locA = (await create('locations', { name: 'A', order: 1 })).id
    ids.locB = (await create('locations', { name: 'B', order: 2 })).id
    ids.cut = (await create('services', { name: 'Cut', durationMinutes: 30, price: 30_000 })).id
    ids.wash = (await create('extras', { name: 'Wash', durationMinutes: 10, price: 5_000 })).id

    for (const [key, roles, locations] of [
      ['admin', ['admin'], []],
      ['manager', ['manager'], [ids.locA]],
      ['managerB', ['manager'], [ids.locB]],
      ['barber1', ['barber'], []],
      ['barber2', ['barber'], []],
      ['editor', ['editor'], []],
    ] as const) {
      const email = `${key}-crm@test.local`
      const user = await create('users', {
        email,
        password: 'test',
        roles: [...roles],
        locations: [...locations],
      })
      ids[key] = user.id
      const { token } = await payload.login({
        collection: 'users',
        data: { email, password: 'test' },
      })
      tokens[key] = token
    }

    const weekly = (location: string) =>
      ['1', '2', '3', '4', '5', '6', '7'].map((weekday) => ({
        weekday,
        location,
        start: '09:00',
        end: '18:00',
        breaks: [{ start: '13:00', end: '14:00' }],
      }))
    const barber = async (name: string, order: number, location: string, user?: string) =>
      (
        await create('barbers', {
          name,
          order,
          showOnSite: false,
          locations: [location],
          services: [ids.cut],
          weeklySchedule: weekly(location),
          ...(user ? { user } : {}),
        })
      ).id
    ids.b1 = await barber('One', 1, ids.locA, ids.barber1)
    ids.b2 = await barber('Two', 2, ids.locA, ids.barber2)
    ids.b3 = await barber('Three', 3, ids.locB)
    // Barber Two charges more for the cut.
    await create('barber-prices', {
      barber: ids.b2,
      item: { relationTo: 'services', value: ids.cut },
      price: 40_000,
    })
    await create('schedule-exceptions', {
      barber: ids.b2,
      dateFrom: '2026-12-16',
      dateTo: '2026-12-16',
      kind: 'day_off',
    })

    ids.c1 = (
      await create('clients', {
        firstName: 'Ion',
        lastName: 'Rusu',
        phone: '069100001',
        email: 'ion@example.com',
        language: 'ro',
      })
    ).id
    ids.c2 = (
      await create('clients', { firstName: 'Ana', phone: '069100002', email: 'ana@example.com' })
    ).id

    ids.a1 = await appointment({ barber: ids.b1, client: ids.c1, startAt: iso('10:00') })
    ids.a2 = await appointment({ barber: ids.b2, client: ids.c2, startAt: iso('11:00') })
    ids.a3 = await appointment({
      location: ids.locB,
      barber: ids.b3,
      client: ids.c2,
      startAt: iso('10:00'),
    })
    ids.block = await appointment({
      kind: 'block',
      barber: ids.b2,
      startAt: iso('15:00'),
      durationMinutes: 60,
      service: null,
    })
    ids.cancelled = await appointment({ barber: ids.b1, client: ids.c2, startAt: iso('12:00') })
    const cancelReq = await createLocalReq({}, payload)
    await payload.update({
      collection: 'appointments',
      id: ids.cancelled,
      data: { status: 'cancelled_by_client' },
      req: cancelReq,
      context: { appointmentOptions: { actorType: 'system', skipEmail: true } },
    } as never)
  })

  describe('authentication', () => {
    const endpoints: [string, 'GET' | 'POST' | 'PATCH', unknown?][] = [
      [`/crm/calendar?date=${DAY}`, 'GET'],
      [`/crm/slots?date=${DAY}`, 'GET'],
      ['/crm/appointments', 'POST', {}],
      ['/crm/appointments/000000000000000000000000', 'PATCH', {}],
      ['/crm/appointments/000000000000000000000000/status', 'POST', {}],
      ['/crm/clients/lookup?phone=069100001', 'GET'],
    ]

    it('rejects anonymous requests (401) and the editor role (403) on every endpoint', async () => {
      for (const [path, method, body] of endpoints) {
        const anon = await call('anon', method, path, body)
        expect(anon.status, path).toBe(401)
        expect(anon.json.error.code).toBe('UNAUTHORIZED')
        const editor = await call('editor', method, path, body)
        expect(editor.status, path).toBe(403)
        expect(editor.json.error.code).toBe('FORBIDDEN')
      }
    })
  })

  describe('GET /crm/calendar', () => {
    it('admin: columns of the location, working intervals and full details without email', async () => {
      const { status, json, text } = await calendar('admin', `&location=${ids.locA}`)
      expect(status).toBe(200)
      expect(json.location).toBe(ids.locA)
      expect(json.locations.map((item: Json) => item.id)).toEqual([ids.locA, ids.locB])
      expect(json.slotStepMinutes).toBe(15)
      expect(json.columns.map((column: Json) => column.barber.id)).toEqual([ids.b1, ids.b2])
      const [one, two] = json.columns
      expect(one.date).toBe(DAY)
      expect(one.off).toBeNull()
      expect(one.intervals).toEqual([
        { start: iso('09:00'), end: iso('13:00') },
        { start: iso('14:00'), end: iso('18:00') },
      ])
      expect(one.appointments).toHaveLength(1) // the cancelled one is hidden by default
      expect(one.appointments[0]).toMatchObject({
        id: ids.a1,
        status: 'scheduled',
        start: iso('10:00'),
        end: iso('10:30'),
        total: 30_000,
        client: { id: ids.c1, firstName: 'Ion', lastName: 'Rusu', phone: '+37369100001' },
        service: { id: ids.cut, name: 'Cut' },
      })
      expect(two.appointments.map((item: Json) => item.id)).toEqual([ids.a2, ids.block])
      expect(text).not.toContain('@example.com')
      expect(text).not.toContain('cancelToken')
    })

    it('shows cancelled appointments on request', async () => {
      const { json } = await calendar('admin', `&location=${ids.locA}&cancelled=1`)
      expect(json.columns[0].appointments.map((item: Json) => item.id)).toEqual([
        ids.a1,
        ids.cancelled,
      ])
    })

    it('manager: only their locations', async () => {
      const own = await calendar('manager')
      expect(own.status).toBe(200)
      expect(own.json.location).toBe(ids.locA)
      expect(own.json.locations.map((item: Json) => item.id)).toEqual([ids.locA])
      expect(allAppointments(own.json).every((item) => !item.busy)).toBe(true)

      const other = await calendar('manager', `&location=${ids.locB}`)
      expect(other.status).toBe(403)
      expect(other.json.error.code).toBe('FORBIDDEN')

      const managerB = await calendar('managerB')
      expect(managerB.json.location).toBe(ids.locB)
      expect(managerB.json.columns.map((column: Json) => column.barber.id)).toEqual([ids.b3])
      expect(managerB.text).not.toContain(ids.a1)
    })

    it('barber: own column first with details, colleagues only as busy time', async () => {
      const { status, json, text } = await calendar('barber2')
      expect(status).toBe(200)
      expect(json.locations.map((item: Json) => item.id)).toEqual([ids.locA])
      const [own, colleague] = json.columns
      expect(own.barber).toMatchObject({ id: ids.b2, own: true })
      expect(colleague.barber).toMatchObject({ id: ids.b1, own: false })
      expect(own.appointments[0]).toMatchObject({
        id: ids.a2,
        client: { firstName: 'Ana', phone: '+37369100002' },
        total: 40_000,
      })
      // Exactly { start, end, busy } — no id, client, status or price.
      expect(colleague.appointments).toEqual([
        { start: iso('10:00'), end: iso('10:30'), busy: true },
      ])
      expect(text).not.toContain(ids.a1)
      expect(text).not.toContain('Ion')
      expect(text).not.toContain('+37369100001')
      expect(text).not.toContain('@example.com')

      // Cancelled colleagues' appointments are not even busy time.
      const withCancelled = await calendar('barber2', '&cancelled=1')
      expect(withCancelled.json.columns[1].appointments).toHaveLength(1)
      expect(withCancelled.text).not.toContain(ids.cancelled)

      const other = await calendar('barber2', `&location=${ids.locB}`)
      expect(other.status).toBe(403)
    })

    it('week view: 7 days of one barber, days off marked', async () => {
      const { json } = await calendar('barber2', '&view=week')
      expect(json.view).toBe('week')
      expect(json.from).toBe(DAY)
      expect(json.to).toBe('2026-12-20')
      expect(json.columns).toHaveLength(7)
      expect(json.columns.every((column: Json) => column.barber.id === ids.b2)).toBe(true)
      expect(json.columns[2]).toMatchObject({ date: '2026-12-16', off: 'day_off', intervals: [] })
      expect(json.columns[0].appointments).toHaveLength(2)

      // A barber looking at a colleague's week sees only busy time.
      const colleague = await calendar('barber2', `&view=week&barber=${ids.b1}`)
      expect(colleague.json.columns[0].appointments).toEqual([
        { start: iso('10:00'), end: iso('10:30'), busy: true },
      ])

      const admin = await calendar('admin', `&view=week&location=${ids.locA}`)
      expect(admin.status).toBe(400)
      expect(admin.json.error).toEqual({
        code: 'VALIDATION_ERROR',
        details: { fields: ['barber'] },
      })
    })

    it('validates the query', async () => {
      const { status, json } = await call(
        'admin',
        'GET',
        '/crm/calendar?date=2026-13-01&view=month',
      )
      expect(status).toBe(400)
      expect(json.error.details.fields).toEqual(['date', 'view'])
    })
  })

  describe('GET /crm/slots (staff mode)', () => {
    const slots = (who: Who, query: string) =>
      call(who, 'GET', `/crm/slots?location=${ids.locA}&service=${ids.cut}&date=${DAY}${query}`)

    it('returns the whole grid without overlaps, OUTSIDE_SCHEDULE outside working hours', async () => {
      const { status, json } = await slots('barber1', '')
      expect(status).toBe(200)
      const byTime = new Map(json.slots.map((slot: Json) => [slot.time, slot]))
      expect(byTime.has('10:00')).toBe(false) // taken by a1
      expect(byTime.has('09:45')).toBe(false) // would overlap a1
      expect((byTime.get('09:00') as Json).barbers).toEqual([
        { id: ids.b1, end: iso('09:30'), durationMinutes: 30, warnings: [] },
      ])
      expect((byTime.get('13:00') as Json).barbers[0].warnings).toEqual(['OUTSIDE_SCHEDULE'])
      expect((byTime.get('20:00') as Json).barbers[0].warnings).toEqual(['OUTSIDE_SCHEDULE'])
    })

    it('`exclude` frees the edited appointment; any barber for managers', async () => {
      const own = await slots('admin', `&barber=${ids.b1}&exclude=${ids.a1}`)
      expect(own.json.slots.some((slot: Json) => slot.time === '10:00')).toBe(true)
      const any = await slots('manager', '')
      const ten = any.json.slots.find((slot: Json) => slot.time === '10:00')
      expect(ten.barbers.map((option: Json) => option.id)).toEqual([ids.b2])
    })

    it('enforces scope: barber — own column, manager — own locations', async () => {
      expect((await slots('barber1', `&barber=${ids.b2}`)).status).toBe(403)
      expect((await slots('barber1', `&exclude=${ids.a2}`)).status).toBe(404)
      expect(
        (
          await call(
            'manager',
            'GET',
            `/crm/slots?location=${ids.locB}&service=${ids.cut}&date=${DAY}`,
          )
        ).status,
      ).toBe(403)
      const wrongBarber = await slots('admin', `&barber=${ids.b3}`)
      expect(wrongBarber.status).toBe(404)
      expect(wrongBarber.json.error.code).toBe('BARBER_NOT_FOUND')
    })
  })

  describe('POST /crm/appointments', () => {
    const body = (patch: Record<string, unknown> = {}) => ({
      location: ids.locA,
      barber: ids.b1,
      client: ids.c1,
      service: ids.cut,
      start: iso('16:00'),
      ...patch,
    })

    it('creates an appointment with the price snapshot', async () => {
      const { status, json } = await call(
        'manager',
        'POST',
        '/crm/appointments',
        body({ extras: [ids.wash], start: iso('09:00') }),
      )
      expect(status).toBe(200)
      expect(json.warnings).toEqual([])
      expect(json.appointment).toMatchObject({
        status: 'scheduled',
        start: iso('09:00'),
        end: iso('09:40'),
        total: 35_000,
        extras: [{ id: ids.wash, name: 'Wash' }],
        client: { id: ids.c1 },
      })
      expect((await findRaw(json.appointment.id)).source).toBe('staff')
    })

    it('outside the schedule: 409 CONFIRMATION_REQUIRED and nothing saved, then confirm', async () => {
      const count = async () => (await payload.count({ collection: 'appointments' })).totalDocs
      const before = await count()
      const first = await call('admin', 'POST', '/crm/appointments', body({ start: iso('19:00') }))
      expect(first.status).toBe(409)
      expect(first.json.error).toEqual({
        code: 'CONFIRMATION_REQUIRED',
        details: { warnings: ['OUTSIDE_SCHEDULE'] },
      })
      expect(await count()).toBe(before)

      const confirmed = await call(
        'admin',
        'POST',
        '/crm/appointments',
        body({ start: iso('19:00'), confirm: true }),
      )
      expect(confirmed.status).toBe(200)
      expect(confirmed.json.warnings).toEqual(['OUTSIDE_SCHEDULE'])
      expect(await count()).toBe(before + 1)
    })

    it('appointment without a client and a time block', async () => {
      const anonymous = await call(
        'barber1',
        'POST',
        '/crm/appointments',
        body({ client: null, barber: undefined, start: iso('11:00') }),
      )
      expect(anonymous.status).toBe(200)
      expect(anonymous.json.appointment).toMatchObject({ barber: ids.b1, client: null })

      const block = await call('barber1', 'POST', '/crm/appointments', {
        kind: 'block',
        location: ids.locA,
        start: iso('17:00'),
        durationMinutes: 30,
      })
      expect(block.status).toBe(200)
      expect(block.json.appointment).toMatchObject({ kind: 'block', end: iso('17:30'), total: 0 })
    })

    it('rejects overlaps and out-of-scope targets', async () => {
      const taken = await call('admin', 'POST', '/crm/appointments', body({ start: iso('10:15') }))
      expect(taken.status).toBe(409)
      expect(taken.json.error.code).toBe('SLOT_TAKEN')

      // Decision 37: a barber does not book for colleagues.
      const colleague = await call(
        'barber1',
        'POST',
        '/crm/appointments',
        body({ barber: ids.b2, start: iso('09:00', '2026-12-15') }),
      )
      expect(colleague.status).toBe(403)
      const otherLocation = await call(
        'manager',
        'POST',
        '/crm/appointments',
        body({ location: ids.locB, barber: ids.b3 }),
      )
      expect(otherLocation.status).toBe(403)
    })

    it('manual discount: managers yes, barbers no; promo code by text', async () => {
      const discount = { type: 'percent', value: 10, reason: 'Regular' }
      const barber = await call(
        'barber1',
        'POST',
        '/crm/appointments',
        body({ barber: undefined, start: iso('09:00', '2026-12-17'), manualDiscount: discount }),
      )
      expect(barber.status).toBe(403)
      expect(barber.json.error.code).toBe('DISCOUNT_FORBIDDEN')

      const manager = await call(
        'manager',
        'POST',
        '/crm/appointments',
        body({ start: iso('09:00', '2026-12-17'), manualDiscount: discount }),
      )
      expect(manager.status).toBe(200)
      expect(manager.json.appointment).toMatchObject({ manualDiscount: 3_000, total: 27_000 })

      const promo = await call(
        'admin',
        'POST',
        '/crm/appointments',
        body({ start: iso('10:00', '2026-12-17'), promoCode: 'nope' }),
      )
      expect(promo.status).toBe(404)
      expect(promo.json.error.code).toBe('PROMO_NOT_FOUND')
    })

    it('validates the body', async () => {
      const { status, json } = await call('admin', 'POST', '/crm/appointments', {
        location: 'x',
        start: 'later',
        extras: 'wash',
      })
      expect(status).toBe(400)
      expect(json.error.details.fields).toEqual(['location', 'extras', 'start'])
    })
  })

  describe('PATCH /crm/appointments/:id', () => {
    it('a move to another barber recalculates the price: PRICE_CHANGED, then confirm + email', async () => {
      const id = await appointment({
        barber: ids.b1,
        client: ids.c1,
        startAt: iso('09:00', '2026-12-18'),
      })
      const move = { barber: ids.b2, start: iso('10:00', '2026-12-18') }
      const first = await call('manager', 'PATCH', `/crm/appointments/${id}`, move)
      expect(first.status).toBe(409)
      expect(first.json.error).toEqual({
        code: 'CONFIRMATION_REQUIRED',
        details: { warnings: ['PRICE_CHANGED'], total: { from: 30_000, to: 40_000 } },
      })
      expect(await findRaw(id)).toMatchObject({ barber: ids.b1, total: 30_000 })

      const confirmed = await call('manager', 'PATCH', `/crm/appointments/${id}`, {
        ...move,
        confirm: true,
      })
      expect(confirmed.status).toBe(200)
      expect(confirmed.json.warnings).toEqual(['PRICE_CHANGED'])
      expect(confirmed.json.appointment).toMatchObject({
        barber: ids.b2,
        start: iso('10:00', '2026-12-18'),
        total: 40_000,
      })

      const { docs: jobs } = await payload.find({
        collection: 'payload-jobs',
        pagination: false,
        depth: 0,
      })
      const moved = jobs.filter((job) => {
        const input = job.input as { appointmentId?: string; type?: string } | undefined
        return input?.appointmentId === id && input.type === 'moved'
      })
      expect(moved).toHaveLength(1)
      const { docs: logs } = await payload.find({
        collection: 'appointment-logs',
        where: { appointment: { equals: id } },
        depth: 0,
        pagination: false,
      })
      expect(logs.map((log) => log.action)).toContain('move')
    })

    it('a time move with the same price needs no confirmation; payments add HAS_PAYMENTS', async () => {
      const id = await appointment({
        barber: ids.b1,
        client: ids.c1,
        startAt: iso('11:00', '2026-12-18'),
      })
      const time = await call('admin', 'PATCH', `/crm/appointments/${id}`, {
        start: iso('11:30', '2026-12-18'),
      })
      expect(time.status).toBe(200)
      expect(time.json.warnings).toEqual([])

      await setPaid(id, 10_000)
      const barber = await call('admin', 'PATCH', `/crm/appointments/${id}`, { barber: ids.b2 })
      expect(barber.status).toBe(409)
      expect(barber.json.error.details.warnings).toEqual(['PRICE_CHANGED', 'HAS_PAYMENTS'])
    })

    it('changes the composition and notes without warnings', async () => {
      const id = await appointment({
        barber: ids.b1,
        client: ids.c1,
        startAt: iso('14:00', '2026-12-18'),
      })
      const { status, json } = await call('barber1', 'PATCH', `/crm/appointments/${id}`, {
        extras: [ids.wash],
        internalNote: 'Prefers scissors',
      })
      expect(status).toBe(200)
      expect(json.warnings).toEqual([])
      expect(json.appointment).toMatchObject({
        total: 35_000,
        end: iso('14:40', '2026-12-18'),
        internalNote: 'Prefers scissors',
      })
    })

    it('hides other scopes (404) and rejects unknown fields', async () => {
      expect((await call('barber1', 'PATCH', `/crm/appointments/${ids.a2}`, {})).status).toBe(404)
      expect((await call('managerB', 'PATCH', `/crm/appointments/${ids.a1}`, {})).status).toBe(404)
      // Moving into a colleague's column is not allowed either.
      const steal = await call('barber1', 'PATCH', `/crm/appointments/${ids.a1}`, {
        barber: ids.b2,
        confirm: true,
      })
      expect(steal.status).toBe(403)
      expect(steal.json.error.code).toBe('APPOINTMENT_FORBIDDEN')

      const unknown = await call('admin', 'PATCH', `/crm/appointments/${ids.a1}`, {
        status: 'completed',
        total: 1,
      })
      expect(unknown.status).toBe(400)
      expect(unknown.json.error.details.fields).toEqual(['status', 'total'])
    })
  })

  describe('POST /crm/appointments/:id/status', () => {
    it('cancels with a reason; the barber only their own', async () => {
      const id = await appointment({
        barber: ids.b1,
        client: ids.c1,
        startAt: iso('09:00', '2026-12-19'),
      })
      const path = `/crm/appointments/${id}/status`
      const noReason = await call('barber1', 'POST', path, { status: 'cancelled_by_salon' })
      expect(noReason.status).toBe(400)
      expect(noReason.json.error.code).toBe('CANCEL_REASON_REQUIRED')

      expect(
        (await call('barber2', 'POST', path, { status: 'cancelled_by_salon', reason: 'Ill' }))
          .status,
      ).toBe(404)

      const ok = await call('barber1', 'POST', path, {
        status: 'cancelled_by_salon',
        reason: 'Ill',
      })
      expect(ok.status).toBe(200)
      expect(ok.json.appointment).toMatchObject({
        status: 'cancelled_by_salon',
        cancelReason: 'Ill',
      })
    })

    it('status rules come from the service; restore only for admin/manager', async () => {
      const id = await appointment({
        barber: ids.b1,
        client: ids.c1,
        startAt: iso('10:00', '2026-12-19'),
      })
      const path = `/crm/appointments/${id}/status`
      const early = await call('admin', 'POST', path, { status: 'completed' })
      expect(early.status).toBe(400)
      expect(early.json.error.code).toBe('STATUS_TOO_EARLY')

      await call('barber1', 'POST', path, { status: 'cancelled_by_client' })
      const restoreByBarber = await call('barber1', 'POST', path, { status: 'scheduled' })
      expect(restoreByBarber.json.error.code).toBe('STATUS_FORBIDDEN')
      const restore = await call('manager', 'POST', path, { status: 'scheduled' })
      expect(restore.status).toBe(200)
      expect(restore.json.appointment.status).toBe('scheduled')
    })

    it('cancelling a paid appointment needs a confirmation (REFUND_REQUIRED)', async () => {
      const id = await appointment({
        barber: ids.b1,
        client: ids.c1,
        startAt: iso('11:00', '2026-12-19'),
      })
      await setPaid(id, 30_000)
      const path = `/crm/appointments/${id}/status`
      const first = await call('admin', 'POST', path, { status: 'cancelled_by_client' })
      expect(first.status).toBe(409)
      expect(first.json.error.details.warnings).toEqual(['REFUND_REQUIRED'])
      expect((await findRaw(id)).status).toBe('scheduled')

      const confirmed = await call('admin', 'POST', path, {
        status: 'cancelled_by_client',
        confirm: true,
      })
      expect(confirmed.status).toBe(200)
      expect(confirmed.json.warnings).toEqual(['REFUND_REQUIRED'])
    })

    it('validates the status', async () => {
      const { status, json } = await call('admin', 'POST', `/crm/appointments/${ids.a1}/status`, {
        status: 'done',
      })
      expect(status).toBe(400)
      expect(json.error.details.fields).toEqual(['status'])
    })
  })

  describe('GET /crm/clients/lookup', () => {
    it('admin and manager find a client by any phone format', async () => {
      for (const who of ['admin', 'manager'] as const) {
        const { status, json } = await call(
          who,
          'GET',
          '/crm/clients/lookup?phone=%2B373%2069%20100%20001',
        )
        expect(status).toBe(200)
        expect(json.client).toMatchObject({
          id: ids.c1,
          firstName: 'Ion',
          phone: '+37369100001',
          email: 'ion@example.com',
          language: 'ro',
          blocked: false,
        })
      }
      const missing = await call('admin', 'GET', '/crm/clients/lookup?phone=069999999')
      expect(missing.json).toEqual({ client: null })
    })

    it('barbers have no access; a bad phone is PHONE_INVALID', async () => {
      const barber = await call('barber1', 'GET', '/crm/clients/lookup?phone=069100001')
      expect(barber.status).toBe(403)
      const bad = await call('admin', 'GET', '/crm/clients/lookup?phone=123')
      expect(bad.status).toBe(400)
      expect(bad.json.error.code).toBe('PHONE_INVALID')
    })
  })
})
