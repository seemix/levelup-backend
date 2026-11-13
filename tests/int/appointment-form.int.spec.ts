import { describe, expect, it } from 'vitest'

import {
  appointmentActions,
  buildCreateBody,
  buildPatchBody,
  buildPreviewBody,
  defaultNewStart,
  emptyForm,
  parseManualDiscount,
  slotStartAt,
  validateForm,
  type ActionFacts,
} from '@/crm/appointment-form'
import { errorKeyFor, API_ERROR_KEYS, RULE_ERROR_KEYS } from '@/crm/error-keys'
import { localToInstant, toLocalDate, toLocalTime } from '@/crm/time'

const form = (patch: Parameters<typeof emptyForm>[0] = {}) =>
  emptyForm({
    barber: 'b1',
    date: '2026-12-14',
    time: '10:30',
    service: 's1',
    ...patch,
  })

const options = { location: 'loc', canDiscount: true }

describe('manual discount parsing', () => {
  it('empty or zero = no discount; lei text → bani; percent as a number', () => {
    expect(parseManualDiscount(form())).toBeNull()
    expect(parseManualDiscount(form({ discountValue: '0' }))).toBeNull()
    expect(
      parseManualDiscount(
        form({ discountType: 'amount', discountValue: '12,50', discountReason: ' Regular ' }),
      ),
    ).toEqual({ type: 'amount', value: 1250, reason: 'Regular' })
    expect(parseManualDiscount(form({ discountType: 'percent', discountValue: '10' }))).toEqual({
      type: 'percent',
      value: 10,
      reason: null,
    })
  })

  it('rejects text that is not a number and percentages above 100', () => {
    expect(parseManualDiscount(form({ discountValue: 'abc' }))).toBeUndefined()
    expect(parseManualDiscount(form({ discountValue: '1.234' }))).toBeUndefined()
    expect(
      parseManualDiscount(form({ discountType: 'percent', discountValue: '101' })),
    ).toBeUndefined()
  })
})

describe('validateForm', () => {
  it('requires barber, a valid date and time, and a service for an appointment', () => {
    expect(validateForm(form())).toEqual({})
    expect(validateForm(form({ barber: '', service: '', date: '14.12', time: '25:00' }))).toEqual({
      barber: 'required',
      service: 'required',
      date: 'dateInvalid',
      time: 'timeInvalid',
    })
  })

  it('a time block needs a positive whole duration instead of a service', () => {
    expect(validateForm(form({ kind: 'block', service: '', duration: '60' }))).toEqual({})
    expect(validateForm(form({ kind: 'block', duration: '0' }))).toEqual({
      duration: 'durationInvalid',
    })
    expect(validateForm(form({ kind: 'block', duration: '1.5' }))).toEqual({
      duration: 'durationInvalid',
    })
  })

  it('reports an unparsable discount', () => {
    expect(validateForm(form({ discountValue: 'x' }))).toEqual({
      discountValue: 'discountValueInvalid',
    })
  })
})

describe('buildCreateBody', () => {
  it('start is the local wall-clock time as a UTC instant (Chisinau, winter UTC+2)', () => {
    const body = buildCreateBody(form(), options)
    expect(body.start).toBe('2026-12-14T08:30:00.000Z')
    expect(body).toMatchObject({
      kind: 'appointment',
      location: 'loc',
      barber: 'b1',
      service: 's1',
      extras: [],
    })
  })

  it('client: an id, a phone with a name for the server to link, or "without a name"', () => {
    expect(buildCreateBody(form({ clientId: 'c1', phone: '069100001' }), options)).toMatchObject({
      client: 'c1',
    })
    const byPhone = buildCreateBody(
      form({ phone: ' 069100001 ', firstName: ' Ion ', lastName: '' }),
      options,
    )
    expect(byPhone).toMatchObject({ clientPhone: '069100001', clientFirstName: 'Ion' })
    expect(byPhone).not.toHaveProperty('clientLastName')
    expect(byPhone).not.toHaveProperty('client')
    expect(buildCreateBody(form({ withoutName: true, phone: '069100001' }), options)).toMatchObject(
      {
        client: null,
      },
    )
    const none = buildCreateBody(form(), options)
    expect(none).not.toHaveProperty('client')
    expect(none).not.toHaveProperty('clientPhone')
  })

  it('promo code and discount are sent only when the role may give them', () => {
    const state = form({ promoCode: ' levelup10 ', discountValue: '10', discountType: 'percent' })
    expect(buildCreateBody(state, options)).toMatchObject({
      promoCode: 'levelup10',
      manualDiscount: { type: 'percent', value: 10, reason: null },
    })
    expect(buildCreateBody(state, { ...options, canDiscount: false })).not.toHaveProperty(
      'manualDiscount',
    )
  })

  it('a time block carries the duration and no service or client', () => {
    const body = buildCreateBody(
      form({ kind: 'block', duration: '45', phone: '069100001' }),
      options,
    )
    expect(body).toMatchObject({ kind: 'block', durationMinutes: 45 })
    expect(body).not.toHaveProperty('service')
    expect(body).not.toHaveProperty('clientPhone')
  })
})

describe('buildPatchBody', () => {
  const initial = form({ clientId: 'c1', phone: '069100001', extras: ['e1'], clientComment: 'a' })

  it('sends only what changed (the server warns PRICE_CHANGED by the fields present)', () => {
    expect(buildPatchBody(initial, { ...initial }, options)).toEqual({})
    expect(buildPatchBody(initial, { ...initial, barber: 'b2' }, options)).toEqual({ barber: 'b2' })
    expect(buildPatchBody(initial, { ...initial, time: '11:00' }, options)).toEqual({
      start: '2026-12-14T09:00:00.000Z',
    })
    expect(buildPatchBody(initial, { ...initial, extras: [] }, options)).toEqual({ extras: [] })
    expect(buildPatchBody(initial, { ...initial, extras: ['e1'] }, options)).toEqual({})
  })

  it('removing a promo code, discount or comment sends null', () => {
    const before = form({
      promoCode: 'X',
      discountValue: '10',
      discountType: 'percent',
      internalNote: 'n',
    })
    const cleared = { ...before, promoCode: '', discountValue: '', internalNote: '' }
    expect(buildPatchBody(before, cleared, options)).toEqual({
      promoCode: null,
      manualDiscount: null,
      internalNote: null,
    })
  })

  it('a barber never sends discount fields; changing the phone relinks by phone', () => {
    const before = form({ discountValue: '10', discountType: 'percent' })
    const after = { ...before, discountValue: '20' }
    expect(buildPatchBody(before, after, { ...options, canDiscount: false })).toEqual({})
    expect(
      buildPatchBody(
        initial,
        { ...initial, clientId: null, phone: '069222222', firstName: 'Vlad' },
        options,
      ),
    ).toEqual({ clientPhone: '069222222', clientFirstName: 'Vlad' })
  })
})

describe('buildPreviewBody', () => {
  it('only for an appointment with a barber and a service; bad discount → none', () => {
    expect(buildPreviewBody(form({ kind: 'block' }), options)).toBeNull()
    expect(buildPreviewBody(form({ service: '' }), options)).toBeNull()
    expect(buildPreviewBody(form({ discountValue: 'x' }), options)).toBeNull()
    expect(
      buildPreviewBody(form({ extras: ['e1'], promoCode: 'p' }), { ...options, clientId: 'c1' }),
    ).toEqual({
      location: 'loc',
      barber: 'b1',
      service: 's1',
      extras: ['e1'],
      promoCode: 'p',
      client: 'c1',
    })
  })
})

describe('appointmentActions', () => {
  const now = new Date('2026-12-14T10:00:00Z')
  const past = new Date('2026-12-14T08:00:00Z')
  const future = new Date('2026-12-14T12:00:00Z')
  const facts = (
    patch: Partial<Omit<ActionFacts, 'can'>> & { can?: Partial<ActionFacts['can']> } = {},
  ): ActionFacts => ({
    kind: 'appointment',
    status: 'scheduled',
    startAt: past,
    now,
    ...patch,
    can: { restore: false, update: true, paid: false, ...patch.can },
  })

  it('scheduled and started: edit, complete, no-show, cancel', () => {
    expect(appointmentActions(facts())).toEqual({
      edit: true,
      complete: true,
      completeTooEarly: false,
      noShow: true,
      cancel: true,
      restore: false,
    })
  })

  it('scheduled in the future: complete is flagged too early, no-show is not offered', () => {
    expect(appointmentActions(facts({ startAt: future }))).toMatchObject({
      complete: true,
      completeTooEarly: true,
      noShow: false,
      cancel: true,
    })
  })

  it('a time block can only be edited or cancelled', () => {
    expect(appointmentActions(facts({ kind: 'block' }))).toMatchObject({
      edit: true,
      complete: false,
      noShow: false,
      cancel: true,
    })
  })

  it('finished and cancelled appointments: restore only for admin/manager', () => {
    for (const status of ['no_show', 'cancelled_by_client', 'cancelled_by_salon']) {
      expect(appointmentActions(facts({ status }))).toMatchObject({
        edit: false,
        cancel: false,
        restore: false,
      })
      expect(appointmentActions(facts({ status, can: { restore: true } }))).toMatchObject({
        restore: true,
        edit: false,
      })
    }
    expect(
      appointmentActions(facts({ status: 'completed', can: { restore: true } })),
    ).toMatchObject({
      edit: true,
      restore: true,
      cancel: false,
    })
  })

  it('a paid appointment: only an admin may edit it', () => {
    expect(appointmentActions(facts({ status: 'paid' })).edit).toBe(false)
    expect(appointmentActions(facts({ status: 'paid', can: { paid: true } })).edit).toBe(true)
    expect(
      appointmentActions(facts({ status: 'paid', can: { paid: true, restore: true } })),
    ).toMatchObject({
      restore: false,
      cancel: false,
    })
  })

  it('no update access: nothing to edit', () => {
    expect(appointmentActions(facts({ can: { update: false } })).edit).toBe(false)
  })
})

describe('grid click → start time', () => {
  it('floors to the grid step from the local midnight', () => {
    const start = slotStartAt('2026-12-14', 10 * 60 + 37, 15)
    expect(toLocalTime(start)).toBe('10:30')
    expect(toLocalDate(start)).toBe('2026-12-14')
    expect(toLocalTime(slotStartAt('2026-12-14', 10 * 60 + 15, 15))).toBe('10:15')
    expect(toLocalTime(slotStartAt('2026-12-14', -5, 15))).toBe('00:00')
  })

  it('counts real minutes on the DST day (2026-03-29: 03:00 does not exist)', () => {
    // 04:00 local on the spring-forward day is 180 real minutes after midnight.
    expect(toLocalTime(slotStartAt('2026-03-29', 180, 15))).toBe('04:00')
  })
})

describe('defaultNewStart', () => {
  it('today: the next grid step; another day: 10:00', () => {
    const now = localToInstant('2026-12-14', '10:07')
    expect(toLocalTime(defaultNewStart('2026-12-14', now, 15))).toBe('10:15')
    expect(
      toLocalTime(defaultNewStart('2026-12-14', localToInstant('2026-12-14', '10:15'), 15)),
    ).toBe('10:15')
    expect(toLocalTime(defaultNewStart('2026-12-20', now, 15))).toBe('10:00')
    expect(toLocalDate(defaultNewStart('2026-12-20', now, 15))).toBe('2026-12-20')
  })
})

describe('error codes → translation keys', () => {
  it('maps rule and API codes; an unknown code falls back to errors.unknown', () => {
    expect(errorKeyFor('SLOT_TAKEN')).toBe('errors.slotTaken')
    expect(errorKeyFor('FORBIDDEN')).toBe('errors.forbidden')
    expect(errorKeyFor('NETWORK_ERROR')).toBe('errors.networkError')
    expect(errorKeyFor('SOMETHING_NEW')).toBe('errors.unknown')
    expect(errorKeyFor(null)).toBe('errors.unknown')
  })

  it('has a key for every code the CRM API and the services can return', () => {
    const codes = Object.keys({ ...RULE_ERROR_KEYS, ...API_ERROR_KEYS })
    for (const code of [
      'SLOT_TAKEN',
      'SLOT_UNAVAILABLE',
      'PROMO_NOT_FOUND',
      'DISCOUNT_FORBIDDEN',
      'STATUS_FORBIDDEN',
      'CANCEL_REASON_REQUIRED',
      'APPOINTMENT_PAID_LOCKED',
      'UNAUTHORIZED',
      'FORBIDDEN',
      'NOT_FOUND',
      'VALIDATION_ERROR',
      'PHONE_INVALID',
      'PHONE_TAKEN',
      'BARBER_NOT_FOUND',
      'LOCATION_NOT_FOUND',
    ])
      expect(codes, code).toContain(code)
  })
})
