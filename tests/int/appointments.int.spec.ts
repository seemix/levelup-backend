import { createLocalReq, getPayload, type Payload, type PayloadRequest } from 'payload'
import { beforeAll, describe, expect, it } from 'vitest'

import {
  changeAppointmentStatus,
  createAppointment,
  hashCancelToken,
  updateAppointment,
  type AppointmentInput,
  type AppointmentOptions,
} from '@/crm/appointments'
import { computeSlots } from '@/crm/slots'
import { loadSlotInput } from '@/crm/slots.loader'
import { localToInstant } from '@/crm/time'
import { up as appointmentsUp } from '@/migrations/20261113_000004_appointments'
import config from '@/payload.config'

// 2026-12-07 is a Monday; every barber works 09:00–18:00 every day.
const DAY = '2026-12-07'
const at = (time: string, date = DAY) => localToInstant(date, time)
const iso = (time: string, date = DAY) => at(time, date).toISOString()
// Later than every appointment of these tests (for completed / no_show).
const LATER = new Date('2027-01-01T00:00:00Z')
const EARLY = localToInstant('2026-12-01', '10:00')

type Doc = Record<string, unknown> & { id: string }

describe('appointments', () => {
  let payload: Payload
  const ids: Record<string, string> = {}
  const users: Record<string, { id: string | number; roles: string[]; locations?: string[] }> = {}

  const create = async (collection: string, data: Record<string, unknown>) =>
    (await payload.create({ collection, data, overrideAccess: true } as never)) as unknown as Doc

  /** A fresh request per call (the transaction id lives on it); `who` = user key or system. */
  const reqFor = async (who?: string): Promise<PayloadRequest> =>
    createLocalReq(who ? { user: { ...users[who], collection: 'users' } as never } : {}, payload)

  const base = (patch: AppointmentInput = {}): AppointmentInput => ({
    location: ids.locA,
    barber: ids.b1,
    service: ids.cut,
    client: ids.client1,
    startAt: iso('10:00'),
    ...patch,
  })

  const book = async (patch: AppointmentInput = {}, who?: string, options?: AppointmentOptions) =>
    (await createAppointment(await reqFor(who), base(patch), options)).doc as Doc

  const errorCode = async (promise: Promise<unknown>): Promise<string | undefined> => {
    try {
      await promise
    } catch (error) {
      const e = error as { data?: { code?: string }; name?: string; status?: number }
      return e.data?.code ?? e.name
    }
    return undefined
  }

  const findRaw = async (id: string) =>
    (await payload.findByID({
      collection: 'appointments',
      id,
      depth: 0,
      showHiddenFields: true,
    })) as unknown as Doc

  const logsOf = async (id: string) =>
    (
      await payload.find({
        collection: 'appointment-logs',
        where: { appointment: { equals: id } },
        sort: 'createdAt',
        depth: 0,
        pagination: false,
      })
    ).docs as unknown as Doc[]

  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    await Promise.all(Object.values(payload.db.collections).map((model) => model.init()))
    const req = await createLocalReq({}, payload)
    await appointmentsUp({ payload, req } as Parameters<typeof appointmentsUp>[0])

    ids.locA = (await create('locations', { name: 'A' })).id
    ids.locB = (await create('locations', { name: 'B' })).id
    ids.cut = (await create('services', { name: 'Cut', durationMinutes: 30, price: 30_000 })).id
    ids.beard = (await create('services', { name: 'Beard', durationMinutes: 20, price: 20_000 })).id
    ids.wash = (await create('extras', { name: 'Wash', durationMinutes: 10, price: 5_000 })).id
    ids.wax = (
      await create('extras', {
        name: 'Wax',
        durationMinutes: 5,
        price: 3_000,
        appliesTo: [ids.beard],
      })
    ).id

    for (const [key, roles, locations] of [
      ['admin', ['admin'], []],
      ['manager', ['manager'], [ids.locA]],
      ['managerB', ['manager'], [ids.locB]],
      ['barber1', ['barber'], []],
      ['barber2', ['barber'], []],
    ] as const) {
      const user = await create('users', {
        email: `${key}-appt@test.local`,
        password: 'test',
        roles: [...roles],
        locations: [...locations],
      })
      users[key] = { id: user.id, roles: [...roles], locations: [...locations] }
    }

    const weekly = (location: string) =>
      ['1', '2', '3', '4', '5', '6', '7'].map((weekday) => ({
        weekday,
        location,
        start: '09:00',
        end: '18:00',
      }))
    const barber = async (name: string, order: number, location: string, user?: string | number) =>
      (
        await create('barbers', {
          name,
          order,
          showOnSite: false,
          locations: [location],
          services: [ids.cut, ids.beard],
          weeklySchedule: weekly(location),
          ...(user === undefined ? {} : { user }),
        })
      ).id
    ids.b1 = await barber('One', 1, ids.locA, users.barber1.id)
    ids.b2 = await barber('Two', 2, ids.locA, users.barber2.id)
    ids.b3 = await barber('Three', 3, ids.locB)
    // Barber One charges more for the cut and takes longer.
    await create('barber-prices', {
      barber: ids.b1,
      item: { relationTo: 'services', value: ids.cut },
      price: 35_000,
      durationMinutes: 45,
    })

    ids.client1 = (
      await create('clients', { firstName: 'Ion', phone: '069100001', language: 'ro' })
    ).id
    ids.client2 = (await create('clients', { firstName: 'Ana', phone: '069100002' })).id
  })

  describe('creation', () => {
    it('stores the price snapshot, end, status, source, language and only the token hash', async () => {
      const req = await reqFor('admin')
      const { doc, cancelToken, warnings } = await createAppointment(
        req,
        base({ extras: [ids.wash], startAt: iso('09:00', '2026-12-08') }),
      )
      expect(warnings).toEqual([])
      expect(doc).toMatchObject({
        kind: 'appointment',
        status: 'scheduled',
        source: 'staff',
        paymentStatus: 'unpaid',
        subtotal: 40_000,
        total: 40_000,
        durationMinutes: 55,
        language: 'ro',
        paidAmount: 0,
      })
      expect(doc.lines).toMatchObject([
        { itemType: 'service', item: ids.cut, price: 35_000, durationMinutes: 45 },
        { itemType: 'extra', item: ids.wash, price: 5_000, durationMinutes: 10 },
      ])
      expect(doc.endAt).toBe(iso('09:55', '2026-12-08'))
      expect(String(doc.createdBy)).toBe(String(users.admin.id))
      // The hash is never returned; the stored one is sha256 of the returned token.
      expect(doc.cancelTokenHash).toBeUndefined()
      expect(cancelToken).toMatch(/^[\w-]{43}$/)
      expect((await findRaw(String(doc.id))).cancelTokenHash).toBe(hashCancelToken(cancelToken!))
    })

    it('ignores computed fields sent by the caller', async () => {
      const doc = await book({
        startAt: iso('11:00', '2026-12-08'),
        ...({
          total: 1,
          subtotal: 1,
          paidAmount: 999,
          status: 'scheduled',
          source: 'import',
        } as object),
      })
      expect(doc).toMatchObject({ total: 35_000, subtotal: 35_000, paidAmount: 0 })
    })

    it('validates the selection: service required, extras must apply to the service', async () => {
      expect(await errorCode(book({ service: null, startAt: iso('12:00', '2026-12-08') }))).toBe(
        'SERVICE_REQUIRED',
      )
      expect(
        await errorCode(book({ extras: [ids.wax], startAt: iso('12:00', '2026-12-08') })),
      ).toBe('EXTRA_NOT_APPLICABLE')
      expect(await errorCode(book({ barber: ids.b3, startAt: iso('12:00', '2026-12-08') }))).toBe(
        'BARBER_LOCATION_INVALID',
      )
    })

    it('staff may book outside the schedule with a warning; online may not', async () => {
      const req = await reqFor('manager')
      const { warnings } = await createAppointment(
        req,
        base({ startAt: iso('19:00', '2026-12-08') }),
      )
      expect(warnings).toEqual(['OUTSIDE_SCHEDULE'])

      const online = { mode: 'online' as const, now: EARLY }
      expect(
        await errorCode(book({ startAt: iso('19:30', '2026-12-08') }, undefined, online)),
      ).toBe('SLOT_UNAVAILABLE')
      // Off the 15-minute grid.
      expect(
        await errorCode(book({ startAt: iso('14:05', '2026-12-08') }, undefined, online)),
      ).toBe('SLOT_UNAVAILABLE')
      expect(
        await errorCode(
          book({ client: null, startAt: iso('14:00', '2026-12-08') }, undefined, online),
        ),
      ).toBe('CLIENT_REQUIRED')
      const doc = await book({ startAt: iso('14:00', '2026-12-08') }, undefined, online)
      expect(doc.source).toBe('online')
    })

    it('a status other than scheduled can be set on creation only by the system (import)', async () => {
      expect(
        await errorCode(
          book({ startAt: iso('15:00', '2026-12-08'), status: 'completed' }, 'admin'),
        ),
      ).toBe('STATUS_TRANSITION_INVALID')
      const imported = await book({
        startAt: iso('15:00', '2026-12-08'),
        status: 'completed',
        source: 'import',
      })
      expect(imported).toMatchObject({ status: 'completed', source: 'import' })
    })
  })

  describe('double booking (§5.9)', () => {
    it('10 parallel creations in one slot → exactly 1 succeeds, the rest get SLOT_TAKEN', async () => {
      const results = await Promise.allSettled(
        Array.from({ length: 10 }, async (_, i) =>
          createAppointment(
            await reqFor(),
            base({
              barber: ids.b2,
              startAt: iso('10:00', '2026-12-09'),
              client: i % 2 ? ids.client1 : ids.client2,
            }),
          ),
        ),
      )
      const ok = results.filter((r) => r.status === 'fulfilled')
      const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      expect(ok).toHaveLength(1)
      expect(failed.map((r) => (r.reason as { data?: { code?: string } }).data?.code)).toEqual(
        Array(9).fill('SLOT_TAKEN'),
      )
      const { totalDocs } = await payload.count({
        collection: 'appointments',
        where: { barber: { equals: ids.b2 }, startAt: { equals: iso('10:00', '2026-12-09') } },
      })
      expect(totalDocs).toBe(1)
    })

    it('overlaps are rejected; touching intervals are fine; cancelled ones do not block', async () => {
      const date = '2026-12-10'
      const first = await book({ barber: ids.b2, startAt: iso('10:00', date) }) // 10:00–10:30
      expect(await errorCode(book({ barber: ids.b2, startAt: iso('10:15', date) }))).toBe(
        'SLOT_TAKEN',
      )
      expect(await errorCode(book({ barber: ids.b2, startAt: iso('09:45', date) }))).toBe(
        'SLOT_TAKEN',
      )
      const touching = await book({ barber: ids.b2, startAt: iso('10:30', date) })
      expect(touching.status).toBe('scheduled')

      await changeAppointmentStatus(await reqFor('manager'), first.id, 'cancelled_by_client')
      const reuse = await book({ barber: ids.b2, startAt: iso('10:00', date), client: ids.client2 })
      expect(reuse.status).toBe('scheduled')
      // Restoring the cancelled one into an occupied slot fails.
      expect(
        await errorCode(changeAppointmentStatus(await reqFor('manager'), first.id, 'scheduled')),
      ).toBe('SLOT_TAKEN')
    })

    it('moving into an occupied slot fails, also through the plain Local API (admin form path)', async () => {
      const date = '2026-12-11'
      await book({ barber: ids.b2, startAt: iso('12:00', date) })
      const other = await book({ barber: ids.b2, startAt: iso('13:00', date) })
      expect(
        await errorCode(
          updateAppointment(await reqFor('admin'), other.id, { startAt: iso('12:15', date) }),
        ),
      ).toBe('SLOT_TAKEN')
      expect(
        await errorCode(
          payload.update({
            collection: 'appointments',
            id: other.id,
            data: { startAt: iso('11:45', date) },
            user: { ...users.admin, collection: 'users' } as never,
            overrideAccess: false,
          }),
        ),
      ).toBe('SLOT_TAKEN')
      // Moving within its own interval is not an overlap with itself.
      const moved = await updateAppointment(await reqFor('admin'), other.id, {
        startAt: iso('13:15', date),
      })
      expect(moved.doc.endAt).toBe(iso('13:45', date))
    })

    it('time blocks occupy the barber and only have scheduled/cancelled_by_salon', async () => {
      const date = '2026-12-12'
      const block = await book({
        kind: 'block',
        barber: ids.b2,
        startAt: iso('15:00', date),
        durationMinutes: 60,
        service: ids.cut,
        client: ids.client1,
      })
      expect(block).toMatchObject({ kind: 'block', total: 0, endAt: iso('16:00', date) })
      expect(block.service ?? null).toBeNull()
      expect(block.client ?? null).toBeNull()
      expect(await errorCode(book({ barber: ids.b2, startAt: iso('15:30', date) }))).toBe(
        'SLOT_TAKEN',
      )
      expect(
        await errorCode(
          book({ kind: 'block', barber: ids.b2, startAt: iso('16:30', date), durationMinutes: 0 }),
        ),
      ).toBe('BLOCK_TIME_INVALID')
      expect(
        await errorCode(
          changeAppointmentStatus(await reqFor('admin'), block.id, 'completed', { now: LATER }),
        ),
      ).toBe('STATUS_TRANSITION_INVALID')
      await changeAppointmentStatus(await reqFor('manager'), block.id, 'cancelled_by_salon')
      expect((await book({ barber: ids.b2, startAt: iso('15:30', date) })).status).toBe('scheduled')
    })

    it('the slot loader sees appointments as busy', async () => {
      const req = await reqFor()
      const input = await loadSlotInput(
        payload,
        {
          mode: 'staff',
          locationId: ids.locA,
          date: '2026-12-10',
          barberId: ids.b2,
          serviceId: ids.cut,
          now: EARLY,
        },
        req,
      )
      const times = computeSlots(input).map((slot) => slot.time)
      expect(times).not.toContain('10:00')
      expect(times).not.toContain('10:30')
      expect(times).toContain('11:00')
    })
  })

  describe('status transitions by role', () => {
    const date = '2026-12-14'

    it('barber: completes and cancels own, cannot restore; too early is rejected', async () => {
      const a = await book({ startAt: iso('10:00', date) })
      const barberReq = async () => reqFor('barber1')
      expect(
        await errorCode(
          changeAppointmentStatus(await barberReq(), a.id, 'completed', { now: at('09:00', date) }),
        ),
      ).toBe('STATUS_TOO_EARLY')
      const done = await changeAppointmentStatus(await barberReq(), a.id, 'completed', {
        now: LATER,
      })
      expect(done.doc).toMatchObject({ status: 'completed' })
      expect(done.doc.statusChangedAt).toBe(LATER.toISOString())
      expect(await errorCode(changeAppointmentStatus(await barberReq(), a.id, 'scheduled'))).toBe(
        'STATUS_FORBIDDEN',
      )
      expect(await errorCode(changeAppointmentStatus(await barberReq(), a.id, 'paid'))).toBe(
        'STATUS_TRANSITION_INVALID',
      )

      const b = await book({ startAt: iso('11:00', date) })
      expect(
        await errorCode(changeAppointmentStatus(await barberReq(), b.id, 'cancelled_by_salon')),
      ).toBe('CANCEL_REASON_REQUIRED')
      const cancelled = await changeAppointmentStatus(
        await barberReq(),
        b.id,
        'cancelled_by_salon',
        {
          cancelReason: 'Barber is ill',
        },
      )
      expect(cancelled.doc).toMatchObject({
        status: 'cancelled_by_salon',
        cancelReason: 'Barber is ill',
      })
      expect(cancelled.doc.cancelledAt).toBeTruthy()
    })

    it('manager restores cancelled and no-show appointments; admin too', async () => {
      const a = await book({ startAt: iso('12:00', date) })
      await changeAppointmentStatus(await reqFor('manager'), a.id, 'no_show', { now: LATER })
      const restored = await changeAppointmentStatus(await reqFor('manager'), a.id, 'scheduled')
      expect(restored.doc).toMatchObject({ status: 'scheduled', cancelledAt: null })
      await changeAppointmentStatus(await reqFor('admin'), a.id, 'cancelled_by_client')
      expect(
        (await changeAppointmentStatus(await reqFor('admin'), a.id, 'scheduled')).doc.status,
      ).toBe('scheduled')
    })

    it('client: cancels by token rules (≥ clientCancelMinHours before the start)', async () => {
      const a = await book({ startAt: iso('13:00', date) })
      const client = { actorType: 'client' as const }
      expect(
        await errorCode(
          changeAppointmentStatus(await reqFor(), a.id, 'cancelled_by_client', {
            ...client,
            now: at('11:00', date),
          }),
        ),
      ).toBe('CANCEL_TOO_LATE')
      expect(
        await errorCode(
          changeAppointmentStatus(await reqFor(), a.id, 'cancelled_by_salon', {
            ...client,
            cancelReason: 'x',
          }),
        ),
      ).toBe('STATUS_FORBIDDEN')
      const done = await changeAppointmentStatus(await reqFor(), a.id, 'cancelled_by_client', {
        ...client,
        now: at('09:00', date),
      })
      expect(done.doc.status).toBe('cancelled_by_client')
      const logs = await logsOf(a.id)
      expect(logs.at(-1)).toMatchObject({ action: 'status', actorType: 'client' })
    })

    it('cancelling a paid appointment warns that a refund is needed', async () => {
      const a = await book({ startAt: iso('14:00', date) })
      // Payments arrive with the ledger (stage 18); emulate one.
      await payload.db.collections['appointments'].updateOne(
        { _id: a.id },
        { $set: { paidAmount: 10_000 } },
      )
      const result = await changeAppointmentStatus(
        await reqFor('manager'),
        a.id,
        'cancelled_by_client',
      )
      expect(result.warnings).toContain('REFUND_REQUIRED')
      expect(result.doc.paymentStatus).toBe('partial')
    })
  })

  describe('access (row-level)', () => {
    const date = '2026-12-15'

    it('barber sees and edits only own appointments, cannot book for another barber', async () => {
      const own = await book({ startAt: iso('10:00', date) })
      const other = await book({ barber: ids.b2, startAt: iso('10:00', date) })
      const asBarber = {
        user: { ...users.barber1, collection: 'users' } as never,
        overrideAccess: false,
      }
      const { docs } = await payload.find({
        collection: 'appointments',
        where: { startAt: { greater_than_equal: iso('00:00', date) } },
        ...asBarber,
      })
      expect(docs.map((d) => d.id)).toEqual([own.id])
      expect(
        await errorCode(
          payload.findByID({ collection: 'appointments', id: other.id, ...asBarber }),
        ),
      ).toBe('NotFound')
      expect(
        await errorCode(book({ barber: ids.b2, startAt: iso('12:00', date) }, 'barber1')),
      ).toBe('Forbidden')
      // Moving own appointment to another barber is rejected.
      expect(
        await errorCode(updateAppointment(await reqFor('barber1'), own.id, { barber: ids.b2 })),
      ).toBe('APPOINTMENT_FORBIDDEN')
      expect((await book({ startAt: iso('12:00', date) }, 'barber1')).status).toBe('scheduled')
      expect(
        await errorCode(payload.delete({ collection: 'appointments', id: own.id, ...asBarber })),
      ).toBe('Forbidden')
    })

    it('manager sees own locations only and cannot move appointments out of them', async () => {
      const inA = await book({ startAt: iso('14:00', date) })
      const inB = await book({ location: ids.locB, barber: ids.b3, startAt: iso('14:00', date) })
      const asManager = {
        user: { ...users.manager, collection: 'users' } as never,
        overrideAccess: false,
      }
      const { docs } = await payload.find({
        collection: 'appointments',
        where: { startAt: { equals: iso('14:00', date) } },
        ...asManager,
      })
      expect(docs.map((d) => d.id)).toEqual([inA.id])
      expect(
        await errorCode(
          book({ location: ids.locB, barber: ids.b3, startAt: iso('15:00', date) }, 'manager'),
        ),
      ).toBe('Forbidden')
      expect(
        await errorCode(
          updateAppointment(await reqFor('manager'), inA.id, {
            location: ids.locB,
            barber: ids.b3,
          }),
        ),
      ).toBe('APPOINTMENT_FORBIDDEN')
      expect(
        await errorCode(payload.delete({ collection: 'appointments', id: inA.id, ...asManager })),
      ).toBe('Forbidden')
      expect(
        await errorCode(updateAppointment(await reqFor('managerB'), inA.id, { internalNote: 'x' })),
      ).toBe('Forbidden')
      expect(inB.status).toBe('scheduled')
    })

    it('logs are read-only and follow the appointment scope', async () => {
      const own = await book({ startAt: iso('16:00', date) })
      const other = await book({ barber: ids.b2, startAt: iso('16:00', date) })
      const asBarber = {
        user: { ...users.barber1, collection: 'users' } as never,
        overrideAccess: false,
      }
      const { docs } = await payload.find({
        collection: 'appointment-logs',
        where: { appointment: { in: [own.id, other.id] } },
        depth: 0,
        ...asBarber,
      })
      expect(docs.map((d) => String(d.appointment))).toEqual([own.id])
      const asAdmin = {
        user: { ...users.admin, collection: 'users' } as never,
        overrideAccess: false,
      }
      const log = (await logsOf(own.id))[0]
      expect(
        await errorCode(
          payload.update({
            collection: 'appointment-logs',
            id: log.id,
            data: { action: 'update' },
            ...asAdmin,
          }),
        ),
      ).toBe('Forbidden')
      expect(
        await errorCode(payload.delete({ collection: 'appointment-logs', id: log.id, ...asAdmin })),
      ).toBe('Forbidden')
      expect(
        await errorCode(
          payload.create({
            collection: 'appointment-logs',
            data: {
              appointment: own.id,
              actorType: 'user',
              action: 'create',
              at: new Date().toISOString(),
            },
            ...asAdmin,
          }),
        ),
      ).toBe('Forbidden')
    })
  })

  describe('prices, discounts, history', () => {
    const date = '2026-12-16'

    it('manual discount: admin/manager only, recalculated from the snapshot', async () => {
      const a = await book({ startAt: iso('10:00', date) }) // 35 000 (barber price)
      expect(
        await errorCode(
          updateAppointment(await reqFor('barber1'), a.id, {
            manualDiscountType: 'amount',
            manualDiscountValue: 5_000,
            manualDiscountReason: 'friend',
          }),
        ),
      ).toBe('DISCOUNT_FORBIDDEN')
      expect(
        await errorCode(
          updateAppointment(await reqFor('manager'), a.id, {
            manualDiscountType: 'amount',
            manualDiscountValue: 5_000,
          }),
        ),
      ).toBe('DISCOUNT_REASON_REQUIRED')
      expect(
        await errorCode(
          updateAppointment(await reqFor('manager'), a.id, {
            manualDiscountType: 'amount',
            manualDiscountValue: 40_000,
            manualDiscountReason: 'x',
          }),
        ),
      ).toBe('DISCOUNT_TOO_LARGE')

      // The catalog price changes later: the snapshot keeps the old price.
      await payload.update({ collection: 'services', id: ids.cut, data: { price: 31_000 } })
      const updated = await updateAppointment(await reqFor('manager'), a.id, {
        manualDiscountType: 'percent',
        manualDiscountValue: 10,
        manualDiscountReason: 'regular',
      })
      expect(updated.doc).toMatchObject({ subtotal: 35_000, manualDiscount: 3_500, total: 31_500 })
      await payload.update({ collection: 'services', id: ids.cut, data: { price: 30_000 } })
    })

    it('changing the barber recalculates prices and duration', async () => {
      const a = await book({ startAt: iso('12:00', date) })
      expect(a).toMatchObject({ total: 35_000, durationMinutes: 45 })
      const moved = await updateAppointment(await reqFor('manager'), a.id, { barber: ids.b2 })
      expect(moved.doc).toMatchObject({
        total: 30_000,
        durationMinutes: 30,
        endAt: iso('12:30', date),
      })
    })

    it('a paid appointment: only admin changes services', async () => {
      const a = await book({ startAt: iso('14:00', date) })
      await payload.db.collections['appointments'].updateOne(
        { _id: a.id },
        { $set: { status: 'paid', paymentStatus: 'paid', paidAmount: 35_000 } },
      )
      expect(
        await errorCode(updateAppointment(await reqFor('manager'), a.id, { extras: [ids.wash] })),
      ).toBe('APPOINTMENT_PAID_LOCKED')
      const changed = await updateAppointment(await reqFor('admin'), a.id, { extras: [ids.wash] })
      expect(changed.doc).toMatchObject({ total: 40_000, paymentStatus: 'partial', status: 'paid' })
      // Notes are not price changes.
      expect(
        (await updateAppointment(await reqFor('manager'), a.id, { internalNote: 'ok' })).doc
          .internalNote,
      ).toBe('ok')
    })

    it('history: create, move and status entries with changed fields and the actor', async () => {
      const a = await book({ startAt: iso('16:00', date) }, 'manager')
      await updateAppointment(await reqFor('manager'), a.id, { startAt: iso('16:30', date) })
      await updateAppointment(await reqFor('manager'), a.id, { clientComment: 'call before' })
      await changeAppointmentStatus(await reqFor('barber1'), a.id, 'completed', { now: LATER })
      // Saving without changes writes nothing.
      await updateAppointment(await reqFor('manager'), a.id, {})

      const logs = await logsOf(a.id)
      expect(logs.map((log) => log.action)).toEqual(['create', 'move', 'update', 'status'])
      expect(logs.map((log) => String(log.actor))).toEqual([
        String(users.manager.id),
        String(users.manager.id),
        String(users.manager.id),
        String(users.barber1.id),
      ])
      expect(logs[0]).toMatchObject({ actorType: 'user', location: ids.locA, barber: ids.b1 })
      const move = logs[1].changes as { field: string; from: unknown; to: unknown }[]
      expect(move).toEqual(
        expect.arrayContaining([
          {
            id: expect.anything(),
            field: 'startAt',
            from: iso('16:00', date),
            to: iso('16:30', date),
          },
          {
            id: expect.anything(),
            field: 'endAt',
            from: iso('16:45', date),
            to: iso('17:15', date),
          },
        ]),
      )
      expect(logs[3].changes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'status', from: 'scheduled', to: 'completed' }),
        ]),
      )
    })
  })

  describe('promo codes (§5.5)', () => {
    const date = '2026-12-17'

    const usedCount = async (id: string) =>
      (
        (await payload.findByID({ collection: 'promo-codes', id, depth: 0 })) as unknown as {
          usedCount: number
        }
      ).usedCount

    it('usedCount follows creation, cancellation, restore and removal', async () => {
      const promo = await create('promo-codes', {
        code: 'APPT10',
        discountType: 'percent',
        value: 10,
      })
      const a = await book({ startAt: iso('10:00', date), promoCode: promo.id })
      expect(a).toMatchObject({ subtotal: 35_000, promoDiscount: 3_500, total: 31_500 })
      expect(await usedCount(promo.id)).toBe(1)

      await changeAppointmentStatus(await reqFor('manager'), a.id, 'cancelled_by_client')
      expect(await usedCount(promo.id)).toBe(0)
      await changeAppointmentStatus(await reqFor('manager'), a.id, 'scheduled')
      expect(await usedCount(promo.id)).toBe(1)
      await updateAppointment(await reqFor('manager'), a.id, { promoCode: null })
      expect(await usedCount(promo.id)).toBe(0)
      expect((await findRaw(a.id)).total).toBe(35_000)
      // A no-show still counts as a use.
      await updateAppointment(await reqFor('manager'), a.id, { promoCode: promo.id })
      await changeAppointmentStatus(await reqFor('manager'), a.id, 'no_show', { now: LATER })
      expect(await usedCount(promo.id)).toBe(1)
    })

    it('limits: total and per client; a failed booking does not count', async () => {
      const promo = await create('promo-codes', {
        code: 'ONCE',
        discountType: 'fixed',
        value: 100_000,
        maxUses: 2,
        maxUsesPerClient: 1,
      })
      const first = await book({ startAt: iso('12:00', date), promoCode: promo.id })
      expect(first).toMatchObject({ promoDiscount: 35_000, total: 0 })
      expect(await errorCode(book({ startAt: iso('13:00', date), promoCode: promo.id }))).toBe(
        'PROMO_CLIENT_LIMIT',
      )
      expect(await usedCount(promo.id)).toBe(1)
      await book({ startAt: iso('13:00', date), promoCode: promo.id, client: ids.client2 })
      expect(await usedCount(promo.id)).toBe(2)
      const third = await create('clients', { firstName: 'X', phone: '069100003' })
      expect(
        await errorCode(
          book({ startAt: iso('14:00', date), promoCode: promo.id, client: third.id }),
        ),
      ).toBe('PROMO_LIMIT')
      // Editing an appointment that already holds the code does not re-check the limit.
      const edited = await updateAppointment(await reqFor('admin'), first.id, {
        extras: [ids.wash],
      })
      expect(edited.doc).toMatchObject({ promoDiscount: 40_000, total: 0 })
      expect(await usedCount(promo.id)).toBe(2)
    })

    it('staff-only codes are rejected online', async () => {
      const promo = await create('promo-codes', {
        code: 'STAFF',
        discountType: 'percent',
        value: 5,
        onlineAllowed: false,
      })
      expect(
        await errorCode(
          book({ startAt: iso('15:00', date), promoCode: promo.id }, undefined, {
            mode: 'online',
            now: EARLY,
          }),
        ),
      ).toBe('PROMO_NOT_FOUND')
      expect(
        (await book({ startAt: iso('15:00', date), promoCode: promo.id }, 'manager')).promoDiscount,
      ).toBe(1_750)
    })
  })

  describe('schedule exceptions warning (§4.5)', () => {
    it('lists scheduled appointments of the barber on the exception dates for admin/manager', async () => {
      const date = '2026-12-18'
      const a = await book({ startAt: iso('10:00', date) })
      const cancelled = await book({ startAt: iso('12:00', date) })
      await changeAppointmentStatus(await reqFor('admin'), cancelled.id, 'cancelled_by_client')
      const exception = await create('schedule-exceptions', {
        barber: ids.b1,
        kind: 'day_off',
        dateFrom: date,
        dateTo: date,
      })
      const read = async (who: string) =>
        (await payload.findByID({
          collection: 'schedule-exceptions',
          id: exception.id,
          depth: 0,
          user: { ...users[who], collection: 'users' } as never,
          overrideAccess: false,
        })) as unknown as { appointmentsInRange?: string[] }
      expect((await read('manager')).appointmentsInRange?.map(String)).toEqual([a.id])
      expect((await read('admin')).appointmentsInRange?.map(String)).toEqual([a.id])
      expect((await read('barber1')).appointmentsInRange).toBeUndefined()
    })
  })
})
