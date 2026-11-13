import { createLocalReq, getPayload, handleEndpoints, type Payload } from 'payload'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { createAppointment, hashCancelToken } from '@/crm/appointments'
import { setCertificateLookup } from '@/crm/certificates'
import { getRateLimitStore } from '@/crm/rate-limit'
import { addLocalDays, addMinutes, localToInstant, todayLocal } from '@/crm/time'
import { clientIp } from '@/endpoints/booking/http'
import { up as appointmentsUp } from '@/migrations/20261113_000004_appointments'
import config from '@/payload.config'

// Every barber works 09:00–18:00 every day; bookings go a few days ahead (within the 30-day horizon).
const DAY = addLocalDays(todayLocal(), 3)
const DAY2 = addLocalDays(todayLocal(), 4)
const DAY3 = addLocalDays(todayLocal(), 5)
const iso = (time: string, date = DAY) => localToInstant(date, time).toISOString()

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
type Doc = Record<string, unknown> & { id: string }

/** Every public response body, checked at the end for leaked private data. */
const bodies: string[] = []

let ipCounter = 0
/** A fresh client IP per test, so rate limits of one test do not affect the others. */
const nextIp = () => `203.0.113.${++ipCounter}`

const call = async (
  method: 'GET' | 'POST' | 'OPTIONS',
  path: string,
  { body, ip = '198.51.100.1', origin }: { body?: unknown; ip?: string; origin?: string } = {},
) => {
  const headers = new Headers({ 'x-forwarded-for': ip })
  if (body !== undefined) headers.set('Content-Type', 'application/json')
  if (origin) headers.set('Origin', origin)
  const response = await handleEndpoints({
    config,
    request: new Request(`http://localhost:3000/api${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  })
  const text = await response.text()
  bodies.push(text)
  return {
    status: response.status,
    headers: response.headers,
    json: (text ? JSON.parse(text) : null) as Json,
  }
}

describe('public booking API', () => {
  let payload: Payload
  const ids: Record<string, string> = {}

  const create = async (collection: string, data: Record<string, unknown>) =>
    (await payload.create({ collection, data, overrideAccess: true } as never)) as unknown as Doc

  const find = async (collection: string, id: string) =>
    (await payload.findByID({
      collection,
      id,
      depth: 0,
      overrideAccess: true,
      showHiddenFields: true,
    } as never)) as unknown as Doc

  const selection = (patch: Record<string, unknown> = {}) => ({
    location: ids.loc,
    barber: ids.b2,
    service: ids.cut,
    extras: [] as string[],
    ...patch,
  })

  const booking = (patch: Record<string, unknown> = {}) => ({
    ...selection(),
    start: iso('10:00'),
    phone: '069 200 001',
    firstName: 'Nou',
    language: 'ro',
    honeypot: '',
    ...patch,
  })

  /** Plain cancel token from the queued confirmation email. */
  const tokenOf = async (appointmentId: string): Promise<string> => {
    const { docs } = await payload.find({
      collection: 'payload-jobs',
      pagination: false,
      depth: 0,
      overrideAccess: true,
    })
    const job = docs.find(
      (doc) =>
        (doc.input as { appointmentId?: string } | undefined)?.appointmentId === appointmentId,
    )
    return (job?.input as { cancelToken: string }).cancelToken
  }

  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    await Promise.all(Object.values(payload.db.collections).map((model) => model.init()))
    const req = await createLocalReq({}, payload)
    await appointmentsUp({ payload, req } as Parameters<typeof appointmentsUp>[0])

    ids.loc = (await create('locations', { name: 'Bălți RU', phone: '069000000' })).id
    await payload.update({
      collection: 'locations',
      id: ids.loc,
      locale: 'ro',
      data: { name: 'Bălți RO' },
      overrideAccess: true,
    })
    ids.locOff = (await create('locations', { name: 'Closed', active: false })).id
    ids.cat = (await create('service-categories', { name: 'Hair' })).id
    ids.cut = (
      await create('services', {
        name: 'Стрижка',
        category: ids.cat,
        durationMinutes: 30,
        price: 30_000,
      })
    ).id
    await payload.update({
      collection: 'services',
      id: ids.cut,
      locale: 'ro',
      data: { name: 'Tuns' },
      overrideAccess: true,
    })
    ids.beard = (await create('services', { name: 'Beard', durationMinutes: 20, price: 20_000 })).id
    ids.staffOnly = (
      await create('services', {
        name: 'Staff only',
        durationMinutes: 30,
        price: 10_000,
        onlineBooking: false,
      })
    ).id
    ids.wash = (await create('extras', { name: 'Wash', durationMinutes: 10, price: 5_000 })).id
    ids.wax = (
      await create('extras', {
        name: 'Wax',
        durationMinutes: 5,
        price: 3_000,
        appliesTo: [ids.beard],
      })
    ).id

    const weekly = ['1', '2', '3', '4', '5', '6', '7'].map((weekday) => ({
      weekday,
      location: ids.loc,
      start: '09:00',
      end: '18:00',
    }))
    const barber = async (name: string, order: number, extra: Record<string, unknown> = {}) =>
      (
        await create('barbers', {
          name,
          order,
          showOnSite: false,
          locations: [ids.loc],
          services: [ids.cut, ids.beard],
          weeklySchedule: weekly,
          commissionServicesPercent: 40,
          commissionExtrasPercent: 30,
          ...extra,
        })
      ).id
    ids.b1 = await barber('One', 1)
    ids.b2 = await barber('Two', 2)
    ids.bOff = await barber('Offline', 3, { onlineBooking: false })
    // Barber One charges more for the cut and takes longer.
    await create('barber-prices', {
      barber: ids.b1,
      item: { relationTo: 'services', value: ids.cut },
      price: 35_000,
      durationMinutes: 45,
    })

    ids.known = (
      await create('clients', {
        firstName: 'Ion',
        lastName: 'Secretescu',
        phone: '069100001',
        email: 'ion.secret@example.com',
        notes: 'VIP-NOTE-PRIVATE',
        language: 'ru',
      })
    ).id
    ids.blocked = (
      await create('clients', { firstName: 'Bad', phone: '069100009', blocked: true })
    ).id

    ids.sale = (
      await create('promo-codes', { code: 'SALE10', discountType: 'percent', value: 10 })
    ).id
    await create('promo-codes', {
      code: 'STAFF50',
      discountType: 'percent',
      value: 50,
      onlineAllowed: false,
    })

    setCertificateLookup(async (_req, code) =>
      code === 'LU-AAAA-BBBB' ? { code, balance: 10_000 } : null,
    )
  })

  afterAll(() => setCertificateLookup())

  beforeEach(async () => {
    await getRateLimitStore().reset()
  })

  describe('config', () => {
    it('returns bookable locations, barbers, services and extras with "from" prices', async () => {
      const { status, json, headers } = await call('GET', '/booking/config?locale=ro', {
        ip: nextIp(),
      })
      expect(status).toBe(200)
      expect(headers.get('cache-control')).toContain('max-age')
      expect(json.locale).toBe('ro')
      expect(json.settings).toMatchObject({
        slotStepMinutes: 15,
        minLeadMinutes: 120,
        horizonDays: 30,
        clientCancelMinHours: 3,
        onlineBookingEnabled: true,
        timeZone: 'Europe/Chisinau',
      })
      expect(json.locations).toEqual([
        { id: ids.loc, name: 'Bălți RO', address: null, phone: '+37369000000', mapUrl: null },
      ])
      expect(json.services.map((s: Json) => s.id).sort()).toEqual([ids.cut, ids.beard].sort())
      const cut = json.services.find((s: Json) => s.id === ids.cut)
      expect(cut).toMatchObject({
        name: 'Tuns',
        price: 30_000,
        priceFrom: 30_000,
        category: ids.cat,
      })
      expect(cut.barbers.sort()).toEqual([ids.b1, ids.b2].sort())
      expect(json.extras.find((e: Json) => e.id === ids.wax)).toMatchObject({
        appliesTo: [ids.beard],
        appliesToAll: false,
      })
      expect(json.barbers.map((b: Json) => b.id)).toEqual([ids.b1, ids.b2])
      const one = json.barbers[0]
      expect(Object.keys(one).sort()).toEqual(
        [
          'description',
          'extras',
          'id',
          'image',
          'locations',
          'name',
          'position',
          'services',
        ].sort(),
      )
      expect(one.services.find((s: Json) => s.id === ids.cut)).toEqual({
        id: ids.cut,
        price: 35_000,
        durationMinutes: 45,
      })
    })
  })

  describe('days and slots', () => {
    it('lists days with free slots and the slots of a day (any barber: auto-pick first)', async () => {
      const ip = nextIp()
      const days = await call(
        'GET',
        `/booking/days?location=${ids.loc}&barber=any&service=${ids.cut}&from=${DAY}&to=${DAY3}`,
        { ip },
      )
      expect(days.status).toBe(200)
      expect(days.json.days).toEqual([DAY, DAY2, DAY3])

      const slots = await call(
        'GET',
        `/booking/slots?location=${ids.loc}&barber=any&service=${ids.cut}&extras[]=${ids.wash}&date=${DAY}`,
        { ip },
      )
      expect(slots.status).toBe(200)
      const ten = slots.json.slots.find((slot: Json) => slot.time === '10:00')
      expect(ten.start).toBe(iso('10:00'))
      // Equal load → lower `order` first; durations differ per barber (45 + 10 vs 30 + 10).
      expect(ten.barbers).toEqual([
        { id: ids.b1, end: iso('10:55'), durationMinutes: 55 },
        { id: ids.b2, end: iso('10:40'), durationMinutes: 40 },
      ])
      // The last start of the day still ends by 18:00.
      expect(slots.json.slots.at(-1).time).toBe('17:15')
    })

    it('validates the query and the selection', async () => {
      const ip = nextIp()
      const bad = await call(
        'GET',
        `/booking/slots?location=x&service=${ids.cut}&date=2026-13-01`,
        {
          ip,
        },
      )
      expect(bad.status).toBe(400)
      expect(bad.json.error).toEqual({
        code: 'VALIDATION_ERROR',
        details: { fields: ['location', 'date'] },
      })
      const q = (patch: string) =>
        call('GET', `/booking/slots?date=${DAY}&${patch}`, { ip }).then((r) => r.json.error?.code)
      expect(await q(`location=${ids.locOff}&service=${ids.cut}`)).toBe('LOCATION_NOT_FOUND')
      expect(await q(`location=${ids.loc}&barber=${ids.bOff}&service=${ids.cut}`)).toBe(
        'BARBER_NOT_FOUND',
      )
      expect(await q(`location=${ids.loc}&service=${ids.staffOnly}`)).toBe('SERVICE_NOT_FOUND')
      expect(await q(`location=${ids.loc}&service=${ids.cut}&extras=${ids.wax}`)).toBe(
        'EXTRA_NOT_APPLICABLE',
      )
    })
  })

  describe('quote', () => {
    it('prices the selection for a barber, and "from" for any barber', async () => {
      const ip = nextIp()
      const exact = await call('POST', '/booking/quote', {
        ip,
        body: selection({ barber: ids.b1, extras: [ids.wash] }),
      })
      expect(exact.status).toBe(200)
      expect(exact.json).toMatchObject({
        barber: ids.b1,
        priceFrom: false,
        subtotal: 40_000,
        promoDiscount: 0,
        total: 40_000,
        durationMinutes: 55,
        certificateCover: 0,
        toPay: 40_000,
      })
      const any = await call('POST', '/booking/quote', { ip, body: selection({ barber: 'any' }) })
      expect(any.json).toMatchObject({ barber: null, priceFrom: true, total: 30_000 })
    })

    it('applies a promo code and shows the certificate cover', async () => {
      const ip = nextIp()
      const { status, json } = await call('POST', '/booking/quote', {
        ip,
        body: selection({ promoCode: ' sale10 ', certificateCode: 'lu-aaaa-bbbb' }),
      })
      expect(status).toBe(200)
      expect(json).toMatchObject({
        promoCode: 'SALE10',
        certificateCode: 'LU-AAAA-BBBB',
        subtotal: 30_000,
        promoDiscount: 3_000,
        total: 27_000,
        certificateCover: 10_000,
        toPay: 17_000,
      })
      const code = (body: Json) =>
        call('POST', '/booking/quote', { ip, body: selection(body) }).then((r) => [
          r.status,
          r.json.error?.code,
        ])
      expect(await code({ promoCode: 'STAFF50' })).toEqual([404, 'PROMO_NOT_FOUND'])
      expect(await code({ promoCode: 'NOPE' })).toEqual([404, 'PROMO_NOT_FOUND'])
      expect(await code({ certificateCode: 'LU-0000-0000' })).toEqual([
        404,
        'CERTIFICATE_NOT_FOUND',
      ])
    })
  })

  describe('booking', () => {
    it('full scenario: new client books, gets an email with a cancel link and cancels', async () => {
      const ip = nextIp()
      const { status, json } = await call('POST', '/booking', {
        ip,
        body: booking({ lastName: 'Popescu', email: 'Nou@Example.com', comment: 'Fără grabă' }),
      })
      expect(status).toBe(200)
      expect(Object.keys(json).sort()).toEqual(
        ['barber', 'end', 'id', 'location', 'service', 'start', 'total'].sort(),
      )
      expect(json).toMatchObject({
        start: iso('10:00'),
        end: iso('10:30'),
        barber: { id: ids.b2, name: 'Two' },
        location: ids.loc,
        service: ids.cut,
        total: 30_000,
      })

      const appointment = await find('appointments', json.id)
      expect(appointment).toMatchObject({
        status: 'scheduled',
        source: 'online',
        language: 'ro',
        clientComment: 'Fără grabă',
        createdBy: null,
      })
      const client = await find('clients', String(appointment.client))
      expect(client).toMatchObject({
        firstName: 'Nou',
        lastName: 'Popescu',
        phone: '+37369200001',
        email: 'nou@example.com',
        language: 'ro',
        source: 'online',
      })
      const logs = await payload.find({
        collection: 'appointment-logs',
        where: { appointment: { equals: json.id } },
        depth: 0,
        overrideAccess: true,
      })
      expect(logs.docs[0]).toMatchObject({ action: 'create', actorType: 'client', actor: null })

      // The slot is gone for this barber.
      const slots = await call(
        'GET',
        `/booking/slots?location=${ids.loc}&barber=${ids.b2}&service=${ids.cut}&date=${DAY}`,
        { ip },
      )
      expect(slots.json.slots.some((slot: Json) => slot.time === '10:00')).toBe(false)
      const again = await call('POST', '/booking', {
        ip,
        body: booking({ phone: '069200002', firstName: 'Alt' }),
      })
      expect([again.status, again.json.error.code]).toEqual([409, 'SLOT_TAKEN'])

      // Cancel by the token from the confirmation email.
      const token = await tokenOf(json.id)
      expect(hashCancelToken(token)).toBe(appointment.cancelTokenHash)
      const info = await call('GET', `/booking/cancel/${token}?locale=ro`, { ip })
      expect(info.status).toBe(200)
      expect(info.json).toEqual({
        start: iso('10:00'),
        end: iso('10:30'),
        status: 'scheduled',
        barber: { name: 'Two' },
        service: { name: 'Tuns' },
        location: { name: 'Bălți RO', address: null, phone: '+37369000000' },
        clientCancelMinHours: 3,
        canCancel: true,
      })
      const cancel = await call('POST', `/booking/cancel/${token}`, { ip })
      expect(cancel.json).toEqual({ status: 'cancelled_by_client' })
      const cancelLog = await payload.find({
        collection: 'appointment-logs',
        where: { and: [{ appointment: { equals: json.id } }, { action: { equals: 'status' } }] },
        depth: 0,
        overrideAccess: true,
      })
      expect(cancelLog.docs[0]).toMatchObject({ actorType: 'client' })
      const twice = await call('POST', `/booking/cancel/${token}`, { ip })
      expect([twice.status, twice.json.error.code]).toEqual([409, 'CANCEL_NOT_ALLOWED'])
      expect((await call('GET', `/booking/cancel/${token}`, { ip })).json.canCancel).toBe(false)
    })

    it('existing client: data are neither overwritten nor returned; differences go to the comment', async () => {
      const ip = nextIp()
      const known = await call('POST', '/booking', {
        ip,
        body: booking({
          start: iso('11:00'),
          phone: '+373 69 100 001',
          firstName: 'Ivan',
          lastName: 'Other',
          email: 'attacker@example.com',
          language: 'en',
        }),
      })
      const fresh = await call('POST', '/booking', {
        ip,
        body: booking({ start: iso('12:00'), phone: '069200003', firstName: 'Fresh' }),
      })
      expect(known.status).toBe(200)
      expect(fresh.status).toBe(200)
      // Same shape whether the phone was known or not (A4).
      expect(Object.keys(known.json).sort()).toEqual(Object.keys(fresh.json).sort())
      expect(JSON.stringify(known.json)).not.toMatch(/Ion|Secretescu|ion\.secret|VIP/)

      const client = await find('clients', ids.known)
      expect(client).toMatchObject({
        firstName: 'Ion',
        lastName: 'Secretescu',
        email: 'ion.secret@example.com',
        notes: 'VIP-NOTE-PRIVATE',
        language: 'ru',
      })
      const appointment = await find('appointments', known.json.id)
      expect(String(appointment.client)).toBe(ids.known)
      expect(appointment.language).toBe('en')
      expect(appointment.clientComment).toBe(
        '[online] firstName: Ivan; lastName: Other; email: attacker@example.com',
      )
      // The confirmation goes to the stored address, never to the submitted one.
      const { docs: jobs } = await payload.find({
        collection: 'payload-jobs',
        pagination: false,
        depth: 0,
        overrideAccess: true,
      })
      expect(
        jobs.some(
          (job) =>
            (job.input as { appointmentId?: string }).appointmentId === known.json.id &&
            !JSON.stringify(job.input).includes('attacker'),
        ),
      ).toBe(true)
    })

    it('any barber: picks the free barber with the fewest appointments', async () => {
      const ip = nextIp()
      const first = await call('POST', '/booking', {
        ip,
        body: booking({ barber: 'any', start: iso('15:00', DAY2), phone: '069200010' }),
      })
      // Both are free and have no appointments that day → lower order (One).
      expect(first.json.barber.id).toBe(ids.b1)
      const second = await call('POST', '/booking', {
        ip,
        body: booking({ barber: 'any', start: iso('15:00', DAY2), phone: '069200011' }),
      })
      expect(second.json.barber.id).toBe(ids.b2)
      const third = await call('POST', '/booking', {
        ip,
        body: booking({ barber: 'any', start: iso('15:00', DAY2), phone: '069200012' }),
      })
      expect([third.status, third.json.error.code]).toEqual([409, 'SLOT_TAKEN'])
    })

    it('promo code + certificate: discount in the snapshot, code counted, certificate noted', async () => {
      const ip = nextIp()
      const { status, json } = await call('POST', '/booking', {
        ip,
        body: booking({
          start: iso('09:00', DAY2),
          phone: '069200020',
          promoCode: 'sale10',
          certificateCode: 'LU-AAAA-BBBB',
          comment: 'Hi',
        }),
      })
      expect(status).toBe(200)
      expect(json.total).toBe(27_000)
      const appointment = await find('appointments', json.id)
      expect(appointment).toMatchObject({
        promoCode: ids.sale,
        promoDiscount: 3_000,
        subtotal: 30_000,
      })
      expect(appointment.clientComment).toBe('Hi\n[online] certificate: LU-AAAA-BBBB')
      expect((await find('promo-codes', ids.sale)).usedCount).toBe(1)

      const staffCode = await call('POST', '/booking', {
        ip,
        body: booking({ start: iso('10:00', DAY2), phone: '069200021', promoCode: 'STAFF50' }),
      })
      expect([staffCode.status, staffCode.json.error.code]).toEqual([404, 'PROMO_NOT_FOUND'])
      const badCertificate = await call('POST', '/booking', {
        ip,
        body: booking({ start: iso('10:00', DAY2), phone: '069200021', certificateCode: 'X' }),
      })
      expect(badCertificate.json.error.code).toBe('CERTIFICATE_NOT_FOUND')
    })

    it('validates the input: phone, names, email, language, start on the grid, blocked client', async () => {
      const ip = nextIp()
      const post = (patch: Json) =>
        call('POST', '/booking', { ip, body: booking({ start: iso('16:00', DAY3), ...patch }) })
      expect((await post({ phone: '123' })).json.error).toEqual({ code: 'PHONE_INVALID' })
      expect((await post({ firstName: ' ', email: 'nope', language: 'de' })).json.error).toEqual({
        code: 'VALIDATION_ERROR',
        details: { fields: ['firstName', 'email', 'language'] },
      })
      expect((await post({ start: iso('16:05', DAY3) })).json.error.code).toBe('SLOT_UNAVAILABLE')
      expect((await post({ service: ids.staffOnly })).json.error.code).toBe('SERVICE_NOT_FOUND')
      expect((await post({ phone: '069100009' })).json.error.code).toBe('SLOT_UNAVAILABLE')
      const tooSoon = await post({ start: addMinutes(new Date(), 30).toISOString() })
      expect(tooSoon.json.error.code).toMatch(/SLOT_UNAVAILABLE|VALIDATION_ERROR/)
    })

    it('parallel requests: one slot is booked once; one new phone becomes one client', async () => {
      const day = addLocalDays(DAY3, 2)
      const slotRace = await Promise.all(
        [0, 1, 2, 3, 4].map((i) =>
          call('POST', '/booking', {
            ip: nextIp(),
            body: booking({ start: iso('10:00', day), phone: `06940000${i}` }),
          }),
        ),
      )
      expect(slotRace.filter((res) => res.status === 200)).toHaveLength(1)
      expect(slotRace.filter((res) => res.json.error?.code === 'SLOT_TAKEN')).toHaveLength(4)

      const phoneRace = await Promise.all(
        ['12:00', '13:00'].map((time) =>
          call('POST', '/booking', {
            ip: nextIp(),
            body: booking({ start: iso(time, day), phone: '069400100', firstName: 'Twin' }),
          }),
        ),
      )
      expect(phoneRace.map((res) => res.status)).toEqual([200, 200])
      const { totalDocs } = await payload.count({
        collection: 'clients',
        where: { phone: { equals: '+37369400100' } },
        overrideAccess: true,
      })
      expect(totalDocs).toBe(1)
    })

    it('limits active future bookings per phone to 3', async () => {
      const ip = nextIp()
      const post = (time: string) =>
        call('POST', '/booking', {
          ip,
          body: booking({ start: iso(time, DAY3), phone: '069200030' }),
        })
      for (const time of ['09:00', '10:00', '11:00']) expect((await post(time)).status).toBe(200)
      const fourth = await post('12:00')
      expect([fourth.status, fourth.json.error.code]).toEqual([409, 'ACTIVE_BOOKINGS_LIMIT'])
    })
  })

  describe('cancellation rules', () => {
    it('refuses too late (< clientCancelMinHours) and unknown tokens', async () => {
      const ip = nextIp()
      const req = await createLocalReq({}, payload)
      // Staff/system create one hour from now (outside the online lead time).
      const start = new Date(Math.ceil((Date.now() + 3_600_000) / 300_000) * 300_000)
      const { doc, cancelToken } = await createAppointment(req, {
        location: ids.loc,
        barber: ids.b1,
        client: ids.known,
        service: ids.beard,
        startAt: start.toISOString(),
      })
      const info = await call('GET', `/booking/cancel/${cancelToken}`, { ip })
      expect(info.json.canCancel).toBe(false)
      const late = await call('POST', `/booking/cancel/${cancelToken}`, { ip })
      expect([late.status, late.json.error.code]).toEqual([400, 'CANCEL_TOO_LATE'])
      expect((await find('appointments', String(doc.id))).status).toBe('scheduled')

      const unknown = 'A'.repeat(43)
      expect((await call('GET', `/booking/cancel/${unknown}`, { ip })).json.error.code).toBe(
        'TOKEN_INVALID',
      )
      expect((await call('POST', '/booking/cancel/short', { ip })).status).toBe(404)
    })
  })

  describe('anti-spam', () => {
    it('honeypot rejects without creating anything', async () => {
      const before = (await payload.count({ collection: 'appointments', overrideAccess: true }))
        .totalDocs
      const res = await call('POST', '/booking', {
        ip: nextIp(),
        body: booking({ start: iso('17:00', DAY3), phone: '069200040', honeypot: 'http://spam' }),
      })
      expect([res.status, res.json.error.code]).toEqual([400, 'BOOKING_REJECTED'])
      expect(
        (await payload.count({ collection: 'appointments', overrideAccess: true })).totalDocs,
      ).toBe(before)
    })

    it('rate limits reads: 30 per minute per IP', async () => {
      const ip = nextIp()
      for (let i = 0; i < 30; i++)
        expect((await call('GET', '/booking/cancel/short', { ip })).status).toBe(404)
      const limited = await call('GET', '/booking/config', { ip })
      expect(limited.status).toBe(429)
      expect(limited.json.error.code).toBe('RATE_LIMITED')
      expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0)
      // Another IP is not affected.
      expect((await call('GET', '/booking/cancel/short', { ip: nextIp() })).status).toBe(404)
    })

    it('rate limits bookings: 5 created per hour per IP, 20 attempts per hour per IP', async () => {
      const ip = nextIp()
      for (let i = 0; i < 5; i++) {
        const res = await call('POST', '/booking', {
          ip,
          body: booking({ start: iso(`1${i}:00`, addLocalDays(DAY3, 1)), phone: `06930000${i}` }),
        })
        expect(res.status).toBe(200)
      }
      const sixth = await call('POST', '/booking', {
        ip,
        body: booking({ start: iso('16:00', addLocalDays(DAY3, 1)), phone: '069300009' }),
      })
      expect([sixth.status, sixth.json.error.code]).toEqual([429, 'RATE_LIMITED'])

      const spammer = nextIp()
      for (let i = 0; i < 20; i++) {
        const res = await call('POST', '/booking', { ip: spammer, body: { honeypot: 'x' } })
        expect(res.json.error.code).toBe('BOOKING_REJECTED')
      }
      const blocked = await call('POST', '/booking', { ip: spammer, body: booking() })
      expect(blocked.json.error.code).toBe('RATE_LIMITED')
    })

    it('takes the client IP from the entry appended by the trusted proxy', () => {
      const req = { headers: new Headers({ 'x-forwarded-for': 'spoofed, 10.0.0.7' }) } as never
      expect(clientIp(req, 1)).toBe('10.0.0.7')
      expect(clientIp(req, 2)).toBe('spoofed')
      expect(clientIp(req, 0)).toBe('unknown')
    })
  })

  describe('CORS', () => {
    it('allows FRONTEND_URL on the public endpoints', async () => {
      const res = await call('GET', '/booking/config', {
        ip: nextIp(),
        origin: 'http://localhost:3001',
      })
      expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:3001')
      const other = await call('GET', '/booking/config', {
        ip: nextIp(),
        origin: 'https://evil.test',
      })
      expect(other.headers.get('access-control-allow-origin')).toBeNull()
      const preflight = await call('OPTIONS', '/booking', { origin: 'http://localhost:3001' })
      expect(preflight.status).toBe(200)
      expect(preflight.headers.get('access-control-allow-methods')).toContain('POST')
    })
  })

  it('no public response contains private client data, commissions or token hashes', async () => {
    const all = bodies.join('\n')
    expect(bodies.length).toBeGreaterThan(30)
    for (const secret of [
      'Secretescu',
      'ion.secret@example.com',
      'VIP-NOTE-PRIVATE',
      'commission',
      'cancelTokenHash',
      'internalNote',
      'weeklySchedule',
      'notes',
      '"user"',
      '"color"',
      'senderName',
      'replyTo',
    ])
      expect(all).not.toContain(secret)
  })
})
