// @vitest-environment node
/**
 * Security review of stage 23 (spec §3.1, §9): the REST / GraphQL surface against the matrix for the
 * anonymous visitor and the non-CRM roles, the internal Payload collections, the jobs endpoints and the
 * personal data in the public booking responses.
 */
import { createLocalReq, getPayload, handleEndpoints, type Payload } from 'payload'
import { beforeAll, describe, expect, it } from 'vitest'

import { createAppointment } from '@/crm/appointments'
import { addLocalDays, localToInstant, todayLocal } from '@/crm/time'
import { up as appointmentsUp } from '@/migrations/20261113_000004_appointments'
import { up as ledgerUp } from '@/migrations/20261113_000005_ledger'
import config from '@/payload.config'

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
type Doc = Record<string, unknown> & { id: string }
type Who = 'anon' | 'editor' | 'barber' | 'manager' | 'admin'

const CLIENT_PHONE = '+37369700001'
const CLIENT_EMAIL = 'secret-client@example.com'

/** Collections nobody outside the CRM staff reads (anonymous and editor get nothing). */
const STAFF_ONLY = [
  'appointment-logs',
  'appointments',
  'cash-registers',
  'clients',
  'expense-categories',
  'gift-certificates',
  'promo-codes',
  'schedule-exceptions',
  'transactions',
] as const

/** Internal collections of Payload and the booking guard. */
const INTERNAL = ['booking-locks', 'payload-jobs'] as const

/** Barber fields that are CRM-only (spec §3.1): never in a public or editor response. */
const CRM_BARBER_FIELDS = [
  'weeklySchedule',
  'commissionServicesPercent',
  'commissionExtrasPercent',
  'user',
  'services',
  'active',
  'onlineBooking',
  'color',
  'locations',
  'prices',
]

describe('security: REST/GraphQL surface vs the access matrix', () => {
  let payload: Payload
  const ids: Record<string, string> = {}
  const tokens: Partial<Record<Who, string>> = {}
  let cancelToken = ''

  const create = async (collection: string, data: Record<string, unknown>) =>
    (await payload.create({ collection, data, overrideAccess: true } as never)) as unknown as Doc

  const call = async (who: Who, path: string, init: { method?: string; body?: unknown } = {}) => {
    const headers = new Headers({ 'Content-Type': 'application/json' })
    if (tokens[who]) headers.set('Authorization', `Bearer ${tokens[who]}`)
    const response = await handleEndpoints({
      config,
      request: new Request(`http://localhost:3000/api${path}`, {
        method: init.method ?? 'GET',
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      }),
    })
    const text = await response.text()
    let json: Json | null = null
    try {
      json = text ? (JSON.parse(text) as Json) : null
    } catch {
      json = null
    }
    return { status: response.status, text, json }
  }

  /** A REST list read: denied (401/403) or no documents. */
  const readsNothing = async (who: Who, slug: string) => {
    const { status, json } = await call(who, `/${slug}?depth=0&limit=100`)
    if (status === 200) expect(json?.docs ?? [], `${who} ${slug}`).toEqual([])
    else expect([401, 403], `${who} ${slug}`).toContain(status)
  }

  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    await Promise.all(Object.values(payload.db.collections).map((model) => model.init()))
    const req = await createLocalReq({}, payload)
    await appointmentsUp({ payload, req } as never)
    await ledgerUp({ payload, req } as never)

    ids.location = (await create('locations', { name: 'A', order: 1 })).id
    ids.cut = (await create('services', { name: 'Cut', durationMinutes: 30, price: 30_000 })).id
    for (const [key, roles, locations] of [
      ['admin', ['admin'], []],
      ['manager', ['manager'], [ids.location]],
      ['barber', ['barber'], []],
      ['editor', ['editor'], []],
    ] as const) {
      const email = `${key}-sec@test.local`
      ids[`user_${key}`] = (
        await create('users', {
          email,
          password: 'test',
          roles: [...roles],
          locations: [...locations],
        })
      ).id
      tokens[key] = (
        await payload.login({ collection: 'users', data: { email, password: 'test' } })
      ).token
    }
    ids.barber = (
      await create('barbers', {
        name: 'Public Barber',
        order: 1,
        showOnSite: true,
        description: 'desc',
        about: {
          root: {
            type: 'root',
            version: 1,
            direction: null,
            format: '',
            indent: 0,
            children: [
              {
                type: 'paragraph',
                version: 1,
                direction: null,
                format: '',
                indent: 0,
                children: [
                  {
                    type: 'text',
                    version: 1,
                    text: 'about',
                    format: 0,
                    detail: 0,
                    mode: 'normal',
                    style: '',
                  },
                ],
              },
            ],
          },
        },
        color: '#123456',
        locations: [ids.location],
        services: [ids.cut],
        user: ids.user_barber,
        commissionServicesPercent: 50,
        commissionExtrasPercent: 20,
        weeklySchedule: ['1', '2', '3', '4', '5', '6', '7'].map((weekday) => ({
          weekday,
          location: ids.location,
          start: '09:00',
          end: '21:00',
        })),
      })
    ).id
    ids.client = (
      await create('clients', { firstName: 'Secret', phone: CLIENT_PHONE, email: CLIENT_EMAIL })
    ).id
    const result = await createAppointment(
      await createLocalReq({}, payload),
      {
        location: ids.location,
        barber: ids.barber,
        service: ids.cut,
        client: ids.client,
        startAt: localToInstant(addLocalDays(todayLocal(), 3), '12:00').toISOString(),
      },
      { actorType: 'system', skipEmail: true },
    )
    cancelToken = result.cancelToken ?? ''
    expect(cancelToken).not.toBe('')
    await create('cash-registers', { name: 'Cash', type: 'cash', location: ids.location })
    await create('expense-categories', { name: 'Supplies' })
    await create('promo-codes', { code: 'SECRET10', discountType: 'percent', value: 10 })
  })

  it('anonymous and editor read none of the CRM / internal collections', async () => {
    for (const who of ['anon', 'editor'] as const)
      for (const slug of [...STAFF_ONLY, ...INTERNAL]) await readsNothing(who, slug)
  })

  it('barber: no clients, no expense categories, no internal collections', async () => {
    for (const slug of ['clients', 'expense-categories', ...INTERNAL])
      await readsNothing('barber', slug)
  })

  it('users: anonymous nothing; editor, barber and manager only themselves', async () => {
    await readsNothing('anon', 'users')
    for (const who of ['editor', 'barber', 'manager'] as const) {
      const { json } = await call(who, '/users?depth=0&limit=100')
      expect(json?.docs.map((doc: Json) => doc.id)).toEqual([ids[`user_${who}`]])
    }
  })

  it('public and editor barbers responses carry no CRM fields', async () => {
    for (const who of ['anon', 'editor'] as const) {
      const { status, json } = await call(who, '/barbers?depth=0')
      expect(status).toBe(200)
      const doc = json!.docs.find((row: Json) => row.id === ids.barber)
      expect(doc.name).toBe('Public Barber')
      // A denied array field comes back as an empty array (no rows): nothing is disclosed.
      for (const field of CRM_BARBER_FIELDS)
        if (Array.isArray(doc[field])) expect(doc[field], `${who}: ${field}`).toEqual([])
        else expect(doc, `${who}: ${field}`).not.toHaveProperty(field)
    }
    // A manager sees the schedule, never the commission.
    const manager = (await call('manager', `/barbers/${ids.barber}?depth=0`)).json!
    expect(manager).toHaveProperty('weeklySchedule')
    expect(manager).not.toHaveProperty('commissionServicesPercent')
    expect(manager).not.toHaveProperty('user')
    // The barber sees their own commission (§3.1).
    const own = (await call('barber', `/barbers/${ids.barber}?depth=0`)).json!
    expect(own.commissionServicesPercent).toBe(50)
  })

  it('a barber populating their appointment does not get the client e-mail', async () => {
    const { json } = await call('barber', '/appointments?depth=1&limit=10')
    expect(json!.docs).toHaveLength(1)
    expect(JSON.stringify(json)).not.toContain(CLIENT_EMAIL)
    expect(json!.docs[0]).not.toHaveProperty('cancelTokenHash')
  })

  it('booking-settings: the private fields are not public', async () => {
    const { json } = await call('anon', '/globals/booking-settings?depth=0')
    expect(json).not.toHaveProperty('senderName')
    expect(json).not.toHaveProperty('replyTo')
  })

  it('GraphQL follows the same access', async () => {
    const query = `{ Clients { docs { phone email } } Transactions { docs { id } } }`
    for (const who of ['anon', 'editor'] as const) {
      const { text } = await call(who, '/graphql', { method: 'POST', body: { query } })
      expect(text).not.toContain(CLIENT_PHONE)
      expect(text).not.toContain(CLIENT_EMAIL)
    }
  })

  it('jobs endpoints: only admin may run them (A40)', async () => {
    for (const who of ['anon', 'editor', 'barber', 'manager'] as const) {
      const run = await call(who, '/payload-jobs/run', { method: 'GET' })
      expect([401, 403], `${who} run`).toContain(run.status)
      const schedules = await call(who, '/payload-jobs/handle-schedules', { method: 'GET' })
      expect([401, 403], `${who} schedules`).toContain(schedules.status)
    }
    expect((await call('admin', '/payload-jobs/run', { method: 'GET' })).status).toBe(200)
  })

  it('public booking responses do not disclose personal data', async () => {
    const responses = [
      await call('anon', '/booking/config?locale=en'),
      await call('anon', `/booking/cancel/${cancelToken}?locale=en`),
    ]
    for (const { status, text } of responses) {
      expect(status).toBe(200)
      expect(text).not.toContain(CLIENT_PHONE)
      expect(text).not.toContain(CLIENT_EMAIL)
      expect(text).not.toContain('commission')
      expect(text).not.toContain('SECRET10')
      expect(text).not.toContain('-sec@test.local')
    }
    // A wrong token says nothing about the appointment.
    const wrong = await call('anon', `/booking/cancel/${'x'.repeat(cancelToken.length)}?locale=en`)
    expect(wrong.status).toBe(404)
    expect(wrong.json?.error?.code).toBe('TOKEN_INVALID')
  })
})
