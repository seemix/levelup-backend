// @vitest-environment node
import { createLocalReq, getPayload, handleEndpoints, type Payload } from 'payload'
import { beforeAll, describe, expect, it } from 'vitest'

import { can, type PolicyUser } from '@/access/policy'
import {
  clientsToCsv,
  csvCell,
  searchPatterns,
  toStats,
  type ClientReportRow,
  type CsvLabels,
} from '@/crm/client-report'
import { localToInstant } from '@/crm/time'
import { up as appointmentsUp } from '@/migrations/20261113_000004_appointments'
import { up as clientsUp } from '@/migrations/20261113_000002_clients'
import config from '@/payload.config'

const u = (roles: string[]): PolicyUser => ({ id: 'u1', roles })

describe('client report: pure helpers', () => {
  it('policy: admin and manager read, barber/editor/anonymous do not', () => {
    expect(can(u(['admin']), 'read', 'reports.clients')).toBe(true)
    expect(can(u(['manager']), 'read', 'reports.clients')).toBe(true)
    for (const user of [u(['barber']), u(['editor']), null])
      expect(can(user, 'read', 'reports.clients')).toBe(false)
    expect(can(u(['admin']), 'update', 'reports.clients')).toBe(false)
  })

  it('searchPatterns: name always, phone from 3 digits without 0/373 prefix, regex escaped', () => {
    expect(searchPatterns('   ')).toBeNull()
    expect(searchPatterns('Anna')).toEqual({ name: 'Anna', phone: null })
    expect(searchPatterns('069 123')).toEqual({ name: '069 123', phone: '69123' })
    expect(searchPatterns('+373 69 123')?.phone).toBe('69123')
    expect(searchPatterns('06')?.phone).toBeNull()
    expect(searchPatterns('a.b(c')?.name).toBe('a\\.b\\(c')
  })

  it('toStats rounds the average check half up and keeps null without paid visits', () => {
    expect(toStats({ avgCheck: 40000.5 }).avgCheck).toBe(40001)
    expect(toStats({ avgCheck: null }).avgCheck).toBeNull()
    expect(toStats({}).visits).toBe(0)
  })

  it('csvCell quotes, doubles quotes and neutralizes formulas in free text', () => {
    expect(csvCell('a;b')).toBe('"a;b"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvCell('=SUM(A1)', true)).toBe("'=SUM(A1)")
    expect(csvCell('@x', true)).toBe("'@x")
    expect(csvCell('+37369000001')).toBe('+37369000001')
    expect(csvCell(null)).toBe('')
  })

  it('clientsToCsv: BOM, header, CRLF, local date and decimal money', () => {
    const labels: CsvLabels = {
      client: 'Client',
      phone: 'Phone',
      visits: 'Visits',
      lastVisit: 'Last',
      avgCheck: 'Avg',
      cancelledByClient: 'CC',
      cancelledBySalon: 'CS',
      noShows: 'NS',
    }
    const row: ClientReportRow = {
      id: '1',
      firstName: '=Evil',
      lastName: 'Name',
      phone: '+37369000001',
      blocked: false,
      visits: 2,
      // 22:30 UTC on Dec 3 is already Dec 4 in Chișinău.
      lastVisit: '2026-12-03T22:30:00.000Z',
      avgCheck: 12050,
      cancelledByClient: 1,
      cancelledBySalon: 0,
      noShows: 3,
    }
    expect(clientsToCsv([row], labels)).toBe(
      '﻿Client;Phone;Visits;Last;Avg;CC;CS;NS\r\n' +
        "'=Evil Name;+37369000001;2;2026-12-04;120.50;1;0;3\r\n",
    )
  })
})

// ---------------------------------------------------------------------------
// Controlled data set (not the random seed): every number below is counted by hand.
//
//   locA: Anna (b1), Clara (b1)            locB: Boris (b2), Clara (b2), Dan (b2)
//
//   Anna  +37369000001  locA/b1
//     12-01 paid 30000 · 12-02 paid 50001 · 12-03 completed 40000 (unpaid)
//     12-04 cancelled_by_client · 12-05 no_show · 12-20 scheduled (counts nowhere)
//     → visits 3, last 12-03, avg (30000+50001)/2 = 40000.5 → 40001, cc 1, cs 0, ns 1
//   Boris +37369000002  locB/b2
//     12-10 paid 20000 · 12-11, 12-12 cancelled_by_salon
//     → visits 1, last 12-10, avg 20000, cc 0, cs 2, ns 0
//   Clara +37369000003
//     locA/b1: 12-06 completed 15000 (unpaid) · locB/b2: 12-07 paid 10000
//     admin: visits 2, last 12-07, avg 10000 · manager A: visits 1, last 12-06, avg null
//   Dan   +37369000004  locB/b2: 12-08 cancelled_by_client
//     → visits 0, last null, avg null, cc 1
//   Eve   +37369000005  no appointments → absent from the report
// ---------------------------------------------------------------------------

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
type Doc = Record<string, unknown> & { id: string }
type Who = 'admin' | 'manager' | 'managerB' | 'barber' | 'editor' | 'anon'

describe('client report: endpoints on a controlled data set', () => {
  let payload: Payload
  const ids: Record<string, string> = {}
  const tokens: Partial<Record<Who, string>> = {}

  const call = async (who: Who, path: string) => {
    const headers = new Headers()
    if (tokens[who]) headers.set('Authorization', `Bearer ${tokens[who]}`)
    const response = await handleEndpoints({
      config,
      request: new Request(`http://localhost:3000/api${path}`, { method: 'GET', headers }),
    })
    const bytes = new Uint8Array(await response.clone().arrayBuffer())
    const text = await response.text()
    const isJson = response.headers.get('content-type')?.includes('json')
    return {
      status: response.status,
      headers: response.headers,
      bytes,
      text,
      json: (isJson && text ? JSON.parse(text) : null) as Json,
    }
  }

  const create = async (collection: string, data: Record<string, unknown>) =>
    (await payload.create({ collection, data, overrideAccess: true } as never)) as unknown as Doc

  const report = async (who: Who, query = '') => {
    const result = await call(who, `/crm/reports/clients${query ? `?${query}` : ''}`)
    expect(result.status).toBe(200)
    return result.json as { rows: Json[]; total: number; page: number; limit: number }
  }
  const names = (rows: Json[]) => rows.map((row) => row.firstName)

  const stats = (row: Json) => ({
    visits: row.visits,
    lastVisit: row.lastVisit ? String(row.lastVisit).slice(0, 10) : null,
    avgCheck: row.avgCheck,
    cc: row.cancelledByClient,
    cs: row.cancelledBySalon,
    ns: row.noShows,
  })

  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    await Promise.all(Object.values(payload.db.collections).map((model) => model.init()))
    const req = await createLocalReq({}, payload)
    await clientsUp({ payload, req } as Parameters<typeof clientsUp>[0])
    await appointmentsUp({ payload, req } as Parameters<typeof appointmentsUp>[0])

    ids.locA = (await create('locations', { name: 'A', order: 1 })).id
    ids.locB = (await create('locations', { name: 'B', order: 2 })).id
    ids.cut = (await create('services', { name: 'Cut', durationMinutes: 30, price: 30_000 })).id
    for (const [key, roles, locations] of [
      ['admin', ['admin'], []],
      ['manager', ['manager'], [ids.locA]],
      ['managerB', ['manager'], [ids.locB]],
      ['barber', ['barber'], []],
      ['editor', ['editor'], []],
    ] as const) {
      const email = `${key}-report@test.local`
      ids[key] = (
        await create('users', {
          email,
          password: 'test',
          roles: [...roles],
          locations: [...locations],
        })
      ).id
      tokens[key] = (
        await payload.login({ collection: 'users', data: { email, password: 'test' } })
      ).token as string
    }
    const barber = async (name: string, order: number, location: string) =>
      (await create('barbers', { name, order, showOnSite: false, locations: [location] })).id
    ids.b1 = await barber('One', 1, ids.locA)
    ids.b2 = await barber('Two', 2, ids.locB)

    const client = async (firstName: string, lastName: string, n: number) =>
      (await create('clients', { firstName, lastName, phone: `+3736900000${n}` })).id
    ids.anna = await client('Anna', 'Alpha', 1)
    ids.boris = await client('Boris', 'Beta', 2)
    ids.clara = await client('Clara', 'Gamma', 3)
    ids.dan = await client('Dan', 'Delta', 4)
    ids.eve = await client('Eve', 'Epsilon', 5)

    // Raw inserts: the statuses are fixed by hand, no hooks or status machine involved.
    const { Types } = payload.db.collections['appointments'].base
    const oid = (id: string) => new Types.ObjectId(id)
    const row = (
      client: string,
      location: string,
      barberId: string,
      date: string,
      status: string,
      total = 0,
    ) => ({
      kind: 'appointment',
      status,
      client: oid(client),
      location: oid(location),
      barber: oid(barberId),
      service: oid(ids.cut),
      startAt: localToInstant(date, '15:00'),
      endAt: localToInstant(date, '15:30'),
      durationMinutes: 30,
      total,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    const A = ids.locA
    const B = ids.locB
    await payload.db.collections['appointments'].collection.insertMany([
      row(ids.anna, A, ids.b1, '2026-12-01', 'paid', 30_000),
      row(ids.anna, A, ids.b1, '2026-12-02', 'paid', 50_001),
      row(ids.anna, A, ids.b1, '2026-12-03', 'completed', 40_000),
      row(ids.anna, A, ids.b1, '2026-12-04', 'cancelled_by_client', 30_000),
      row(ids.anna, A, ids.b1, '2026-12-05', 'no_show', 30_000),
      row(ids.anna, A, ids.b1, '2026-12-20', 'scheduled', 30_000),
      row(ids.boris, B, ids.b2, '2026-12-10', 'paid', 20_000),
      row(ids.boris, B, ids.b2, '2026-12-11', 'cancelled_by_salon', 20_000),
      row(ids.boris, B, ids.b2, '2026-12-12', 'cancelled_by_salon', 20_000),
      row(ids.clara, A, ids.b1, '2026-12-06', 'completed', 15_000),
      row(ids.clara, B, ids.b2, '2026-12-07', 'paid', 10_000),
      row(ids.dan, B, ids.b2, '2026-12-08', 'cancelled_by_client', 30_000),
    ] as never[])
  })

  it('admin: every client with appointments, stats counted by hand, Eve absent', async () => {
    const { rows, total } = await report('admin')
    expect(total).toBe(4)
    expect(names(rows)).toEqual(['Anna', 'Boris', 'Clara', 'Dan'])
    expect(rows.map((row) => row.phone)).toEqual([
      '+37369000001',
      '+37369000002',
      '+37369000003',
      '+37369000004',
    ])
    const [anna, boris, clara, dan] = rows.map(stats)
    expect(anna).toEqual({
      visits: 3,
      lastVisit: '2026-12-03',
      avgCheck: 40_001,
      cc: 1,
      cs: 0,
      ns: 1,
    })
    expect(boris).toEqual({
      visits: 1,
      lastVisit: '2026-12-10',
      avgCheck: 20_000,
      cc: 0,
      cs: 2,
      ns: 0,
    })
    expect(clara).toEqual({
      visits: 2,
      lastVisit: '2026-12-07',
      avgCheck: 10_000,
      cc: 0,
      cs: 0,
      ns: 0,
    })
    expect(dan).toEqual({ visits: 0, lastVisit: null, avgCheck: null, cc: 1, cs: 0, ns: 0 })
  })

  it('period: inclusive local days; the scheduled appointment of 12-20 is not a visit', async () => {
    const one = await report('admin', 'from=2026-12-02&to=2026-12-03')
    expect(names(one.rows)).toEqual(['Anna'])
    expect(stats(one.rows[0]!)).toEqual({
      visits: 2,
      lastVisit: '2026-12-03',
      avgCheck: 50_001,
      cc: 0,
      cs: 0,
      ns: 0,
    })
    // `to` day included in full (15:00 local), `from` day included too.
    expect(names((await report('admin', 'from=2026-12-03&to=2026-12-03')).rows)).toEqual(['Anna'])
    expect(names((await report('admin', 'from=2026-12-11')).rows)).toEqual(['Anna', 'Boris'])
    expect((await report('admin', 'from=2027-01-01')).total).toBe(0)
  })

  it('location and barber filters restrict the appointments that are counted', async () => {
    const inB = await report('admin', `location=${ids.locB}`)
    expect(names(inB.rows)).toEqual(['Boris', 'Clara', 'Dan'])
    expect(stats(inB.rows[1]!)).toMatchObject({ visits: 1, avgCheck: 10_000 })

    const byBarber = await report('admin', `barber=${ids.b1}`)
    expect(names(byBarber.rows)).toEqual(['Anna', 'Clara'])
    expect(stats(byBarber.rows[1]!)).toMatchObject({
      visits: 1,
      lastVisit: '2026-12-06',
      avgCheck: null,
    })
  })

  it('manager: only their locations; a foreign location is 403', async () => {
    const own = await report('manager')
    expect(names(own.rows)).toEqual(['Anna', 'Clara'])
    // Clara's paid visit in B is invisible to the manager of A.
    expect(stats(own.rows[1]!)).toEqual({
      visits: 1,
      lastVisit: '2026-12-06',
      avgCheck: null,
      cc: 0,
      cs: 0,
      ns: 0,
    })
    expect(names((await report('manager', `location=${ids.locA}`)).rows)).toEqual(['Anna', 'Clara'])
    expect((await call('manager', `/crm/reports/clients?location=${ids.locB}`)).status).toBe(403)
    expect(names((await report('managerB')).rows)).toEqual(['Boris', 'Clara', 'Dan'])
  })

  it('roles: barber and editor 403, anonymous 401', async () => {
    expect((await call('barber', '/crm/reports/clients')).status).toBe(403)
    expect((await call('editor', '/crm/reports/clients')).status).toBe(403)
    expect((await call('anon', '/crm/reports/clients')).status).toBe(401)
    expect((await call('barber', `/crm/reports/clients/${ids.anna}`)).status).toBe(403)
    expect((await call('anon', `/crm/reports/clients/${ids.anna}`)).status).toBe(401)
  })

  it('search by name (any part, any case) and by phone; regex characters are literal', async () => {
    expect(names((await report('admin', 'q=boris')).rows)).toEqual(['Boris'])
    expect(names((await report('admin', 'q=GAMMA')).rows)).toEqual(['Clara'])
    expect(names((await report('admin', 'q=clara%20gam')).rows)).toEqual(['Clara'])
    expect(names((await report('admin', 'q=069000003')).rows)).toEqual(['Clara'])
    expect(
      names((await report('admin', `q=${encodeURIComponent('+373 69 000 004')}`)).rows),
    ).toEqual(['Dan'])
    expect((await report('admin', 'q=zzz')).total).toBe(0)
    expect((await report('admin', `q=${encodeURIComponent('.*')}`)).total).toBe(0)
    expect((await report('admin', `q=${encodeURIComponent('(')}`)).total).toBe(0)
    // Search composes with the manager's scope.
    expect(names((await report('manager', 'q=boris')).rows)).toEqual([])
  })

  it('sorting: by every column, both directions, ties by name', async () => {
    const order = async (query: string) => names((await report('admin', query)).rows)
    expect(await order('sort=name&order=desc')).toEqual(['Dan', 'Clara', 'Boris', 'Anna'])
    expect(await order('sort=visits')).toEqual(['Anna', 'Clara', 'Boris', 'Dan'])
    expect(await order('sort=visits&order=asc')).toEqual(['Dan', 'Boris', 'Clara', 'Anna'])
    expect(await order('sort=lastVisit')).toEqual(['Boris', 'Clara', 'Anna', 'Dan'])
    expect(await order('sort=avgCheck')).toEqual(['Anna', 'Boris', 'Clara', 'Dan'])
    expect(await order('sort=cancelledBySalon')).toEqual(['Boris', 'Anna', 'Clara', 'Dan'])
    expect(await order('sort=cancelledByClient')).toEqual(['Anna', 'Dan', 'Boris', 'Clara'])
    expect(await order('sort=noShows')).toEqual(['Anna', 'Boris', 'Clara', 'Dan'])
  })

  it('paging: total is the number of matching clients, pages are slices of the sorted list', async () => {
    const first = await report('admin', 'limit=3')
    expect(first.total).toBe(4)
    expect(names(first.rows)).toEqual(['Anna', 'Boris', 'Clara'])
    const second = await report('admin', 'limit=3&page=2')
    expect(names(second.rows)).toEqual(['Dan'])
    expect(second.page).toBe(2)
    expect(names((await report('admin', 'limit=3&page=3')).rows)).toEqual([])
  })

  it('validation: bad dates, order, sort, ids, page size → 400 VALIDATION_ERROR', async () => {
    for (const query of [
      'from=2026-13-01',
      'to=yesterday',
      'from=2026-12-05&to=2026-12-01',
      'sort=password',
      'order=sideways',
      'location=not-an-id',
      'barber=1',
      'limit=1000',
      'limit=0',
      'page=0',
      'format=xml',
      `q=${'x'.repeat(65)}`,
    ]) {
      const result = await call('admin', `/crm/reports/clients?${query}`)
      expect(result.status, query).toBe(400)
      expect(result.json.error.code, query).toBe('VALIDATION_ERROR')
    }
  })

  it('CSV: a file with the filtered rows in the requested language', async () => {
    const result = await call('admin', '/crm/reports/clients?format=csv&locale=ru&sort=visits')
    expect(result.status).toBe(200)
    expect(result.headers.get('content-type')).toContain('text/csv')
    expect(result.headers.get('content-disposition')).toContain('attachment')
    // UTF-8 BOM (`Response.text()` strips it, so the raw bytes are checked).
    expect([...result.bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    const lines = result.text.trimEnd().split('\r\n')
    expect(lines[0]).toBe(
      'Клиент;Телефон;Визиты;Последний визит;Средний чек;Отмены клиентом;Отмены салоном;Неявки',
    )
    expect(lines).toHaveLength(5)
    expect(lines[1]).toBe('Anna Alpha;+37369000001;3;2026-12-03;400.01;1;0;1')
    expect(lines[4]).toBe('Dan Delta;+37369000004;0;;;1;0;0')

    // Paging parameters do not cut an export; the manager's scope and filters still apply.
    const scoped = await call(
      'manager',
      '/crm/reports/clients?format=csv&limit=1&q=clara&locale=en',
    )
    const scopedLines = scoped.text.trimEnd().split('\r\n')
    expect(scopedLines[0]).toBe(
      'Client;Phone;Visits;Last visit;Average check;Cancelled by client;Cancelled by salon;No-shows',
    )
    expect(scopedLines[1]).toBe('Clara Gamma;+37369000003;1;2026-12-06;;0;0;0')
    expect((await call('barber', '/crm/reports/clients?format=csv')).status).toBe(403)
  })

  it('card: statistics and the visit history, newest first', async () => {
    const { status, json } = await call('admin', `/crm/reports/clients/${ids.clara}?locale=en`)
    expect(status).toBe(200)
    expect(json.client).toMatchObject({ firstName: 'Clara', phone: '+37369000003', blocked: false })
    expect(json.client.email).toBeUndefined()
    expect(stats(json.stats)).toEqual({
      visits: 2,
      lastVisit: '2026-12-07',
      avgCheck: 10_000,
      cc: 0,
      cs: 0,
      ns: 0,
    })
    expect(json.visits.map((visit: Json) => [visit.start.slice(0, 10), visit.status])).toEqual([
      ['2026-12-07', 'paid'],
      ['2026-12-06', 'completed'],
    ])
    expect(json.visits[0]).toMatchObject({
      barber: 'Two',
      service: 'Cut',
      location: 'B',
      total: 10_000,
    })
    expect(json.hasNext).toBe(false)

    const anna = await call('admin', `/crm/reports/clients/${ids.anna}`)
    expect(anna.json.visits).toHaveLength(6)
    expect(anna.json.visits[0].status).toBe('scheduled')
    expect(stats(anna.json.stats)).toMatchObject({ visits: 3, avgCheck: 40_001 })
  })

  it('card: a manager sees only the visits of their locations; barber 403, unknown client 404', async () => {
    const own = await call('manager', `/crm/reports/clients/${ids.clara}`)
    expect(own.status).toBe(200)
    expect(own.json.visits.map((visit: Json) => visit.start.slice(0, 10))).toEqual(['2026-12-06'])
    expect(stats(own.json.stats)).toMatchObject({ visits: 1, avgCheck: null })

    const foreign = await call('manager', `/crm/reports/clients/${ids.boris}`)
    expect(foreign.status).toBe(200)
    expect(foreign.json.visits).toEqual([])
    expect(stats(foreign.json.stats)).toMatchObject({ visits: 0, cs: 0 })

    const unknown = await call('admin', '/crm/reports/clients/aaaaaaaaaaaaaaaaaaaaaaaa')
    expect(unknown.status).toBe(404)
    expect((await call('admin', '/crm/reports/clients/not-an-id')).status).toBe(404)
    expect((await call('admin', `/crm/reports/clients/${ids.anna}?page=0`)).status).toBe(400)

    // Eve has no appointments: an empty card, not an error.
    const eve = await call('admin', `/crm/reports/clients/${ids.eve}`)
    expect(eve.status).toBe(200)
    expect(eve.json.visits).toEqual([])
    expect(stats(eve.json.stats)).toEqual({
      visits: 0,
      lastVisit: null,
      avgCheck: null,
      cc: 0,
      cs: 0,
      ns: 0,
    })
  })
})
