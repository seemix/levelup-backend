import { describe, expect, it } from 'vitest'

import {
  checkTransition,
  derivePaymentStatus,
  type AppointmentStatus,
  type TransitionInput,
} from '@/crm/appointment-status'

const startAt = new Date('2026-12-07T10:00:00Z')
const before = new Date('2026-12-07T09:00:00Z')
const after = new Date('2026-12-07T11:00:00Z')
const staff = { type: 'user' as const, canRestore: false }
const manager = { type: 'user' as const, canRestore: true }

const t = (from: AppointmentStatus, to: AppointmentStatus, patch: Partial<TransitionInput> = {}) =>
  checkTransition({ kind: 'appointment', from, to, actor: staff, startAt, now: after, ...patch })

describe('checkTransition (§5.1)', () => {
  it('scheduled → completed / no_show only after the start', () => {
    expect(t('scheduled', 'completed')).toEqual({ ok: true, status: 'completed' })
    expect(t('scheduled', 'no_show')).toEqual({ ok: true, status: 'no_show' })
    expect(t('scheduled', 'completed', { now: before })).toEqual({
      ok: false,
      code: 'STATUS_TOO_EARLY',
    })
    expect(t('scheduled', 'no_show', { now: before })).toEqual({
      ok: false,
      code: 'STATUS_TOO_EARLY',
    })
    // Exactly at the start is allowed.
    expect(t('scheduled', 'completed', { now: startAt }).ok).toBe(true)
  })

  it('completing a fully paid visit makes it paid at once', () => {
    expect(t('scheduled', 'completed', { fullyPaid: true })).toEqual({ ok: true, status: 'paid' })
  })

  it('cancellations by staff; salon cancellation needs a reason', () => {
    expect(t('scheduled', 'cancelled_by_client', { now: before }).ok).toBe(true)
    expect(t('scheduled', 'cancelled_by_salon')).toEqual({
      ok: false,
      code: 'CANCEL_REASON_REQUIRED',
    })
    expect(t('scheduled', 'cancelled_by_salon', { cancelReason: '  ' })).toMatchObject({
      ok: false,
    })
    expect(t('scheduled', 'cancelled_by_salon', { cancelReason: 'ill' }).ok).toBe(true)
  })

  it('restore to scheduled: admin/manager only', () => {
    for (const from of [
      'cancelled_by_client',
      'cancelled_by_salon',
      'no_show',
      'completed',
    ] as const) {
      expect(t(from, 'scheduled')).toEqual({ ok: false, code: 'STATUS_FORBIDDEN' })
      expect(t(from, 'scheduled', { actor: manager })).toEqual({ ok: true, status: 'scheduled' })
      expect(t(from, 'scheduled', { actor: { type: 'system' } }).ok).toBe(true)
    }
  })

  it('paid is reached and left only by the ledger', () => {
    expect(t('scheduled', 'paid')).toEqual({ ok: false, code: 'STATUS_TRANSITION_INVALID' })
    expect(t('completed', 'paid', { actor: manager })).toMatchObject({ ok: false })
    expect(t('paid', 'completed', { actor: manager })).toMatchObject({ ok: false })
    expect(t('completed', 'paid', { ledger: true }).ok).toBe(true)
    expect(t('paid', 'completed', { ledger: true }).ok).toBe(true)
  })

  it('other transitions are invalid', () => {
    expect(t('completed', 'no_show', { actor: manager })).toMatchObject({
      code: 'STATUS_TRANSITION_INVALID',
    })
    expect(t('cancelled_by_client', 'completed', { actor: manager })).toMatchObject({
      code: 'STATUS_TRANSITION_INVALID',
    })
    expect(t('no_show', 'cancelled_by_salon', { actor: manager, cancelReason: 'x' })).toMatchObject(
      {
        code: 'STATUS_TRANSITION_INVALID',
      },
    )
  })

  it('client: only own cancellation, not later than clientCancelMinHours before the start', () => {
    const client = { type: 'client' as const }
    const threeHoursBefore = new Date('2026-12-07T07:00:00Z')
    const twoHoursBefore = new Date('2026-12-07T08:00:00Z')
    expect(
      t('scheduled', 'cancelled_by_client', {
        actor: client,
        now: threeHoursBefore,
        clientCancelMinHours: 3,
      }),
    ).toEqual({ ok: true, status: 'cancelled_by_client' })
    expect(
      t('scheduled', 'cancelled_by_client', {
        actor: client,
        now: twoHoursBefore,
        clientCancelMinHours: 3,
      }),
    ).toEqual({ ok: false, code: 'CANCEL_TOO_LATE' })
    expect(t('scheduled', 'cancelled_by_salon', { actor: client, cancelReason: 'x' })).toEqual({
      ok: false,
      code: 'STATUS_FORBIDDEN',
    })
    expect(t('cancelled_by_client', 'scheduled', { actor: client })).toMatchObject({ ok: false })
  })

  it('blocks: only scheduled ↔ cancelled_by_salon (no reason needed)', () => {
    const block = (from: AppointmentStatus, to: AppointmentStatus, actor = staff) =>
      checkTransition({ kind: 'block', from, to, actor, startAt, now: after })
    expect(block('scheduled', 'cancelled_by_salon').ok).toBe(true)
    expect(block('scheduled', 'completed')).toMatchObject({ code: 'STATUS_TRANSITION_INVALID' })
    expect(block('scheduled', 'no_show')).toMatchObject({ code: 'STATUS_TRANSITION_INVALID' })
    expect(block('cancelled_by_salon', 'scheduled')).toMatchObject({ code: 'STATUS_FORBIDDEN' })
    expect(block('cancelled_by_salon', 'scheduled', manager).ok).toBe(true)
  })

  it('same status is a no-op', () => {
    expect(t('no_show', 'no_show')).toEqual({ ok: true, status: 'no_show' })
  })
})

describe('derivePaymentStatus', () => {
  it('unpaid / partial / paid / refunded', () => {
    expect(derivePaymentStatus(0, 10_000)).toBe('unpaid')
    expect(derivePaymentStatus(5_000, 10_000)).toBe('partial')
    expect(derivePaymentStatus(10_000, 10_000)).toBe('paid')
    expect(derivePaymentStatus(12_000, 10_000)).toBe('paid')
    expect(derivePaymentStatus(0, 10_000, 'refunded')).toBe('refunded')
    expect(derivePaymentStatus(0, 0)).toBe('unpaid')
  })
})
