// @vitest-environment node
import {
  createLocalReq,
  getPayload,
  handleEndpoints,
  type Payload,
  type PayloadRequest,
} from 'payload'
import { beforeAll, describe, expect, it } from 'vitest'

import { can, type PolicyUser } from '@/access/policy'
import { createAppointment } from '@/crm/appointments'
import { sellCertificate } from '@/crm/certificates.service'
import { financeToCsv, salaryToCsv } from '@/crm/finance-csv'
import { buildFinanceReport, cashProfit, type ReportOperation } from '@/crm/finance-report'
import { createTransaction, recalculateBalances, reverseTransaction } from '@/crm/ledger.service'
import { payAppointment, refundPayment } from '@/crm/payments.service'
import {
  allocate,
  breakdownOperation,
  calculateSalary,
  netLines,
  type SalaryAppointment,
  type SalaryOperation,
} from '@/crm/salary'
import { localDayRange, localToInstant, todayLocal } from '@/crm/time'
import { crmTranslations, type CrmKey } from '@/i18n'
import { up as appointmentsUp } from '@/migrations/20261113_000004_appointments'
import { up as ledgerUp } from '@/migrations/20261113_000005_ledger'
import { up as certificatesUp } from '@/migrations/20261114_000000_gift_certificates'
import config from '@/payload.config'

const u = (roles: string[]): PolicyUser => ({ id: 'u1', roles })

// ---------------------------------------------------------------------------
// Pure functions
// ---------------------------------------------------------------------------

const appt = (lines: [type: 'service' | 'extra', item: string, price: number][], total: number) =>
  ({
    lines: lines.map(([itemType, item, price]) => ({ itemType, item, price })),
    subtotal: lines.reduce((sum, [, , price]) => sum + price, 0),
    total,
  }) satisfies SalaryAppointment

let opSeq = 0
const op = (patch: Partial<SalaryOperation>): SalaryOperation => ({
  id: `op${String(opSeq++).padStart(3, '0')}`,
  type: 'appointment_payment',
  occurredAt: new Date('2026-10-10T10:00:00Z'),
  barber: 'b1',
  appointment: 'a1',
  cash: 0,
  certificateAmount: 0,
  tipAmount: 0,
  ...patch,
})

describe('salary: pure allocation (A13)', () => {
  it('policy: finance — admin/manager; profit — admin; salary — admin/barber', () => {
    expect(can(u(['admin']), 'read', 'reports.finance')).toBe(true)
    expect(can(u(['manager']), 'read', 'reports.finance')).toBe(true)
    for (const user of [u(['barber']), u(['editor']), null])
      expect(can(user, 'read', 'reports.finance')).toBe(false)
    expect(can(u(['admin']), 'read', 'reports.profit')).toBe(true)
    expect(can(u(['manager']), 'read', 'reports.profit')).toBe(false)
    expect(can(u(['admin']), 'read', 'reports.salary')).toBe(true)
    expect(can(u(['barber']), 'read', 'reports.salary')).toBe(true)
    for (const user of [u(['manager']), u(['editor']), null])
      expect(can(user, 'read', 'reports.salary')).toBe(false)
  })

  it('allocate: exact sum, largest remainder, sign, zero weights', () => {
    expect(allocate(10_000, [1, 1, 1])).toEqual([3334, 3333, 3333])
    expect(allocate(-10_000, [1, 1, 1])).toEqual([-3334, -3333, -3333])
    expect(allocate(100, [3, 1])).toEqual([75, 25])
    expect(allocate(5, [0, 0])).toEqual([5, 0])
    expect(allocate(7, [0, 2])).toEqual([0, 7])
    expect(allocate(0, [5, 5])).toEqual([0, 0])
    expect(allocate(1, [])).toEqual([])
    // Remainders: 1001 over [1,1,1] → 333.67 each: the earliest ones take the extra bani.
    expect(allocate(1001, [1, 1, 1])).toEqual([334, 334, 333])
  })

  it('netLines spreads the discount proportionally and adds up to total', () => {
    // Promo 25%: 30 000 + 10 000 → total 30 000.
    expect(
      netLines(
        appt(
          [
            ['service', 's', 30_000],
            ['extra', 'e', 10_000],
          ],
          30_000,
        ),
      ),
    ).toEqual([
      { itemType: 'service', item: 's', amount: 22_500 },
      { itemType: 'extra', item: 'e', amount: 7_500 },
    ])
    const odd = netLines(
      appt(
        [
          ['service', 's', 10_000],
          ['extra', 'e1', 10_000],
          ['extra', 'e2', 10_000],
        ],
        10_000,
      ),
    )
    expect(odd.map((line) => line.amount)).toEqual([3334, 3333, 3333])
    // 100% discount: everything is zero.
    expect(netLines(appt([['service', 's', 30_000]], 0))).toEqual([
      { itemType: 'service', item: 's', amount: 0 },
    ])
  })

  const discounted = new Map([
    [
      'a1',
      appt(
        [
          ['service', 's', 30_000],
          ['extra', 'e', 10_000],
        ],
        30_000,
      ),
    ],
    ['a2', appt([['service', 's', 30_000]], 30_000)],
  ])
  const rates = new Map([
    ['b1', { servicesPercent: 50, extrasPercent: 20 }],
    ['b2', { servicesPercent: 40, extrasPercent: 10 }],
  ])

  it('discount: services and extras percentages on the net amounts', () => {
    const { rows } = calculateSalary([op({ cash: 30_000 })], discounted, rates)
    expect(rows).toEqual([
      {
        barber: 'b1',
        payments: 1,
        refunds: 0,
        servicesBase: 22_500,
        extrasBase: 7_500,
        servicesPercent: 50,
        extrasPercent: 20,
        servicesCommission: 11_250,
        extrasCommission: 1_500,
        tips: 0,
        total: 12_750,
      },
    ])
  })

  it('certificate counts like money; tips go 100% to the barber and are not commissioned', () => {
    // 13 000 money (3 000 of it tips) + 20 000 certificate → 30 000 to the appointment.
    const payment = op({ cash: 13_000, certificateAmount: 20_000, tipAmount: 3_000 })
    expect(breakdownOperation(payment, discounted.get('a1'))).toMatchObject({
      applied: 30_000,
      tips: 3_000,
      certificate: 20_000,
      servicesBase: 22_500,
      extrasBase: 7_500,
    })
    const [row] = calculateSalary([payment], discounted, rates).rows
    expect(row).toMatchObject({ servicesCommission: 11_250, extrasCommission: 1_500, tips: 3_000 })
    expect(row!.total).toBe(15_750)
  })

  it('partial payments: each one pays its share (prepayment + rest = full salary)', () => {
    const parts = calculateSalary([op({ cash: 15_000 }), op({ cash: 15_000 })], discounted, rates)
      .rows[0]!
    expect([parts.servicesBase, parts.extrasBase, parts.total]).toEqual([22_500, 7_500, 12_750])
    // An uneven split still adds up exactly.
    const uneven = calculateSalary([op({ cash: 10_001 }), op({ cash: 19_999 })], discounted, rates)
      .rows[0]!
    expect(uneven.servicesBase + uneven.extrasBase).toBe(30_000)
  })

  it('refund is subtracted (with its tips and certificate part) where it is made', () => {
    const refund = op({
      type: 'refund',
      barber: 'b2',
      appointment: 'a1',
      cash: -13_000,
      certificateAmount: 20_000,
      tipAmount: 3_000,
    })
    expect(breakdownOperation(refund, discounted.get('a1'))).toMatchObject({
      applied: -30_000,
      tips: -3_000,
      certificate: -20_000,
      servicesBase: -22_500,
      extrasBase: -7_500,
    })
    const { rows, totals } = calculateSalary([refund], discounted, rates)
    // 40% of −22 500 + 10% of −7 500 − 3 000 tips.
    expect(rows[0]).toMatchObject({ refunds: 1, payments: 0, total: -9_000 - 750 - 3_000 })
    expect(totals.total).toBe(-12_750)
  })

  it('payment and its refund in one period cancel out; no barber → skipped; deleted appointment → services', () => {
    const { rows } = calculateSalary(
      [
        op({ cash: 30_000 }),
        op({ type: 'refund', cash: -30_000 }),
        op({ barber: null, cash: 50_000 }),
        op({ barber: 'b2', appointment: 'gone', cash: 10_000 }),
      ],
      discounted,
      rates,
      ['b2', 'b1'],
    )
    expect(rows.map((row) => row.barber)).toEqual(['b2', 'b1'])
    expect(rows[0]).toMatchObject({ servicesBase: 10_000, extrasBase: 0, total: 4_000 })
    expect(rows[1]).toMatchObject({ payments: 1, refunds: 1, servicesBase: 0, total: 0 })
  })

  it('missing percentages count as 0; the CSV uses decimal lei', () => {
    const report = calculateSalary([op({ barber: 'b9', cash: 30_000 })], discounted, new Map())
    expect(report.rows[0]).toMatchObject({ servicesPercent: 0, total: 0 })
    const t = (key: CrmKey) => crmTranslations.en.crm[key]
    const csv = salaryToCsv(calculateSalary([op({ cash: 30_000 })], discounted, rates), {}, t)
    expect(csv.startsWith('﻿')).toBe(true)
    expect(csv).toContain('—;1;0;225.00;50;112.50;75.00;20;15.00;0.00;127.50\r\n')
  })
})

describe('finance report: pure sections', () => {
  const day = localDayRange('2026-10-25')
  const operation = (patch: Partial<ReportOperation>): ReportOperation => ({
    id: `t${opSeq++}`,
    type: 'expense',
    occurredAt: localToInstant('2026-10-25', '12:00'),
    location: 'L',
    entries: [],
    barber: null,
    appointment: null,
    certificate: null,
    certificateAmount: 0,
    tipAmount: 0,
    expenseCategory: null,
    reverses: null,
    ...patch,
  })

  it('movement reconciles: opening + in − out = closing; a reversed expense reduces the category', () => {
    const report = buildFinanceReport({
      ...day,
      from: day.start,
      to: day.end,
      now: day.end,
      barber: null,
      registers: [
        { id: 'R', name: 'Cash', type: 'cash', location: 'L', active: true, balance: 999 },
      ],
      opening: new Map([['R', 1_000]]),
      operations: [
        operation({
          id: 'x',
          entries: [{ cashRegister: 'R', amount: -300 }],
          expenseCategory: 'C',
        }),
        operation({
          type: 'reversal',
          reverses: 'old',
          entries: [{ cashRegister: 'R', amount: 100 }],
        }),
        // Outside the period: ignored.
        operation({ occurredAt: day.end, entries: [{ cashRegister: 'R', amount: -50 }] }),
      ],
      reversedOriginals: new Map([['old', { type: 'expense', expenseCategory: 'C' }]]),
      appointments: new Map(),
      certificates: [],
      promoUses: [],
    })
    expect(report.registers.rows[0]).toEqual({
      register: 'R',
      location: 'L',
      opening: 1_000,
      inflow: 100,
      outflow: 300,
      closing: 800,
      balance: 999,
    })
    expect(report.expenses.byCategory).toEqual([{ id: 'C', amount: 200, count: 1 }])
    expect(report.expenses.total).toBe(200)
    expect(cashProfit(report, 50)).toEqual({ income: 0, expenses: 200, salary: 50, profit: -250 })
  })
})

// ---------------------------------------------------------------------------
// Controlled data set on the real ledger (every number counted by hand)
//
// Commission: b1 — services 50%, extras 20%; b2 — services 40%, extras 10%.
// Catalog: Cut 30 000, Beard 10 000; promo P25 (25%).
// Period P = 2026-10-25 (DST end: 25 hours, 00:00 +03:00 → 24:00 +02:00).
//
//   10-01        adjustment cashA +100 000
//   10-20        certificate C1 50 000 → cardA; C2 10 000 → cardA, expires 10-25 12:00 (unused)
//   10-24 12:00  a3 (b2, Cut 30 000) paid 30 000 cashA                         ← before P
//   10-24 15:00  expense −2 000 cashA (Supplies)                               ← before P
//   10-25 00:30  a1 (b1, Cut+Beard, P25 → 30 000) paid 13 000 cashA (tip 3 000) + 20 000 C1
//                (21:30 UTC of 10-24: a naive UTC day would put it before P)
//   10-25 10:00  expense −5 000 cashA (Supplies); 10:30 reversal of the 10-24 expense (+2 000)
//   10-25 11:00  transfer cashA → cardA 1 000
//   10-25 12:00  refund of the a3 payment (−30 000 cashA)
//   10-25 23:30  a2 (b1, Cut 30 000) paid 30 000 cardA (21:30 UTC of 10-25)
//   10-26 00:30  a4 (b2, locB, Cut) paid 30 000 cashB                          ← after P
//   03-29 00:30 and 23:30 (DST start: 23 hours): a5, a6 (b2, locB) paid 30 000 cashB each
//
// Salary P: b1 = 50% (22 500 + 30 000) + 20% 7 500 + 3 000 tips = 30 750;
//           b2 = 40% × (−30 000) = −12 000; total 18 750.
// ---------------------------------------------------------------------------

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
type Doc = Record<string, unknown> & { id: string }
type Who = 'admin' | 'manager' | 'managerB' | 'barber1' | 'barber2' | 'editor' | 'anon'

const P = '2026-10-25'
const at = (date: string, time: string) => localToInstant(date, time)

describe('finance and salary reports on a controlled ledger', () => {
  let payload: Payload
  const ids: Record<string, string> = {}
  const users: Record<string, { id: string; roles: string[]; locations: string[] }> = {}
  const tokens: Partial<Record<Who, string>> = {}

  const create = async (collection: string, data: Record<string, unknown>) =>
    (await payload.create({ collection, data, overrideAccess: true } as never)) as unknown as Doc

  const reqFor = async (who: Who): Promise<PayloadRequest> =>
    createLocalReq({ user: { ...users[who], collection: 'users' } as never }, payload)

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
      bom: bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf,
      text,
      json: (isJson && text ? JSON.parse(text) : null) as Json,
    }
  }

  const finance = async (who: Who, query: string) => {
    const result = await call(who, `/crm/reports/finance?${query}`)
    expect(result.status).toBe(200)
    return result.json
  }
  const salary = async (who: Who, query: string) => {
    const result = await call(who, `/crm/reports/salary?${query}`)
    expect(result.status).toBe(200)
    return result.json
  }

  const book = async (
    barber: string,
    location: string,
    startAt: Date,
    patch: Record<string, unknown> = {},
  ) => {
    const { doc } = await createAppointment(
      await createLocalReq({}, payload),
      {
        location,
        barber,
        service: ids.cut,
        client: ids.client,
        startAt: startAt.toISOString(),
        ...patch,
      },
      { actorType: 'system', skipEmail: true },
    )
    return doc as Doc
  }

  const pay = async (appointment: Doc, now: Date, body: Parameters<typeof payAppointment>[2]) =>
    (await payAppointment(await reqFor('admin'), String(appointment.id), body, { now })).transaction

  const byId = (rows: Json[], key = 'id') => Object.fromEntries(rows.map((row) => [row[key], row]))

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
    ids.beard = (await create('extras', { name: 'Beard', durationMinutes: 15, price: 10_000 })).id
    ids.promo = (
      await create('promo-codes', { code: 'P25', discountType: 'percent', value: 25 })
    ).id

    for (const [key, roles, locations] of [
      ['admin', ['admin'], []],
      ['manager', ['manager'], [ids.locA]],
      ['managerB', ['manager'], [ids.locB]],
      ['barber1', ['barber'], []],
      ['barber2', ['barber'], []],
      ['editor', ['editor'], []],
    ] as const) {
      const email = `${key}-fin@test.local`
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

    const barber = async (name: string, order: number, user: string, s: number, e: number) =>
      (
        await create('barbers', {
          name,
          order,
          showOnSite: false,
          locations: [ids.locA, ids.locB],
          services: [ids.cut],
          user,
          commissionServicesPercent: s,
          commissionExtrasPercent: e,
        })
      ).id
    ids.b1 = await barber('One', 1, users.barber1.id, 50, 20)
    ids.b2 = await barber('Two', 2, users.barber2.id, 40, 10)
    ids.client = (await create('clients', { firstName: 'Ion', phone: '069400001' })).id

    const register = async (name: string, location: string, type = 'cash') =>
      (await create('cash-registers', { name, type, location })).id
    ids.cashA = await register('Cash A', ids.locA)
    ids.cardA = await register('Card A', ids.locA, 'account')
    ids.cashB = await register('Cash B', ids.locB)
    ids.supplies = (await create('expense-categories', { name: 'Supplies' })).id

    const admin = () => reqFor('admin')
    await createTransaction(await admin(), {
      type: 'adjustment',
      location: ids.locA,
      occurredAt: at('2026-10-01', '09:00'),
      comment: 'opening',
      entries: [{ cashRegister: ids.cashA, amount: 100_000 }],
    })
    const c1 = await sellCertificate(
      await admin(),
      { nominal: 50_000, entries: [{ cashRegister: ids.cardA, amount: 50_000 }] },
      { now: at('2026-10-20', '10:00') },
    )
    ids.c1 = String(c1.certificate.id)
    ids.c1code = String(c1.certificate.code)
    await sellCertificate(
      await admin(),
      {
        nominal: 10_000,
        entries: [{ cashRegister: ids.cardA, amount: 10_000 }],
        expiresAt: at(P, '12:00'),
      },
      { now: at('2026-10-20', '11:00') },
    )

    const a3 = await book(ids.b2, ids.locA, at('2026-10-24', '11:00'))
    const a3pay = await pay(a3, at('2026-10-24', '12:00'), {
      entries: [{ cashRegister: ids.cashA, amount: 30_000 }],
    })
    const oldExpense = await createTransaction(
      await admin(),
      {
        type: 'expense',
        location: ids.locA,
        occurredAt: at('2026-10-24', '15:00'),
        expenseCategory: ids.supplies,
        entries: [{ cashRegister: ids.cashA, amount: -2_000 }],
      },
      { now: at('2026-10-24', '15:00') },
    )

    const a1 = await book(ids.b1, ids.locA, at(P, '00:00'), {
      extras: [ids.beard],
      promoCode: ids.promo,
    })
    expect([a1.subtotal, a1.promoDiscount, a1.total]).toEqual([40_000, 10_000, 30_000])
    ids.a1 = String(a1.id)
    await pay(a1, at(P, '00:30'), {
      entries: [{ cashRegister: ids.cashA, amount: 13_000 }],
      tipAmount: 3_000,
      certificateCode: ids.c1code,
    })
    await createTransaction(
      await admin(),
      {
        type: 'expense',
        location: ids.locA,
        occurredAt: at(P, '10:00'),
        expenseCategory: ids.supplies,
        entries: [{ cashRegister: ids.cashA, amount: -5_000 }],
      },
      { now: at(P, '10:00') },
    )
    await reverseTransaction(await admin(), String(oldExpense.doc.id), { now: at(P, '10:30') })
    await createTransaction(
      await admin(),
      {
        type: 'transfer',
        location: ids.locA,
        occurredAt: at(P, '11:00'),
        entries: [
          { cashRegister: ids.cashA, amount: -1_000 },
          { cashRegister: ids.cardA, amount: 1_000 },
        ],
      },
      { now: at(P, '11:00') },
    )
    await refundPayment(await admin(), String(a3pay.id), { now: at(P, '12:00') })
    const a2 = await book(ids.b1, ids.locA, at(P, '22:00'))
    await pay(a2, at(P, '23:30'), { entries: [{ cashRegister: ids.cardA, amount: 30_000 }] })

    const a4 = await book(ids.b2, ids.locB, at(P, '23:00'))
    await pay(a4, at('2026-10-26', '00:30'), {
      entries: [{ cashRegister: ids.cashB, amount: 30_000 }],
    })

    const a5 = await book(ids.b2, ids.locB, at('2026-03-29', '00:00'))
    await pay(a5, at('2026-03-29', '00:30'), {
      entries: [{ cashRegister: ids.cashB, amount: 30_000 }],
    })
    const a6 = await book(ids.b2, ids.locB, at('2026-03-29', '23:00'))
    await pay(a6, at('2026-03-29', '23:30'), {
      entries: [{ cashRegister: ids.cashB, amount: 30_000 }],
    })
  })

  describe('salary', () => {
    it('admin: the DST day counted by hand (discount, certificate, tips, refund)', async () => {
      const report = await salary('admin', `from=${P}&to=${P}`)
      const rows = byId(report.rows, 'barber')
      expect(Object.keys(rows)).toEqual([ids.b1, ids.b2])
      expect(rows[ids.b1]).toEqual({
        barber: ids.b1,
        payments: 2,
        refunds: 0,
        servicesBase: 52_500,
        extrasBase: 7_500,
        servicesPercent: 50,
        extrasPercent: 20,
        servicesCommission: 26_250,
        extrasCommission: 1_500,
        tips: 3_000,
        total: 30_750,
      })
      expect(rows[ids.b2]).toMatchObject({
        payments: 0,
        refunds: 1,
        servicesBase: -30_000,
        servicesCommission: -12_000,
        total: -12_000,
      })
      expect(report.totals.total).toBe(18_750)
      expect(report.names.barbers[ids.b1]).toBe('One')
      // Several barbers: no operation details.
      expect(report.items).toEqual([])
    })

    it('period boundaries are local days across the DST changes', async () => {
      // 10-24 holds only the a3 payment: the a1 payment (21:30 UTC of 10-24) belongs to 10-25.
      const before = await salary('admin', 'from=2026-10-24&to=2026-10-24')
      expect(before.rows.map((row: Json) => [row.barber, row.total])).toEqual([[ids.b2, 12_000]])
      const after = await salary('admin', 'from=2026-10-26&to=2026-10-26')
      expect(after.rows.map((row: Json) => [row.barber, row.total])).toEqual([[ids.b2, 12_000]])
      // Spring forward: the 23-hour day keeps both payments (00:30 and 23:30 local).
      const spring = await salary('admin', 'from=2026-03-29&to=2026-03-29')
      expect(spring.rows[0]).toMatchObject({ barber: ids.b2, payments: 2, total: 24_000 })
      expect((await salary('admin', 'from=2026-03-28&to=2026-03-28')).rows).toEqual([])
      expect((await salary('admin', 'from=2026-03-30&to=2026-03-30')).rows).toEqual([])
      // A payment and its refund in one period cancel out.
      const both = await salary('admin', `from=2026-10-24&to=${P}`)
      expect(byId(both.rows, 'barber')[ids.b2]).toMatchObject({
        payments: 1,
        refunds: 1,
        total: 0,
      })
    })

    it('location filter and the operation details for one barber', async () => {
      const inB = await salary('admin', `from=2026-10-01&to=2026-10-31&location=${ids.locB}`)
      expect(inB.rows.map((row: Json) => [row.barber, row.total])).toEqual([[ids.b2, 12_000]])
      const one = await salary('admin', `from=${P}&to=${P}&barber=${ids.b1}`)
      expect(one.rows).toHaveLength(1)
      expect(
        one.items.map((item: Json) => [item.type, item.servicesBase, item.extrasBase, item.tips]),
      ).toEqual([
        ['appointment_payment', 22_500, 7_500, 3_000],
        ['appointment_payment', 30_000, 0, 0],
      ])
    })

    it('barber sees only their own salary; manager, editor 403; anonymous 401', async () => {
      const own = await salary('barber1', `from=${P}&to=${P}`)
      expect(own.barber).toBe(ids.b1)
      expect(own.rows.map((row: Json) => row.barber)).toEqual([ids.b1])
      expect(own.items).toHaveLength(2)
      expect(
        (await call('barber1', `/crm/reports/salary?from=${P}&to=${P}&barber=${ids.b2}`)).status,
      ).toBe(403)
      expect((await call('manager', `/crm/reports/salary?from=${P}&to=${P}`)).status).toBe(403)
      expect((await call('editor', `/crm/reports/salary?from=${P}&to=${P}`)).status).toBe(403)
      expect((await call('anon', `/crm/reports/salary?from=${P}&to=${P}`)).status).toBe(401)
    })

    it('validation: required period, order, range length', async () => {
      for (const query of [
        '',
        `from=${P}`,
        `from=2026-10-26&to=${P}`,
        'from=2024-01-01&to=2026-10-25',
      ])
        expect((await call('admin', `/crm/reports/salary?${query}`)).json.error.code).toBe(
          'VALIDATION_ERROR',
        )
    })

    it('CSV: BOM, translated header, decimal lei', async () => {
      const csv = await call(
        'barber1',
        `/crm/reports/salary?from=${P}&to=${P}&format=csv&locale=en`,
      )
      expect(csv.status).toBe(200)
      expect(csv.headers.get('content-type')).toContain('text/csv')
      expect(csv.bom).toBe(true)
      expect(csv.text).toContain('One;2;0;525.00;50;262.50;75.00;20;15.00;30.00;307.50\r\n')
      expect(csv.text).toContain('Operations')
    })
  })

  describe('finance', () => {
    it('admin: income, revenue by service, expenses, promo, certificates, profit', async () => {
      const report = await finance('admin', `from=${P}&to=${P}`)
      expect(report.income.totals).toEqual({
        payments: 43_000,
        refunds: -30_000,
        certificateSales: 0,
        tips: 3_000,
        net: 13_000,
      })
      expect(report.income.byLocation).toEqual([
        {
          id: ids.locA,
          payments: 43_000,
          refunds: -30_000,
          certificateSales: 0,
          tips: 3_000,
          net: 13_000,
        },
      ])
      const registers = byId(report.income.byRegister)
      expect(registers[ids.cashA]).toMatchObject({
        payments: 13_000,
        refunds: -30_000,
        net: -17_000,
      })
      expect(registers[ids.cardA]).toMatchObject({ payments: 30_000, net: 30_000 })
      const barbers = byId(report.income.byBarber, 'barber')
      expect(barbers[ids.b1]).toEqual({
        barber: ids.b1,
        payments: 43_000,
        refunds: 0,
        net: 43_000,
        certificate: 20_000,
        tips: 3_000,
        revenue: 60_000,
      })
      expect(barbers[ids.b2]).toMatchObject({ refunds: -30_000, net: -30_000, revenue: -30_000 })

      expect(report.revenue).toEqual({
        total: 30_000,
        certificate: 20_000,
        items: [
          { itemType: 'service', item: ids.cut, appointments: 2, amount: 22_500 },
          { itemType: 'extra', item: ids.beard, appointments: 1, amount: 7_500 },
        ],
      })
      expect(report.names.services[ids.cut]).toBe('Cut')
      expect(report.names.extras[ids.beard]).toBe('Beard')

      expect(report.expenses.total).toBe(3_000)
      expect(report.expenses.byCategory).toEqual([{ id: ids.supplies, amount: 3_000, count: 1 }])
      expect(report.expenses.byRegister).toEqual([{ id: ids.cashA, amount: 3_000, count: 1 }])
      expect(report.names.categories[ids.supplies]).toBe('Supplies')

      expect(report.promo).toEqual({
        uses: 1,
        discount: 10_000,
        codes: [{ promoCode: ids.promo, uses: 1, discount: 10_000 }],
      })
      expect(report.names.promoCodes[ids.promo]).toBe('P25')

      expect(report.certificates).toEqual({
        sold: { count: 0, amount: 0 },
        redeemed: 20_000,
        outstanding: { count: 1, amount: 30_000 },
        expired: { count: 1, amount: 10_000 },
      })
      expect(report.profit).toEqual({
        income: 13_000,
        expenses: 3_000,
        salary: 18_750,
        profit: -8_750,
      })
    })

    it('register movement: opening + in − out = closing, by hand and against the ledger', async () => {
      const report = await finance('admin', `from=${P}&to=${P}`)
      const rows = byId(report.registers.rows, 'register')
      expect(rows[ids.cashA]).toMatchObject({
        opening: 128_000,
        inflow: 15_000,
        outflow: 36_000,
        closing: 107_000,
        balance: 107_000,
      })
      expect(rows[ids.cardA]).toMatchObject({
        opening: 60_000,
        inflow: 31_000,
        outflow: 0,
        closing: 91_000,
        balance: 91_000,
      })
      // cashB: the two March payments before P, the a4 payment after it.
      expect(rows[ids.cashB]).toMatchObject({
        opening: 60_000,
        inflow: 0,
        outflow: 0,
        closing: 60_000,
        balance: 90_000,
      })

      // Over the whole history the closing equals the stored balance and the recalculation.
      const all = await finance('admin', `from=2026-01-01&to=${todayLocal()}`)
      expect((await recalculateBalances(payload, { apply: false })).diffs).toEqual([])
      for (const row of all.registers.rows as Json[]) {
        expect(row.opening).toBe(0)
        expect(row.closing).toBe(row.balance)
      }
      // Income + expenses + the rest of the entries add up to the total movement.
      const { docs } = await payload.find({
        collection: 'transactions',
        depth: 0,
        pagination: false,
        overrideAccess: true,
      })
      const ledgerSum = (docs as unknown as { entries: { amount: number }[] }[])
        .flatMap((doc) => doc.entries)
        .reduce((sum, entry) => sum + entry.amount, 0)
      expect(all.registers.totals.closing).toBe(ledgerSum)
      expect(all.income.totals.net).toBe(50_000 + 10_000 + 30_000 * 5 + 13_000 - 30_000)
      expect(all.expenses.total).toBe(5_000)
      // Adjustment + income − expenses (transfers net to zero) = the movement.
      expect(100_000 + all.income.totals.net - all.expenses.total).toBe(ledgerSum)
    })

    it('certificate section of the sale period', async () => {
      const report = await finance('admin', 'from=2026-10-20&to=2026-10-20')
      expect(report.certificates.sold).toEqual({ count: 2, amount: 60_000 })
      expect(report.income.totals.certificateSales).toBe(60_000)
      expect(report.certificates.redeemed).toBe(0)
    })

    it('barber filter cuts the payment sections only', async () => {
      const report = await finance('admin', `from=${P}&to=${P}&barber=${ids.b1}`)
      expect(report.income.totals).toMatchObject({ payments: 43_000, refunds: 0, net: 43_000 })
      expect(report.income.byBarber.map((row: Json) => row.barber)).toEqual([ids.b1])
      expect(report.revenue.total).toBe(60_000)
      expect(report.expenses.total).toBe(3_000)
      expect((await finance('admin', `from=${P}&to=${P}&barber=${ids.b2}`)).promo.uses).toBe(0)
    })

    it('manager: own locations, no profit; foreign location 403; barber/editor 403', async () => {
      const own = await finance('manager', `from=${P}&to=${P}`)
      expect(own.profit).toBeNull()
      expect(own.registers.rows.map((row: Json) => row.register).sort()).toEqual(
        [ids.cashA, ids.cardA].sort(),
      )
      expect(own.income.totals.net).toBe(13_000)
      expect(own.certificates.outstanding).toEqual({ count: 1, amount: 30_000 })

      const b = await finance('managerB', `from=${P}&to=${P}`)
      expect(b.income.totals.net).toBe(0)
      expect(b.registers.rows.map((row: Json) => row.register)).toEqual([ids.cashB])
      expect(b.certificates.outstanding).toEqual({ count: 0, amount: 0 })
      expect(b.promo.uses).toBe(0)
      expect(
        (await call('managerB', `/crm/reports/finance?from=${P}&to=${P}&location=${ids.locA}`))
          .status,
      ).toBe(403)
      for (const who of ['barber1', 'editor'] as const)
        expect((await call(who, `/crm/reports/finance?from=${P}&to=${P}`)).status).toBe(403)
      expect((await call('anon', `/crm/reports/finance?from=${P}&to=${P}`)).status).toBe(401)
    })

    it('CSV: sections with translated titles; profit only for admin', async () => {
      const admin = await call(
        'admin',
        `/crm/reports/finance?from=${P}&to=${P}&format=csv&locale=en`,
      )
      expect(admin.status).toBe(200)
      expect(admin.bom).toBe(true)
      expect(admin.text).toContain('Income by location\r\n')
      expect(admin.text).toContain('Total;430.00;-300.00;0.00;30.00;130.00\r\n')
      expect(admin.text).toContain('Cash A;A;1280.00;150.00;360.00;1070.00;1070.00\r\n')
      expect(admin.text).toContain('Profit;-87.50\r\n')
      const manager = await call(
        'manager',
        `/crm/reports/finance?from=${P}&to=${P}&format=csv&locale=ru`,
      )
      expect(manager.status).toBe(200)
      expect(manager.text).toContain('Доход по локациям')
      expect(manager.text).not.toContain(crmTranslations.ru.crm['reports.finance.sections.profit'])
    })
  })

  it('pure CSV of an empty report keeps every section', () => {
    const t = (key: CrmKey) => crmTranslations.ro.crm[key]
    const from = localDayRange(P).start
    const csv = financeToCsv(
      buildFinanceReport({
        from,
        to: localDayRange(P).end,
        now: from,
        barber: null,
        registers: [],
        opening: new Map(),
        operations: [],
        reversedOriginals: new Map(),
        appointments: new Map(),
        certificates: [],
        promoUses: [],
      }),
      {},
      t,
    )
    for (const key of ['byLocation', 'revenue', 'registers', 'promo', 'certificates'] as const)
      expect(csv).toContain(t(`reports.finance.sections.${key}`))
  })
})
