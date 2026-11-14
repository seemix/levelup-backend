// @vitest-environment node
import { createLocalReq, getPayload, handleEndpoints, type Payload } from 'payload'
import { beforeAll, describe, expect, it } from 'vitest'

import { createAppointment } from '@/crm/appointments'
import { localToInstant } from '@/crm/time'
import { up as appointmentsUp } from '@/migrations/20261113_000004_appointments'
import config from '@/payload.config'

// March 2027: Monday 1st. Barbers work Mon–Fri 09:00–18:00 in their location.
const MONTH = '2027-03'

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
type Doc = Record<string, unknown> & { id: string }
type Who = 'admin' | 'manager' | 'managerB' | 'barber1' | 'editor' | 'anon'

describe('Schedule roster API (A44)', () => {
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
    return { status: response.status, json: (text ? JSON.parse(text) : null) as Json }
  }

  const create = async (collection: string, data: Record<string, unknown>) =>
    (await payload.create({ collection, data, overrideAccess: true } as never)) as unknown as Doc

  const exceptionsOf = async (barber: string) =>
    (
      await payload.find({
        collection: 'schedule-exceptions',
        where: { barber: { equals: barber } },
        sort: 'dateFrom',
        depth: 0,
        pagination: false,
        overrideAccess: true,
      })
    ).docs.map((doc) => ({
      kind: doc.kind,
      dateFrom: doc.dateFrom,
      dateTo: doc.dateTo,
      ...(doc.kind === 'custom_hours' ? { start: doc.start, end: doc.end } : {}),
    }))

  const roster = (who: Who, query = '') => call(who, 'GET', `/crm/schedule?month=${MONTH}${query}`)
  const rowOf = (body: Json, barber: string) =>
    (body.barbers as Json[]).find((row) => row.id === barber)!
  const dayOf = (row: Json, date: string) => (row.days as Json[]).find((day) => day.date === date)!

  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    await Promise.all(Object.values(payload.db.collections).map((model) => model.init()))
    const req = await createLocalReq({}, payload)
    await appointmentsUp({ payload, req } as Parameters<typeof appointmentsUp>[0])

    ids.locA = (await create('locations', { name: 'Roster A', order: 1 })).id
    ids.locB = (await create('locations', { name: 'Roster B', order: 2 })).id
    ids.cut = (await create('services', { name: 'Cut', durationMinutes: 30, price: 30_000 })).id

    for (const [key, roles, locations] of [
      ['admin', ['admin'], []],
      ['manager', ['manager'], [ids.locA]],
      ['managerB', ['manager'], [ids.locB]],
      ['barber1', ['barber'], []],
      ['editor', ['editor'], []],
    ] as const) {
      const email = `${key}-roster@test.local`
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

    const weekdays = (location: string) =>
      ['1', '2', '3', '4', '5'].map((weekday) => ({
        weekday,
        location,
        start: '09:00',
        end: '18:00',
      }))
    const barber = async (name: string, order: number, location: string, user?: string) =>
      (
        await create('barbers', {
          name,
          order,
          showOnSite: false,
          locations: [location],
          services: [ids.cut],
          weeklySchedule: weekdays(location),
          ...(user ? { user } : {}),
        })
      ).id
    ids.b1 = await barber('Roster One', 1, ids.locA, ids.barber1)
    ids.b2 = await barber('Roster Two', 2, ids.locA)
    ids.b3 = await barber('Roster Three', 3, ids.locB)

    // A scheduled appointment of barber One on Tuesday 2027-03-02.
    await createAppointment(
      await createLocalReq({}, payload),
      {
        location: ids.locA,
        barber: ids.b1,
        service: ids.cut,
        startAt: localToInstant('2027-03-02', '10:00').toISOString(),
      } as never,
      { actorType: 'system', skipEmail: true },
    )
  })

  it('rejects anonymous users (401) and editors (403)', async () => {
    for (const [method, path, body] of [
      ['GET', `/crm/schedule?month=${MONTH}`],
      ['POST', '/crm/schedule/days', {}],
      ['POST', '/crm/schedule/fill', {}],
    ] as const) {
      expect((await call('anon', method, path, body)).status).toBe(401)
      expect((await call('editor', method, path, body)).status).toBe(403)
    }
  })

  describe('GET /crm/schedule', () => {
    it('admin: barbers of the location × days of the month, pattern and appointment counts', async () => {
      const { status, json } = await roster('admin', `&location=${ids.locA}`)
      expect(status).toBe(200)
      expect(json).toMatchObject({
        month: MONTH,
        from: '2027-03-01',
        to: '2027-03-31',
        location: ids.locA,
      })
      expect((json.barbers as Json[]).map((row) => row.name)).toEqual(['Roster One', 'Roster Two'])
      const one = rowOf(json, ids.b1)
      expect(one).toMatchObject({ canEdit: true, canEditPattern: true, own: false })
      expect(one.days).toHaveLength(31)
      expect(one.pattern).toHaveLength(5)
      expect(dayOf(one, '2027-03-01')).toMatchObject({
        status: 'work',
        override: false,
        start: '09:00',
        end: '18:00',
        location: ids.locA,
      })
      expect(dayOf(one, '2027-03-06')).toMatchObject({ status: 'off', override: false })
      expect(dayOf(one, '2027-03-02').appointments).toBe(1)
    })

    it('manager: own locations only; barber: own row, read-only', async () => {
      const manager = await roster('manager')
      expect(manager.status).toBe(200)
      expect(rowOf(manager.json, ids.b2)).toMatchObject({ canEdit: true, canEditPattern: true })
      expect((await roster('manager', `&location=${ids.locB}`)).status).toBe(403)

      const barber = await roster('barber1')
      expect(barber.status).toBe(200)
      expect((barber.json.barbers as Json[]).map((row) => row.id)).toEqual([ids.b1])
      expect(rowOf(barber.json, ids.b1)).toMatchObject({
        own: true,
        canEdit: false,
        canEditPattern: false,
      })
    })

    it('validates the month', async () => {
      const bad = await call('admin', 'GET', '/crm/schedule?month=2027-13')
      expect(bad.status).toBe(400)
      expect(bad.json.error.details.fields).toEqual(['month'])
    })

    it('day / week views: a date range instead of a month (≤ 62 days)', async () => {
      const week = await call(
        'admin',
        'GET',
        `/crm/schedule?from=2027-03-01&to=2027-03-07&location=${ids.locA}`,
      )
      expect(week.status).toBe(200)
      expect(week.json).toMatchObject({ month: null, from: '2027-03-01', to: '2027-03-07' })
      const one = rowOf(week.json, ids.b1)
      expect(one.days.map((day: Json) => day.date)).toEqual([
        '2027-03-01',
        '2027-03-02',
        '2027-03-03',
        '2027-03-04',
        '2027-03-05',
        '2027-03-06',
        '2027-03-07',
      ])
      expect(one).toHaveProperty('image', null)
      expect(dayOf(one, '2027-03-02').appointments).toBe(1)

      for (const query of [
        'from=2027-03-07&to=2027-03-01',
        'from=2027-03-01&to=2027-06-01',
        'from=2027-03-01',
      ]) {
        const bad = await call('admin', 'GET', `/crm/schedule?${query}`)
        expect(bad.status, query).toBe(400)
        expect(bad.json.error.details.fields).toEqual(['from'])
      }
    })
  })

  describe('POST /crm/schedule/days', () => {
    it('sets a vacation over several days, then changes one day inside it to custom hours', async () => {
      const vacation = await call('manager', 'POST', '/crm/schedule/days', {
        barber: ids.b2,
        dates: ['2027-03-08', '2027-03-09', '2027-03-10', '2027-03-11', '2027-03-12'],
        kind: 'vacation',
      })
      expect(vacation.status).toBe(200)
      expect(await exceptionsOf(ids.b2)).toEqual([
        { kind: 'vacation', dateFrom: '2027-03-08', dateTo: '2027-03-12' },
      ])

      const hours = await call('admin', 'POST', '/crm/schedule/days', {
        barber: ids.b2,
        dates: ['2027-03-10'],
        kind: 'custom_hours',
        start: '12:00',
        end: '16:00',
      })
      expect(hours.status).toBe(200)
      expect(hours.json).toEqual({ removed: 0, updated: 1, created: 2 })
      expect(await exceptionsOf(ids.b2)).toEqual([
        { kind: 'vacation', dateFrom: '2027-03-08', dateTo: '2027-03-09' },
        {
          kind: 'custom_hours',
          dateFrom: '2027-03-10',
          dateTo: '2027-03-10',
          start: '12:00',
          end: '16:00',
        },
        { kind: 'vacation', dateFrom: '2027-03-11', dateTo: '2027-03-12' },
      ])

      const day = dayOf(rowOf((await roster('admin')).json, ids.b2), '2027-03-10')
      expect(day).toMatchObject({
        status: 'work',
        override: true,
        start: '12:00',
        end: '16:00',
        location: ids.locA,
      })
    })

    it('back to the pattern removes the overrides of those days', async () => {
      const { status } = await call('admin', 'POST', '/crm/schedule/days', {
        barber: ids.b2,
        dates: ['2027-03-09', '2027-03-10', '2027-03-11'],
        kind: 'pattern',
      })
      expect(status).toBe(200)
      expect(await exceptionsOf(ids.b2)).toEqual([
        { kind: 'vacation', dateFrom: '2027-03-08', dateTo: '2027-03-08' },
        { kind: 'vacation', dateFrom: '2027-03-12', dateTo: '2027-03-12' },
      ])
    })

    it('rules: hours, breaks and location are validated; nothing is saved on error', async () => {
      const before = await exceptionsOf(ids.b1)
      const send = (body: Record<string, unknown>) =>
        call('admin', 'POST', '/crm/schedule/days', {
          barber: ids.b1,
          dates: ['2027-03-15'],
          ...body,
        })
      const backwards = await send({ kind: 'custom_hours', start: '18:00', end: '09:00' })
      expect(backwards.status).toBe(400)
      expect(backwards.json.error.code).toBe('END_BEFORE_START')
      const outside = await send({
        kind: 'custom_hours',
        start: '09:00',
        end: '12:00',
        breaks: [{ start: '11:00', end: '13:00' }],
      })
      expect(outside.json.error.code).toBe('BREAK_OUTSIDE')
      const location = await send({
        kind: 'custom_hours',
        start: '09:00',
        end: '12:00',
        location: ids.locB,
      })
      expect(location.json.error.code).toBe('LOCATION_NOT_ALLOWED')
      const shape = await send({ kind: 'weekend', dates: [] })
      expect(shape.status).toBe(400)
      expect(shape.json.error.details.fields).toEqual(['dates', 'kind'])
      expect(await exceptionsOf(ids.b1)).toEqual(before)
    })

    it('rights: barbers and managers of other locations cannot change days', async () => {
      const body = { barber: ids.b1, dates: ['2027-03-16'], kind: 'day_off' }
      expect((await call('barber1', 'POST', '/crm/schedule/days', body)).status).toBe(403)
      expect((await call('managerB', 'POST', '/crm/schedule/days', body)).status).toBe(403)
      expect(
        (
          await call('admin', 'POST', '/crm/schedule/days', {
            ...body,
            barber: '000000000000000000000000',
          })
        ).status,
      ).toBe(404)
    })
  })

  describe('POST /crm/schedule/fill', () => {
    it('removes manual changes of the period, keeping vacations by default', async () => {
      await call('admin', 'POST', '/crm/schedule/days', {
        barber: ids.b1,
        dates: ['2027-03-03', '2027-03-04'],
        kind: 'day_off',
      })
      await call('admin', 'POST', '/crm/schedule/days', {
        barber: ids.b1,
        dates: ['2027-03-31'],
        kind: 'sick',
      })
      // Custom hours across the month boundary: only the March part is removed.
      await call('admin', 'POST', '/crm/schedule/days', {
        barber: ids.b1,
        dates: ['2027-03-30', '2027-04-01'],
        kind: 'custom_hours',
        start: '10:00',
        end: '14:00',
      })

      const filled = await call('manager', 'POST', '/crm/schedule/fill', {
        barbers: [ids.b1, ids.b2],
        dateFrom: '2027-03-01',
        dateTo: '2027-03-31',
      })
      expect(filled.status).toBe(200)
      expect(await exceptionsOf(ids.b1)).toEqual([
        { kind: 'sick', dateFrom: '2027-03-31', dateTo: '2027-03-31' },
        {
          kind: 'custom_hours',
          dateFrom: '2027-04-01',
          dateTo: '2027-04-01',
          start: '10:00',
          end: '14:00',
        },
      ])
      // Barber Two keeps the vacation days.
      expect((await exceptionsOf(ids.b2)).map((item) => item.kind)).toEqual([
        'vacation',
        'vacation',
      ])

      const all = await call('admin', 'POST', '/crm/schedule/fill', {
        barbers: [ids.b2],
        dateFrom: '2027-03-01',
        dateTo: '2027-03-31',
        keepAbsences: false,
      })
      expect(all.json).toEqual({ removed: 2, updated: 0, created: 0 })
      expect(await exceptionsOf(ids.b2)).toEqual([])
    })

    it('rights and validation', async () => {
      const body = { barbers: [ids.b1, ids.b3], dateFrom: '2027-03-01', dateTo: '2027-03-31' }
      expect((await call('manager', 'POST', '/crm/schedule/fill', body)).status).toBe(403)
      expect(
        (await call('barber1', 'POST', '/crm/schedule/fill', { ...body, barbers: [ids.b1] }))
          .status,
      ).toBe(403)
      const long = await call('admin', 'POST', '/crm/schedule/fill', {
        ...body,
        dateTo: '2027-05-31',
      })
      expect(long.status).toBe(400)
      expect(long.json.error.details.fields).toEqual(['dateFrom'])
    })
  })

  it('the weekly pattern is saved through the barbers API: manager of the location yes, barber no', async () => {
    const weeklySchedule = [{ weekday: '6', location: ids.locA, start: '10:00', end: '15:00' }]
    expect((await call('barber1', 'PATCH', `/barbers/${ids.b2}`, { weeklySchedule })).status).toBe(
      403,
    )
    expect((await call('manager', 'PATCH', `/barbers/${ids.b2}`, { weeklySchedule })).status).toBe(
      200,
    )
    const day = dayOf(rowOf((await roster('admin')).json, ids.b2), '2027-03-06')
    expect(day).toMatchObject({ status: 'work', override: false, start: '10:00', end: '15:00' })
    expect(dayOf(rowOf((await roster('admin')).json, ids.b2), '2027-03-01').status).toBe('off')
  })
})
