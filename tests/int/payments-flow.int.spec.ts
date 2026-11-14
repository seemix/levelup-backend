// @vitest-environment node
import {
  createLocalReq,
  getPayload,
  handleEndpoints,
  type Payload,
  type PayloadRequest,
} from 'payload'
import { beforeAll, describe, expect, it } from 'vitest'

import {
  changeAppointmentStatus,
  createAppointment,
  type AppointmentInput,
} from '@/crm/appointments'
import { isCertificateCode } from '@/crm/certificates'
import { sellCertificate } from '@/crm/certificates.service'
import { createTransaction, recalculateBalances } from '@/crm/ledger.service'
import { payAppointment } from '@/crm/payments.service'
import { addLocalDays, localToInstant, todayLocal } from '@/crm/time'
import { up as appointmentsUp } from '@/migrations/20261113_000004_appointments'
import { up as ledgerUp } from '@/migrations/20261113_000005_ledger'
import { up as certificatesUp } from '@/migrations/20261114_000000_gift_certificates'
import config from '@/payload.config'

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
type Doc = Record<string, unknown> & { id: string }
type Who = 'admin' | 'manager' | 'managerB' | 'barber1' | 'barber2' | 'editor'

// Visits that already took place (yesterday and earlier) and a future one (prepayment).
const TODAY = todayLocal()
const PAST = addLocalDays(TODAY, -3)
const FUTURE = addLocalDays(TODAY, 5)
const DAY_MS = 86_400_000

describe('appointment payments, gift certificates, refunds (stage 18)', () => {
  let payload: Payload
  const ids: Record<string, string> = {}
  const users: Record<string, { id: string; roles: string[]; locations: string[] }> = {}
  const tokens: Partial<Record<Who, string>> = {}
  let slot = 0

  const create = async (collection: string, data: Record<string, unknown>) =>
    (await payload.create({ collection, data, overrideAccess: true } as never)) as unknown as Doc

  const reqFor = async (who?: Who): Promise<PayloadRequest> =>
    createLocalReq(who ? { user: { ...users[who], collection: 'users' } as never } : {}, payload)

  const find = async (collection: string, id: string) =>
    (await payload.findByID({
      collection,
      id,
      depth: 0,
      overrideAccess: true,
    } as never)) as unknown as Doc

  const balance = async (register: string) =>
    (await find('cash-registers', register)).balance as number

  const balances = async () => ({
    cashA: await balance(ids.cashA),
    cardA: await balance(ids.cardA),
    cashB: await balance(ids.cashB),
  })

  const count = async (collection: string) =>
    (await payload.count({ collection, overrideAccess: true } as never)).totalDocs

  const errorCode = async (promise: Promise<unknown>): Promise<string | undefined> => {
    try {
      await promise
    } catch (error) {
      const e = error as { data?: { code?: string }; name?: string }
      return e.data?.code ?? e.name
    }
    return undefined
  }

  const call = async (who: Who, path: string, body?: unknown) => {
    const headers = new Headers({ 'Content-Type': 'application/json' })
    if (tokens[who]) headers.set('Authorization', `Bearer ${tokens[who]}`)
    const response = await handleEndpoints({
      config,
      request: new Request(`http://localhost:3000/api${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body ?? {}),
      }),
    })
    const text = await response.text()
    return { status: response.status, json: (text ? JSON.parse(text) : null) as Json }
  }

  /** A fresh appointment (system, staff mode) in its own 30-minute slot; total 30 000 bani. */
  const book = async (
    patch: AppointmentInput = {},
    date: string = PAST,
    barber = ids.b1,
  ): Promise<Doc> => {
    const minutes = 9 * 60 + 30 * (slot++ % 16)
    const time = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
    const req = await createLocalReq({}, payload)
    const { doc } = await createAppointment(
      req,
      {
        location: ids.locA,
        barber,
        service: ids.cut,
        client: ids.client,
        startAt: localToInstant(date, time).toISOString(),
        ...patch,
      },
      { actorType: 'system', skipEmail: true },
    )
    return doc as Doc
  }

  const sell = async (nominal: number, register = ids.cashA) =>
    (
      await sellCertificate(await reqFor('admin'), {
        nominal,
        entries: [{ cashRegister: register, amount: nominal }],
      })
    ).certificate as Doc

  const pay = (who: Who, appointment: string, body: Json) =>
    call(who, `/crm/appointments/${appointment}/payments`, body)

  const logActions = async (appointment: string) =>
    (
      await payload.find({
        collection: 'appointment-logs',
        where: { appointment: { equals: appointment } },
        sort: 'at',
        depth: 0,
        pagination: false,
        overrideAccess: true,
      })
    ).docs.map((doc) => (doc as unknown as { action: string }).action)

  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    await Promise.all(Object.values(payload.db.collections).map((model) => model.init()))
    const req = await createLocalReq({}, payload)
    const args = { payload, req } as never
    await appointmentsUp(args)
    await ledgerUp(args)
    await certificatesUp(args)

    ids.locA = (await create('locations', { name: 'A', order: 1 })).id
    ids.locB = (await create('locations', { name: 'B', order: 2 })).id
    ids.cut = (await create('services', { name: 'Cut', durationMinutes: 30, price: 30_000 })).id

    for (const [key, roles, locations] of [
      ['admin', ['admin'], []],
      ['manager', ['manager'], [ids.locA]],
      ['managerB', ['manager'], [ids.locB]],
      ['barber1', ['barber'], []],
      ['barber2', ['barber'], []],
      ['editor', ['editor'], []],
    ] as const) {
      const email = `${key}-pay@test.local`
      const user = await create('users', {
        email,
        password: 'test',
        roles: [...roles],
        locations: [...locations],
      })
      users[key] = { id: user.id, roles: [...roles], locations: [...locations] }
      tokens[key] = (
        await payload.login({ collection: 'users', data: { email, password: 'test' } })
      ).token
    }

    const weekly = ['1', '2', '3', '4', '5', '6', '7'].map((weekday) => ({
      weekday,
      location: ids.locA,
      start: '09:00',
      end: '18:00',
    }))
    const barber = async (name: string, order: number, user: string) =>
      (
        await create('barbers', {
          name,
          order,
          showOnSite: false,
          color: '#123456',
          locations: [ids.locA],
          services: [ids.cut],
          weeklySchedule: weekly,
          user,
        })
      ).id
    ids.b1 = await barber('One', 1, users.barber1.id)
    ids.b2 = await barber('Two', 2, users.barber2.id)
    ids.client = (await create('clients', { firstName: 'Ion', phone: '069300001' })).id

    const register = async (name: string, location: string, type = 'cash') =>
      (await create('cash-registers', { name, type, location })).id
    ids.cashA = await register('Cash A', ids.locA)
    ids.cardA = await register('Card A', ids.locA, 'account')
    ids.cashB = await register('Cash B', ids.locB)
    ids.supplies = (await create('expense-categories', { name: 'Supplies' })).id
  })

  describe('certificate sale', () => {
    it('creates the certificate and the certificate_sale operation together', async () => {
      const before = await balances()
      const { status, json } = await call('admin', '/crm/certificates/sell', {
        nominal: 50_000,
        entries: [
          { cashRegister: ids.cashA, amount: 30_000 },
          { cashRegister: ids.cardA, amount: 20_000 },
        ],
        buyer: { name: 'Maria', phone: '069 300 002' },
      })
      expect(status).toBe(200)
      const { certificate, transaction, warnings } = json
      expect(warnings).toEqual([])
      expect(isCertificateCode(certificate.code)).toBe(true)
      expect(certificate).toMatchObject({
        nominal: 50_000,
        balance: 50_000,
        voided: false,
        buyerName: 'Maria',
        buyerPhone: '+37369300002',
        saleTransaction: transaction.id,
      })
      const expires = new Date(certificate.expiresAt).getTime()
      const issued = new Date(certificate.issuedAt).getTime()
      expect(expires - issued).toBeGreaterThan(364 * DAY_MS)
      expect(expires - issued).toBeLessThan(367 * DAY_MS)
      expect(transaction).toMatchObject({
        type: 'certificate_sale',
        location: ids.locA,
        certificate: certificate.id,
        author: users.admin.id,
      })
      expect(await find('gift-certificates', certificate.id)).toMatchObject({
        status: 'active',
        saleTransaction: transaction.id,
      })
      expect(await balances()).toEqual({
        ...before,
        cashA: before.cashA + 30_000,
        cardA: before.cardA + 20_000,
      })
    })

    it('manager sells in own location only; barber and editor cannot sell', async () => {
      const body = (register: string) => ({
        nominal: 10_000,
        entries: [{ cashRegister: register, amount: 10_000 }],
      })
      expect((await call('manager', '/crm/certificates/sell', body(ids.cashA))).status).toBe(200)
      const before = { certs: await count('gift-certificates'), txs: await count('transactions') }
      const foreign = await call('manager', '/crm/certificates/sell', body(ids.cashB))
      expect([foreign.status, foreign.json.error.code]).toEqual([403, 'TRANSACTION_FORBIDDEN'])
      const barber = await call('barber1', '/crm/certificates/sell', body(ids.cashA))
      expect([barber.status, barber.json.error.code]).toEqual([403, 'FORBIDDEN'])
      const editor = await call('editor', '/crm/certificates/sell', body(ids.cashA))
      expect([editor.status, editor.json.error.code]).toEqual([403, 'FORBIDDEN'])
      // Nothing is left behind by the rejected sales (one transaction).
      expect(await count('gift-certificates')).toBe(before.certs)
      expect(await count('transactions')).toBe(before.txs)
    })

    it('validates the sale; a certificate cannot be created or deleted directly', async () => {
      const before = await count('gift-certificates')
      const mismatch = await call('admin', '/crm/certificates/sell', {
        nominal: 10_000,
        entries: [{ cashRegister: ids.cashA, amount: 9_000 }],
      })
      expect(mismatch.json.error.code).toBe('LEDGER_SUM_INVALID')
      const invalid = await call('admin', '/crm/certificates/sell', {
        nominal: 0,
        entries: [],
        buyer: { phone: 5 },
      })
      expect(invalid.json.error).toEqual({
        code: 'VALIDATION_ERROR',
        details: { fields: ['nominal', 'entries', 'buyer.phone'] },
      })
      const badPhone = await call('admin', '/crm/certificates/sell', {
        nominal: 10_000,
        entries: [{ cashRegister: ids.cashA, amount: 10_000 }],
        buyer: { phone: '123' },
      })
      expect(badPhone.json.error.code).toBe('PHONE_INVALID')
      expect(await count('gift-certificates')).toBe(before)

      const admin = { ...users.admin, collection: 'users' } as never
      expect(
        await errorCode(
          payload.create({
            collection: 'gift-certificates',
            data: { nominal: 10_000, expiresAt: new Date(Date.now() + DAY_MS).toISOString() },
            user: admin,
            overrideAccess: false,
          } as never),
        ),
      ).toBe('CERTIFICATE_SALE_ONLY')

      const cert = await sell(10_000)
      expect(
        await errorCode(
          payload.delete({
            collection: 'gift-certificates',
            id: cert.id,
            user: admin,
            overrideAccess: false,
          } as never),
        ),
      ).toBe('Forbidden')
      // Admin edits void / comment; the amounts and the code never change.
      const updated = (await payload.update({
        collection: 'gift-certificates',
        id: cert.id,
        data: { balance: 1, nominal: 1, code: 'LU-AAAA-AAAA', comment: 'Gift' } as never,
        user: admin,
        overrideAccess: false,
      } as never)) as unknown as Doc
      expect(updated).toMatchObject({
        balance: 10_000,
        nominal: 10_000,
        code: cert.code,
        comment: 'Gift',
      })
      expect(
        await errorCode(
          payload.update({
            collection: 'gift-certificates',
            id: cert.id,
            data: { comment: 'x' },
            user: { ...users.manager, collection: 'users' },
            overrideAccess: false,
          } as never),
        ),
      ).toBe('Forbidden')
    })

    it('staff read certificates; the buyer is hidden from a barber', async () => {
      const cert = (
        await sellCertificate(await reqFor('admin'), {
          nominal: 5_000,
          entries: [{ cashRegister: ids.cashA, amount: 5_000 }],
          buyerName: 'Secret',
        })
      ).certificate
      const read = (who: Who) =>
        payload.findByID({
          collection: 'gift-certificates',
          id: cert.id,
          depth: 0,
          user: { ...users[who], collection: 'users' },
          overrideAccess: false,
        } as never) as unknown as Promise<Doc>
      expect((await read('manager')).buyerName).toBe('Secret')
      const barber = await read('barber1')
      expect(barber.code).toBe(cert.code)
      expect(barber.buyerName).toBeUndefined()
      expect(await errorCode(read('editor'))).toBe('Forbidden')
    })
  })

  describe('payment', () => {
    it('partial payment, then the rest split between registers → paid', async () => {
      const appointment = await book()
      const before = await balances()
      const first = await pay('barber1', appointment.id, {
        entries: [{ cashRegister: ids.cashA, amount: 10_000 }],
      })
      expect(first.status).toBe(200)
      expect(first.json.transaction).toMatchObject({
        type: 'appointment_payment',
        appointment: appointment.id,
        barber: ids.b1,
        location: ids.locA,
        author: users.barber1.id,
      })
      expect(first.json.appointment).toMatchObject({
        paidAmount: 10_000,
        paymentStatus: 'partial',
        status: 'scheduled',
      })

      const second = await pay('manager', appointment.id, {
        entries: [
          { cashRegister: ids.cashA, amount: 5_000 },
          { cashRegister: ids.cardA, amount: 15_000 },
        ],
      })
      expect(second.status).toBe(200)
      expect(second.json.appointment).toMatchObject({
        paidAmount: 30_000,
        certificateAmount: 0,
        paymentStatus: 'paid',
        // The visit has taken place: paying it in full completes it (A34).
        status: 'paid',
      })
      // Tips are not recorded (A45).
      expect(second.json.appointment).not.toHaveProperty('tipAmount')
      expect(second.json.transaction).not.toHaveProperty('tipAmount')
      expect(await balances()).toEqual({
        ...before,
        cashA: before.cashA + 15_000,
        cardA: before.cardA + 15_000,
      })
      expect(await logActions(appointment.id)).toEqual(['create', 'payment', 'payment'])

      // Nothing is due any more.
      const more = await pay('admin', appointment.id, {
        entries: [{ cashRegister: ids.cashA, amount: 100 }],
      })
      expect([more.status, more.json.error.code]).toEqual([409, 'PAYMENT_EXCEEDS_DUE'])
    })

    it('rejects an overpayment and foreign registers without changing anything', async () => {
      const appointment = await book()
      const before = { balances: await balances(), txs: await count('transactions') }
      const over = await pay('admin', appointment.id, {
        entries: [{ cashRegister: ids.cashA, amount: 30_001 }],
      })
      expect([over.status, over.json.error.code]).toEqual([409, 'PAYMENT_EXCEEDS_DUE'])
      const foreign = await pay('admin', appointment.id, {
        entries: [{ cashRegister: ids.cashB, amount: 10_000 }],
      })
      expect(foreign.json.error.code).toBe('CASH_REGISTER_INVALID')
      const empty = await pay('admin', appointment.id, { entries: [] })
      expect(empty.json.error).toEqual({
        code: 'VALIDATION_ERROR',
        details: { fields: ['entries'] },
      })
      expect(await balances()).toEqual(before.balances)
      expect(await count('transactions')).toBe(before.txs)
      expect(await find('appointments', appointment.id)).toMatchObject({
        paidAmount: 0,
        paymentStatus: 'unpaid',
      })
    })

    it('barber pays only own appointments; manager only in own locations', async () => {
      const appointment = await book()
      const body = { entries: [{ cashRegister: ids.cashA, amount: 10_000 }] }
      expect((await pay('barber2', appointment.id, body)).status).toBe(404)
      expect((await pay('managerB', appointment.id, body)).status).toBe(404)
      expect((await pay('editor', appointment.id, body)).status).toBe(403)
      // The service itself also refuses (ledger policy), even without the endpoint's read check.
      expect(await errorCode(payAppointment(await reqFor('barber2'), appointment.id, body))).toBe(
        'TRANSACTION_FORBIDDEN',
      )
      expect((await find('appointments', appointment.id)).paidAmount).toBe(0)
      const own = await book({}, PAST, ids.b2)
      expect((await pay('barber2', own.id, body)).status).toBe(200)
    })

    it('cancelled appointments and blocks are not payable', async () => {
      const appointment = await book()
      await changeAppointmentStatus(
        await createLocalReq({}, payload),
        appointment.id,
        'cancelled_by_client',
        { actorType: 'system', skipEmail: true },
      )
      const cancelled = await pay('admin', appointment.id, {
        entries: [{ cashRegister: ids.cashA, amount: 1_000 }],
      })
      expect(cancelled.json.error.code).toBe('APPOINTMENT_NOT_PAYABLE')
      const block = await book({ kind: 'block', service: null, client: null, durationMinutes: 30 })
      const blocked = await pay('admin', block.id, {
        entries: [{ cashRegister: ids.cashA, amount: 1_000 }],
      })
      expect(blocked.json.error.code).toBe('APPOINTMENT_NOT_PAYABLE')
    })

    it('prepayment keeps the visit scheduled; completing it then gives paid at once', async () => {
      const appointment = await book({}, FUTURE)
      const { json } = await pay('admin', appointment.id, {
        entries: [{ cashRegister: ids.cardA, amount: 30_000 }],
      })
      expect(json.appointment).toMatchObject({ paymentStatus: 'paid', status: 'scheduled' })
      const later = new Date(localToInstant(FUTURE, '20:00'))
      const { doc } = await changeAppointmentStatus(
        await reqFor('admin'),
        appointment.id,
        'completed',
        { now: later, skipEmail: true },
      )
      expect(doc.status).toBe('paid')
    })
  })

  describe('certificate at payment', () => {
    it('covers the rest by default; partial use leaves a balance', async () => {
      const cert = await sell(20_000)
      const appointment = await book()
      const { status, json } = await pay('barber1', appointment.id, {
        entries: [{ cashRegister: ids.cashA, amount: 20_000 }],
        certificateCode: (cert.code as string).toLowerCase(),
      })
      expect(status).toBe(200)
      // 20 000 money → the certificate covers 10 000 of its 20 000.
      expect(json.transaction).toMatchObject({
        certificate: cert.id,
        certificateAmount: 10_000,
      })
      expect(json.certificate).toMatchObject({ id: cert.id, balance: 10_000 })
      expect(json.appointment).toMatchObject({
        paidAmount: 30_000,
        certificateAmount: 10_000,
        status: 'paid',
      })
      expect(await find('gift-certificates', cert.id)).toMatchObject({
        balance: 10_000,
        status: 'active',
      })

      // Only the certificate: what is left on it.
      const next = await book()
      const rest = await pay('admin', next.id, { certificateCode: cert.code })
      expect(rest.json.appointment).toMatchObject({ paidAmount: 10_000, paymentStatus: 'partial' })
      expect(await find('gift-certificates', cert.id)).toMatchObject({
        balance: 0,
        status: 'depleted',
      })
      const empty = await pay('admin', next.id, { certificateCode: cert.code })
      expect([empty.status, empty.json.error.code]).toEqual([409, 'CERTIFICATE_INSUFFICIENT'])
    })

    it('refuses an amount above the balance, unknown, void and expired certificates', async () => {
      const appointment = await book()
      const cert = await sell(5_000)
      const code = async (body: Json) => (await pay('admin', appointment.id, body)).json.error?.code
      expect(await code({ certificateCode: cert.code, certificateAmount: 6_000 })).toBe(
        'CERTIFICATE_INSUFFICIENT',
      )
      expect(await code({ certificateCode: 'LU-ZZZZ-ZZZZ' })).toBe('CERTIFICATE_NOT_FOUND')

      const expired = await sell(5_000)
      await payload.db.collections['gift-certificates'].updateOne(
        { _id: expired.id },
        { $set: { expiresAt: new Date(Date.now() - DAY_MS) } },
      )
      expect(await code({ certificateCode: expired.code })).toBe('CERTIFICATE_EXPIRED')
      expect((await find('gift-certificates', expired.id)).status).toBe('expired')

      const voided = await sell(5_000)
      await payload.update({
        collection: 'gift-certificates',
        id: voided.id,
        data: { voided: true },
        user: { ...users.admin, collection: 'users' },
        overrideAccess: false,
      } as never)
      expect(await code({ certificateCode: voided.code })).toBe('CERTIFICATE_VOID')
      expect((await find('gift-certificates', voided.id)).balance).toBe(5_000)
      expect((await find('appointments', appointment.id)).paidAmount).toBe(0)
    })

    it('two parallel charges of one certificate never overdraw it', async () => {
      const cert = await sell(30_000)
      const first = await book()
      const second = await book()
      const results = await Promise.allSettled(
        [first, second].map(async (appointment) =>
          payAppointment(await reqFor('admin'), appointment.id, {
            entries: [],
            certificateCode: cert.code as string,
            certificateAmount: 20_000,
          }),
        ),
      )
      const fulfilled = results.filter((result) => result.status === 'fulfilled')
      const rejected = results.filter(
        (result): result is PromiseRejectedResult => result.status === 'rejected',
      )
      expect(fulfilled).toHaveLength(1)
      expect(rejected).toHaveLength(1)
      expect(['CERTIFICATE_INSUFFICIENT', 'LEDGER_CONFLICT']).toContain(
        (rejected[0].reason as { data?: { code?: string } }).data?.code,
      )
      expect((await find('gift-certificates', cert.id)).balance).toBe(10_000)
      const used = await payload.find({
        collection: 'transactions',
        where: { certificate: { equals: cert.id }, type: { equals: 'appointment_payment' } },
        depth: 0,
        overrideAccess: true,
      })
      expect(used.totalDocs).toBe(1)
      const paid = [
        await find('appointments', first.id),
        await find('appointments', second.id),
      ].map((doc) => doc.paidAmount)
      expect(paid.sort()).toEqual([0, 20_000])
    })
  })

  describe('refund', () => {
    it('two registers + certificate → refund restores registers, certificate and status', async () => {
      const cert = await sell(10_000)
      const appointment = await book()
      const before = await balances()
      const paid = await pay('barber1', appointment.id, {
        entries: [
          { cashRegister: ids.cashA, amount: 12_000 },
          { cashRegister: ids.cardA, amount: 8_000 },
        ],
        certificateCode: cert.code,
      })
      expect(paid.json.appointment).toMatchObject({
        paidAmount: 30_000,
        certificateAmount: 10_000,
        status: 'paid',
        paymentStatus: 'paid',
      })
      const paymentId = paid.json.transaction.id as string

      // Only admin refunds.
      for (const who of ['manager', 'barber1'] as const) {
        const denied = await call(who, `/crm/transactions/${paymentId}/refund`)
        expect([denied.status, denied.json.error.code]).toEqual([403, 'TRANSACTION_FORBIDDEN'])
      }
      expect((await call('barber2', `/crm/transactions/${paymentId}/refund`)).status).toBe(404)
      // A payment is undone by a refund, not by a reversal.
      const reverse = await call('admin', `/crm/transactions/${paymentId}/reverse`)
      expect(reverse.json.error.code).toBe('REVERSAL_TARGET_INVALID')

      const { status, json } = await call('admin', `/crm/transactions/${paymentId}/refund`, {
        comment: 'Client unhappy',
      })
      expect(status).toBe(200)
      expect(json.original).toBe(paymentId)
      expect(json.transaction).toMatchObject({
        type: 'refund',
        reverses: paymentId,
        appointment: appointment.id,
        barber: ids.b1,
        certificate: cert.id,
        certificateAmount: 10_000,
        comment: 'Client unhappy',
      })
      expect(json.transaction.entries).toMatchObject([
        { cashRegister: ids.cashA, amount: -12_000 },
        { cashRegister: ids.cardA, amount: -8_000 },
      ])
      expect(json.certificate).toEqual({ id: cert.id, balance: 10_000 })
      expect(json.appointment).toMatchObject({
        paidAmount: 0,
        certificateAmount: 0,
        status: 'completed',
        paymentStatus: 'refunded',
      })
      expect(await balances()).toEqual(before)
      expect((await find('transactions', paymentId)).reversed).toBe(true)
      expect(await logActions(appointment.id)).toEqual(['create', 'payment', 'refund'])

      const again = await call('admin', `/crm/transactions/${paymentId}/refund`)
      expect([again.status, again.json.error.code]).toEqual([409, 'ALREADY_REVERSED'])
      expect((await find('gift-certificates', cert.id)).balance).toBe(10_000)

      // The appointment can be paid again after the refund.
      const repay = await pay('admin', appointment.id, {
        entries: [{ cashRegister: ids.cashA, amount: 30_000 }],
      })
      expect(repay.json.appointment).toMatchObject({ status: 'paid', paymentStatus: 'paid' })
    })

    it('refund of one of two payments keeps the rest; only payments are refunded', async () => {
      const appointment = await book()
      const first = await pay('admin', appointment.id, {
        entries: [{ cashRegister: ids.cashA, amount: 10_000 }],
      })
      await pay('admin', appointment.id, { entries: [{ cashRegister: ids.cardA, amount: 20_000 }] })
      const { json } = await call('admin', `/crm/transactions/${first.json.transaction.id}/refund`)
      expect(json.appointment).toMatchObject({
        paidAmount: 20_000,
        paymentStatus: 'partial',
        status: 'completed',
      })

      const { doc: expense } = await createTransaction(await reqFor('admin'), {
        type: 'expense',
        location: ids.locA,
        expenseCategory: ids.supplies,
        entries: [{ cashRegister: ids.cashA, amount: -1_000 }],
      })
      const wrong = await call('admin', `/crm/transactions/${expense.id}/refund`)
      expect(wrong.json.error.code).toBe('REVERSAL_TARGET_INVALID')
    })
  })

  it('a barber reads own payments and refunds only', async () => {
    const { docs } = await payload.find({
      collection: 'transactions',
      depth: 0,
      pagination: false,
      user: { ...users.barber1, collection: 'users' },
      overrideAccess: false,
    } as never)
    expect(docs.length).toBeGreaterThan(0)
    for (const doc of docs as unknown as Doc[]) {
      expect(['appointment_payment', 'refund']).toContain(doc.type)
      expect(doc.barber).toBe(ids.b1)
    }
  })

  it('incremental balances match a recalculation from all operations', async () => {
    const { diffs } = await recalculateBalances(payload, { apply: false })
    expect(diffs).toEqual([])
  })
})
