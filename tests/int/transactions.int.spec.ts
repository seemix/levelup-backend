// @vitest-environment node
import {
  createLocalReq,
  getPayload,
  handleEndpoints,
  type Payload,
  type PayloadRequest,
} from 'payload'
import { beforeAll, describe, expect, it } from 'vitest'

import { computeBalances, type LedgerEntry } from '@/crm/ledger'
import {
  createTransaction,
  recalculateBalances,
  reverseTransaction,
  type TransactionData,
} from '@/crm/ledger.service'
import { up as ledgerUp } from '@/migrations/20261113_000005_ledger'
import config from '@/payload.config'

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
type Doc = Record<string, unknown> & { id: string }
type Who = 'admin' | 'manager' | 'managerB' | 'barber' | 'editor'

const DAY_MS = 86_400_000

describe('ledger: cash registers, expense categories, transactions', () => {
  let payload: Payload
  const ids: Record<string, string> = {}
  const users: Record<string, { id: string; roles: string[]; locations: string[] }> = {}
  const tokens: Partial<Record<Who, string>> = {}

  const create = async (collection: string, data: Record<string, unknown>) =>
    (await payload.create({ collection, data, overrideAccess: true } as never)) as unknown as Doc

  const reqFor = async (who?: Who): Promise<PayloadRequest> =>
    createLocalReq(who ? { user: { ...users[who], collection: 'users' } as never } : {}, payload)

  const post = async (who: Who | undefined, data: TransactionData) =>
    createTransaction(await reqFor(who), data)

  const errorCode = async (promise: Promise<unknown>): Promise<string | undefined> => {
    try {
      await promise
    } catch (error) {
      const e = error as { data?: { code?: string }; name?: string }
      return e.data?.code ?? e.name
    }
    return undefined
  }

  const balance = async (register: string) =>
    (
      (await payload.findByID({
        collection: 'cash-registers',
        id: register,
        depth: 0,
        overrideAccess: true,
      })) as unknown as { balance: number }
    ).balance

  const findTx = async (id: string) =>
    (await payload.findByID({
      collection: 'transactions',
      id,
      depth: 0,
      overrideAccess: true,
    })) as unknown as Doc

  const expense = (amount: number, patch: Partial<TransactionData> = {}): TransactionData => ({
    type: 'expense',
    location: ids.locA,
    expenseCategory: ids.supplies,
    entries: [{ cashRegister: ids.cashA, amount: -amount }],
    ...patch,
  })

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

  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    await Promise.all(Object.values(payload.db.collections).map((model) => model.init()))
    const req = await createLocalReq({}, payload)
    await ledgerUp({ payload, req } as Parameters<typeof ledgerUp>[0])

    ids.locA = (await create('locations', { name: 'A', order: 1 })).id
    ids.locB = (await create('locations', { name: 'B', order: 2 })).id

    for (const [key, roles, locations] of [
      ['admin', ['admin'], []],
      ['manager', ['manager'], [ids.locA]],
      ['managerB', ['manager'], [ids.locB]],
      ['barber', ['barber'], []],
      ['editor', ['editor'], []],
    ] as const) {
      const email = `${key}-ledger@test.local`
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
    ids.barber = (
      await create('barbers', {
        name: 'Barber',
        order: 1,
        showOnSite: false,
        color: '#123456',
        locations: [ids.locA],
        user: users.barber.id,
      })
    ).id

    const register = async (name: string, location: string, active = true) =>
      (await create('cash-registers', { name, type: 'cash', location, active })).id
    ids.cashA = await register('Cash A', ids.locA)
    ids.cardA = await register('Card A', ids.locA)
    ids.cashB = await register('Cash B', ids.locB)
    ids.closedA = await register('Closed A', ids.locA, false)
    ids.supplies = (await create('expense-categories', { name: 'Supplies' })).id
    ids.oldCategory = (await create('expense-categories', { name: 'Old', active: false })).id

    // Opening balances (adjustment, admin).
    for (const [cashRegister, location] of [
      [ids.cashA, ids.locA],
      [ids.cashB, ids.locB],
    ])
      await post('admin', {
        type: 'adjustment',
        location,
        entries: [{ cashRegister, amount: 100_000 }],
        comment: 'Opening balance',
      })
  })

  describe('balances and invariants', () => {
    it('a register is created with a zero balance that the API cannot set', async () => {
      const doc = await payload.create({
        collection: 'cash-registers',
        data: { name: 'Tmp', type: 'account', location: ids.locA, balance: 999 } as never,
        user: { ...users.admin, collection: 'users' } as never,
        overrideAccess: false,
      })
      expect(doc.balance).toBe(0)
      await payload.update({
        collection: 'cash-registers',
        id: doc.id,
        data: { balance: 500 } as never,
        user: { ...users.admin, collection: 'users' } as never,
        overrideAccess: false,
      })
      expect(await balance(String(doc.id))).toBe(0)
      await payload.update({
        collection: 'cash-registers',
        id: doc.id,
        data: { active: false },
        overrideAccess: true,
      })
    })

    it('expense and transfer move balances; server fields are set', async () => {
      const before = { cash: await balance(ids.cashA), card: await balance(ids.cardA) }
      const { doc } = await post('admin', expense(2_500, { comment: 'Wax' }))
      expect(doc.author).toBe(users.admin.id)
      expect(doc.reversed).toBe(false)
      expect(doc.occurredAt).toBeTruthy()
      await post('admin', {
        type: 'transfer',
        location: ids.locA,
        entries: [
          { cashRegister: ids.cashA, amount: -10_000 },
          { cashRegister: ids.cardA, amount: 10_000 },
        ],
      })
      expect(await balance(ids.cashA)).toBe(before.cash - 12_500)
      expect(await balance(ids.cardA)).toBe(before.card + 10_000)
    })

    it('rejects invalid operations without changing balances', async () => {
      const before = await balance(ids.cashA)
      const cases: [TransactionData, string][] = [
        [expense(-100), 'LEDGER_ENTRIES_INVALID'],
        [expense(100, { expenseCategory: null }), 'EXPENSE_CATEGORY_REQUIRED'],
        [expense(100, { expenseCategory: ids.oldCategory }), 'EXPENSE_CATEGORY_INVALID'],
        [
          expense(100, { entries: [{ cashRegister: ids.cashB, amount: -100 }] }),
          'CASH_REGISTER_INVALID',
        ],
        [
          expense(100, { entries: [{ cashRegister: ids.closedA, amount: -100 }] }),
          'CASH_REGISTER_INVALID',
        ],
        [
          {
            type: 'transfer',
            location: ids.locA,
            entries: [
              { cashRegister: ids.cashA, amount: -100 },
              { cashRegister: ids.cardA, amount: 90 },
            ],
          },
          'LEDGER_SUM_INVALID',
        ],
        [
          {
            type: 'adjustment',
            location: ids.locA,
            entries: [{ cashRegister: ids.cashA, amount: 100 }],
          },
          'COMMENT_REQUIRED',
        ],
        // Payments, certificate sales and refunds belong to their services (stage 18).
        [
          {
            type: 'appointment_payment',
            location: ids.locA,
            entries: [{ cashRegister: ids.cashA, amount: 100 }],
          },
          'TRANSACTION_TYPE_UNSUPPORTED',
        ],
      ]
      for (const [data, code] of cases) expect(await errorCode(post('admin', data))).toBe(code)
      expect(await balance(ids.cashA)).toBe(before)
    })

    it('a negative balance is allowed with a warning (A8)', async () => {
      const { doc } = await post('admin', {
        type: 'adjustment',
        location: ids.locA,
        entries: [{ cashRegister: ids.cardA, amount: 1 }],
        comment: 'probe',
      })
      expect(doc.id).toBeTruthy()
      const current = await balance(ids.cardA)
      const result = await post(
        'admin',
        expense(current + 1_000, {
          entries: [{ cashRegister: ids.cardA, amount: -(current + 1_000) }],
        }),
      )
      expect(result.warnings).toEqual(['NEGATIVE_BALANCE'])
      expect(result.negativeRegisters).toEqual([ids.cardA])
      expect(await balance(ids.cardA)).toBe(-1_000)
      // Bring it back for the other tests.
      await reverseTransaction(await reqFor('admin'), String(result.doc.id))
      expect(await balance(ids.cardA)).toBe(current)
    })
  })

  describe('reversal', () => {
    it('creates the mirror, marks the original and restores the balance — once', async () => {
      const before = await balance(ids.cashA)
      const { doc: original } = await post('admin', expense(4_000))
      expect(await balance(ids.cashA)).toBe(before - 4_000)

      const { doc: reversal } = await reverseTransaction(
        await reqFor('admin'),
        String(original.id),
        {
          comment: 'Mistake',
        },
      )
      expect(reversal.type).toBe('reversal')
      expect(reversal.location).toBe(ids.locA)
      expect(reversal.reverses).toBe(original.id)
      expect((reversal.entries as LedgerEntry[]).map((e) => [e.cashRegister, e.amount])).toEqual([
        [ids.cashA, 4_000],
      ])
      expect((await findTx(String(original.id))).reversed).toBe(true)
      expect(await balance(ids.cashA)).toBe(before)

      expect(await errorCode(reverseTransaction(await reqFor('admin'), String(original.id)))).toBe(
        'ALREADY_REVERSED',
      )
      // A reversal itself is not reversible.
      expect(await errorCode(reverseTransaction(await reqFor('admin'), String(reversal.id)))).toBe(
        'REVERSAL_TARGET_INVALID',
      )
      expect(await balance(ids.cashA)).toBe(before)

      // `reverses` is stored as an ObjectId: the partial unique index applies to it.
      const raw = (await payload.db.collections.transactions
        .findOne({ _id: reversal.id })
        .lean()) as { reverses?: { _bsontype?: string } } | null
      expect(raw?.reverses?._bsontype).toBe('ObjectId')
    })

    it('entries sent with a reversal are ignored (always the mirror)', async () => {
      const { doc: original } = await post('admin', expense(1_000))
      const { doc } = await post('admin', {
        type: 'reversal',
        reverses: String(original.id),
        location: ids.locB,
        entries: [{ cashRegister: ids.cashB, amount: 99_999 }],
      })
      expect(doc.location).toBe(ids.locA)
      expect((doc.entries as LedgerEntry[]).map((e) => e.amount)).toEqual([1_000])
    })

    it('two concurrent reversals of one operation: exactly one succeeds', async () => {
      const before = await balance(ids.cashA)
      const { doc: original } = await post('admin', expense(3_000))
      const results = await Promise.allSettled(
        [0, 1].map(async () => reverseTransaction(await reqFor('admin'), String(original.id))),
      )
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
      const failure = results.find((r) => r.status === 'rejected') as PromiseRejectedResult
      expect(['ALREADY_REVERSED', 'LEDGER_CONFLICT']).toContain(failure.reason?.data?.code)
      expect(await balance(ids.cashA)).toBe(before)
    })
  })

  describe('immutability', () => {
    it('admin changes only comment and expense category; nobody deletes', async () => {
      const { doc } = await post('admin', expense(700, { comment: 'old' }))
      const id = String(doc.id)
      const before = await balance(ids.cashA)
      const other = (await create('expense-categories', { name: 'Other' })).id

      const updated = (await payload.update({
        collection: 'transactions',
        id,
        data: {
          comment: 'new',
          expenseCategory: other,
          entries: [{ cashRegister: ids.cashA, amount: -1 }],
          occurredAt: new Date(0).toISOString(),
          location: ids.locB,
          reversed: true,
        } as never,
        user: { ...users.admin, collection: 'users' } as never,
        overrideAccess: false,
        depth: 0,
      })) as unknown as Doc
      expect(updated.comment).toBe('new')
      expect(updated.expenseCategory).toBe(other)
      expect((updated.entries as LedgerEntry[]).map((e) => e.amount)).toEqual([-700])
      expect(updated.location).toBe(ids.locA)
      expect(updated.reversed).toBe(false)
      expect(updated.occurredAt).toBe(doc.occurredAt)

      // Even a system update keeps the sums.
      await payload.update({
        collection: 'transactions',
        id,
        data: { entries: [{ cashRegister: ids.cashA, amount: -5 }] } as never,
        overrideAccess: true,
      })
      expect(((await findTx(id)).entries as LedgerEntry[]).map((e) => e.amount)).toEqual([-700])
      expect(await balance(ids.cashA)).toBe(before)

      // Expense category: required for an expense, active when changed.
      expect(
        await errorCode(
          payload.update({
            collection: 'transactions',
            id,
            data: { expenseCategory: null },
            user: { ...users.admin, collection: 'users' } as never,
            overrideAccess: false,
          }),
        ),
      ).toBe('EXPENSE_CATEGORY_REQUIRED')

      for (const who of ['admin', 'manager'] as const)
        expect(
          await errorCode(
            payload.delete({
              collection: 'transactions',
              id,
              user: { ...users[who], collection: 'users' } as never,
              overrideAccess: false,
            }),
          ),
        ).toBe('Forbidden')
      expect(
        await errorCode(
          payload.update({
            collection: 'transactions',
            id,
            data: { comment: 'manager' },
            user: { ...users.manager, collection: 'users' } as never,
            overrideAccess: false,
          }),
        ),
      ).toBe('Forbidden')
    })

    it('a used expense category cannot be deleted', async () => {
      expect(
        await errorCode(
          payload.delete({
            collection: 'expense-categories',
            id: ids.supplies,
            overrideAccess: true,
          }),
        ),
      ).toBe('EXPENSE_CATEGORY_IN_USE')
    })
  })

  describe('roles (§3.1)', () => {
    it('manager: expenses, transfers and reversals in own locations on the current day', async () => {
      const { doc } = await post('manager', expense(500))
      expect(doc.author).toBe(users.manager.id)
      await post('manager', {
        type: 'transfer',
        location: ids.locA,
        entries: [
          { cashRegister: ids.cashA, amount: -300 },
          { cashRegister: ids.cardA, amount: 300 },
        ],
      })
      await reverseTransaction(await reqFor('manager'), String(doc.id))

      const forbidden: TransactionData[] = [
        // Other location.
        {
          type: 'expense',
          location: ids.locB,
          expenseCategory: ids.supplies,
          entries: [{ cashRegister: ids.cashB, amount: -100 }],
        },
        // Back-dated.
        expense(100, { occurredAt: new Date(Date.now() - DAY_MS).toISOString() }),
        // Adjustment is admin-only.
        {
          type: 'adjustment',
          location: ids.locA,
          entries: [{ cashRegister: ids.cashA, amount: 100 }],
          comment: 'x',
        },
      ]
      for (const data of forbidden)
        expect(await errorCode(post('manager', data))).toBe('TRANSACTION_FORBIDDEN')
    })

    it('manager reverses only operations of the current day in own locations (not adjustments)', async () => {
      const yesterday = await post(
        'admin',
        expense(100, { occurredAt: new Date(Date.now() - DAY_MS).toISOString() }),
      )
      const otherLocation = await post('admin', {
        type: 'expense',
        location: ids.locB,
        expenseCategory: ids.supplies,
        entries: [{ cashRegister: ids.cashB, amount: -100 }],
      })
      const adjustment = await post('admin', {
        type: 'adjustment',
        location: ids.locA,
        entries: [{ cashRegister: ids.cashA, amount: 100 }],
        comment: 'x',
      })
      for (const { doc } of [yesterday, otherLocation, adjustment])
        expect(await errorCode(reverseTransaction(await reqFor('manager'), String(doc.id)))).toBe(
          'TRANSACTION_FORBIDDEN',
        )
      // Admin reverses any of them.
      await reverseTransaction(await reqFor('admin'), String(yesterday.doc.id))
    })

    it('manager reads own locations with balances; barber reads registers without balance', async () => {
      const read = async (who: Who, collection: string) =>
        (
          await payload.find({
            collection,
            user: { ...users[who], collection: 'users' } as never,
            overrideAccess: false,
            depth: 0,
            pagination: false,
          } as never)
        ).docs as unknown as Doc[]

      const managerRegisters = await read('manager', 'cash-registers')
      expect(managerRegisters.map((doc) => doc.location).every((l) => l === ids.locA)).toBe(true)
      expect(managerRegisters.every((doc) => typeof doc.balance === 'number')).toBe(true)
      const managerTx = await read('manager', 'transactions')
      expect(managerTx.length).toBeGreaterThan(0)
      expect(managerTx.every((doc) => doc.location === ids.locA)).toBe(true)
      expect((await read('manager', 'expense-categories')).length).toBeGreaterThan(0)

      const barberRegisters = await read('barber', 'cash-registers')
      expect(barberRegisters.length).toBeGreaterThan(0)
      expect(barberRegisters.every((doc) => doc.balance === undefined)).toBe(true)
      // No payments of own appointments yet (stage 18): nothing else is visible.
      expect(await read('barber', 'transactions')).toEqual([])
      expect(await errorCode(read('barber', 'expense-categories'))).toBe('Forbidden')

      expect(await errorCode(read('editor', 'cash-registers'))).toBe('Forbidden')
      expect(await errorCode(read('editor', 'transactions'))).toBe('Forbidden')
      // Registers and categories: only admin writes.
      expect(
        await errorCode(
          payload.create({
            collection: 'cash-registers',
            data: { name: 'X', type: 'cash', location: ids.locA },
            user: { ...users.manager, collection: 'users' } as never,
            overrideAccess: false,
          }),
        ),
      ).toBe('Forbidden')
    })

    it('barber and editor create no expenses or transfers', async () => {
      expect(await errorCode(post('barber', expense(100)))).toBe('TRANSACTION_FORBIDDEN')
      expect(await errorCode(post('editor', expense(100)))).toBe('Forbidden')
    })
  })

  describe('POST /crm/transactions/:id/reverse', () => {
    it('reverses with the user rights; out of scope → 404', async () => {
      const { doc } = await post('admin', expense(200))
      const id = String(doc.id)
      expect((await call('managerB', `/crm/transactions/${id}/reverse`)).status).toBe(404)
      expect((await call('barber', `/crm/transactions/${id}/reverse`)).status).toBe(404)
      expect((await call('editor', `/crm/transactions/${id}/reverse`)).status).toBe(403)

      const done = await call('manager', `/crm/transactions/${id}/reverse`, { comment: 'Typo' })
      expect(done.status).toBe(200)
      expect(done.json.transaction.type).toBe('reversal')
      expect(done.json.transaction.comment).toBe('Typo')
      expect(done.json.warnings).toEqual([])

      const again = await call('admin', `/crm/transactions/${id}/reverse`)
      expect([again.status, again.json.error.code]).toEqual([409, 'ALREADY_REVERSED'])
      expect((await call('admin', '/crm/transactions/nope/reverse')).status).toBe(404)
    })
  })

  describe('recalculation (§5.6)', () => {
    it('random operations: incremental balances equal the recalculation', async () => {
      // Deterministic pseudo-random series over the registers of location A.
      let seed = 17
      const random = () => {
        seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648
        return seed / 2_147_483_648
      }
      const amount = () => 1 + Math.floor(random() * 50_000)
      const created: string[] = []
      for (let i = 0; i < 40; i++) {
        const roll = random()
        if (roll < 0.35) created.push(String((await post('admin', expense(amount()))).doc.id))
        else if (roll < 0.65) {
          const value = amount()
          const [from, to] = random() < 0.5 ? [ids.cashA, ids.cardA] : [ids.cardA, ids.cashA]
          created.push(
            String(
              (
                await post('manager', {
                  type: 'transfer',
                  location: ids.locA,
                  entries: [
                    { cashRegister: from, amount: -value },
                    { cashRegister: to, amount: value },
                  ],
                })
              ).doc.id,
            ),
          )
        } else if (roll < 0.85) {
          const value = amount() * (random() < 0.7 ? 1 : -1)
          created.push(
            String(
              (
                await post('admin', {
                  type: 'adjustment',
                  location: ids.locA,
                  entries: [
                    { cashRegister: random() < 0.5 ? ids.cashA : ids.cardA, amount: value },
                  ],
                  comment: `adj ${i}`,
                })
              ).doc.id,
            ),
          )
        } else if (created.length > 0) {
          const target = created.splice(Math.floor(random() * created.length), 1)[0]
          await reverseTransaction(await reqFor('admin'), target)
        }
      }

      const all = (
        await payload.find({
          collection: 'transactions',
          pagination: false,
          depth: 0,
          overrideAccess: true,
          select: { entries: true },
        })
      ).docs as unknown as { entries: LedgerEntry[] }[]
      const expected = computeBalances(all)
      for (const register of [ids.cashA, ids.cardA, ids.cashB])
        expect(await balance(register)).toBe(expected.get(register) ?? 0)
      expect((await recalculateBalances(payload, { apply: false })).diffs).toEqual([])
    })

    it('fixes a corrupted balance', async () => {
      const correct = await balance(ids.cashA)
      await payload.db.collections['cash-registers'].updateOne(
        { _id: ids.cashA },
        { $set: { balance: correct + 777 } },
      )
      const dry = await recalculateBalances(payload, { apply: false })
      expect(dry.diffs).toEqual([
        { cashRegister: ids.cashA, stored: correct + 777, computed: correct },
      ])
      expect(await balance(ids.cashA)).toBe(correct + 777)
      expect((await recalculateBalances(payload)).diffs).toHaveLength(1)
      expect(await balance(ids.cashA)).toBe(correct)
      expect((await recalculateBalances(payload)).diffs).toEqual([])
    })

    it('parallel operations on one register keep the balance consistent', async () => {
      const before = await balance(ids.cashB)
      const results = await Promise.allSettled(
        Array.from({ length: 8 }, async () =>
          post('admin', {
            type: 'expense',
            location: ids.locB,
            expenseCategory: ids.supplies,
            entries: [{ cashRegister: ids.cashB, amount: -1_000 }],
          }),
        ),
      )
      const succeeded = results.filter((r) => r.status === 'fulfilled').length
      for (const r of results)
        if (r.status === 'rejected') expect(r.reason?.data?.code).toBe('LEDGER_CONFLICT')
      expect(succeeded).toBeGreaterThan(0)
      expect(await balance(ids.cashB)).toBe(before - succeeded * 1_000)
      expect((await recalculateBalances(payload, { apply: false })).diffs).toEqual([])
    })
  })
})
