import { describe, expect, it } from 'vitest'

import {
  checkSlot,
  computeSlots,
  pickBarber,
  resolveDuration,
  type BusyInterval,
  type Slot,
  type SlotBarber,
  type SlotInput,
  type SlotSettings,
} from '@/crm/slots'
import { addLocalDays, gridTimes, localToInstant, toLocalTime } from '@/crm/time'

// 2026-11-16 is a Monday (UTC+2). DST: 2026-03-29 03:00 -> 04:00, 2026-10-25 04:00 -> 03:00 (both Sundays).
const MON = '2026-11-16'
const SPRING = '2026-03-29'
const AUTUMN = '2026-10-25'
const LOC = 'locA'
const NOW = new Date('2026-11-14T08:00:00Z')

const at = (time: string, date = MON) => localToInstant(date, time)

const settings: SlotSettings = {
  slotStepMinutes: 15,
  minLeadMinutes: 120,
  horizonDays: 30,
  bufferMinutes: 0,
  onlineBookingEnabled: true,
}

const day = (location = LOC) => ({
  location,
  start: '09:00',
  end: '18:00',
  breaks: [{ start: '13:00', end: '14:00' }],
})

const makeBarber = (overrides: Partial<SlotBarber> = {}): SlotBarber => ({
  id: 'b1',
  order: 1,
  active: true,
  onlineBooking: true,
  providesService: true,
  durationMinutes: 30,
  schedule: {
    locations: [LOC, 'locB'],
    weeklySchedule: [
      { weekday: 1, ...day() },
      { weekday: 7, ...day() },
    ],
  },
  exceptions: [],
  busy: [],
  ...overrides,
})

const busy = (
  from: string,
  to: string,
  kind: BusyInterval['kind'] = 'appointment',
  date = MON,
): BusyInterval => ({ start: at(from, date), end: at(to, date), kind })

const input = (overrides: Partial<SlotInput> = {}): SlotInput => ({
  mode: 'online',
  date: MON,
  locationId: LOC,
  now: NOW,
  settings,
  barbers: [makeBarber()],
  ...overrides,
})

const times = (slots: Slot[]) => slots.map((slot) => slot.time)

describe('computeSlots: working time', () => {
  it('splits the day by breaks; a slot may end exactly at a break or at the end of the day', () => {
    const slots = computeSlots(input())
    expect(times(slots)).toEqual([...gridTimes('09:00', '12:45'), ...gridTimes('14:00', '17:45')])
    expect(times(slots)).toContain('12:30')
    expect(times(slots)).toContain('17:30')
    const last = slots.at(-1)!
    expect(last.barbers).toEqual([
      { barberId: 'b1', end: at('18:00'), durationMinutes: 30, warnings: [] },
    ])
    expect(last.start).toEqual(at('17:30'))
  })

  it('longer duration shrinks the last start before a break and before closing', () => {
    const slots = times(computeSlots(input({ barbers: [makeBarber({ durationMinutes: 45 })] })))
    expect(slots.filter((t) => t < '13:00').at(-1)).toBe('12:15')
    expect(slots.at(-1)).toBe('17:15')
  })

  it('a duration longer than any free interval gives no slots', () => {
    expect(computeSlots(input({ barbers: [makeBarber({ durationMinutes: 300 })] }))).toEqual([])
  })

  it('a day without a template row is a day off', () => {
    expect(computeSlots(input({ date: '2026-11-17' }))).toEqual([])
  })

  it('a day scheduled in another location gives no online slots', () => {
    expect(computeSlots(input({ locationId: 'locB' }))).toEqual([])
  })
})

describe('computeSlots: grid', () => {
  it('candidates are aligned to the 15 min grid from local midnight, not to the working start', () => {
    const barber = makeBarber({
      durationMinutes: 20,
      exceptions: [
        {
          dateFrom: MON,
          dateTo: MON,
          kind: 'custom_hours',
          location: LOC,
          start: '09:10',
          end: '10:15',
        },
      ],
    })
    // 09:10 is off-grid; 09:45 + 20 = 10:05 fits, 10:00 + 20 > 10:15.
    expect(times(computeSlots(input({ barbers: [barber] })))).toEqual(['09:15', '09:30', '09:45'])
  })

  it('20 min service: 12:30 fits before the 13:00 break, 12:45 does not', () => {
    const slots = times(computeSlots(input({ barbers: [makeBarber({ durationMinutes: 20 })] })))
    expect(slots).toContain('12:30')
    expect(slots).not.toContain('12:45')
  })

  it('respects slotStepMinutes from settings', () => {
    const slots = computeSlots(input({ settings: { ...settings, slotStepMinutes: 30 } }))
    expect(times(slots).slice(0, 3)).toEqual(['09:00', '09:30', '10:00'])
    expect(times(slots).every((t) => t.endsWith(':00') || t.endsWith(':30'))).toBe(true)
  })
})

describe('computeSlots: busy intervals and buffer', () => {
  it('a slot may end exactly when another appointment starts and start exactly when it ends', () => {
    const slots = times(
      computeSlots(input({ barbers: [makeBarber({ busy: [busy('10:00', '11:00')] })] })),
    )
    expect(slots).toContain('09:30')
    expect(slots).not.toContain('09:45')
    expect(slots).not.toContain('10:00')
    expect(slots).not.toContain('10:45')
    expect(slots).toContain('11:00')
  })

  it('blocks (kind = block) occupy time like appointments', () => {
    const slots = times(
      computeSlots(input({ barbers: [makeBarber({ busy: [busy('10:00', '11:00', 'block')] })] })),
    )
    expect(slots).not.toContain('10:00')
    expect(slots).toContain('11:00')
  })

  it('bufferMinutes extends every busy interval on both sides', () => {
    const slots = times(
      computeSlots(
        input({
          settings: { ...settings, bufferMinutes: 15 },
          barbers: [makeBarber({ busy: [busy('10:00', '11:00')] })],
        }),
      ),
    )
    expect(slots).toContain('09:15') // ends 09:45 = 10:00 - buffer
    expect(slots).not.toContain('09:30')
    expect(slots).not.toContain('11:00')
    expect(slots).toContain('11:15')
  })

  it('busy intervals from the previous evening and next morning do not leak into the day', () => {
    const barber = makeBarber({
      busy: [
        { start: at('20:00', '2026-11-15'), end: at('09:00'), kind: 'appointment' },
        { start: at('18:00'), end: at('09:00', '2026-11-17'), kind: 'block' },
      ],
    })
    const slots = times(computeSlots(input({ barbers: [barber] })))
    expect(slots[0]).toBe('09:00')
    expect(slots.at(-1)).toBe('17:30')
  })
})

describe('computeSlots: schedule exceptions', () => {
  it.each(['day_off', 'vacation', 'sick'] as const)(
    '%s covering the date closes the day',
    (kind) => {
      const barber = makeBarber({
        exceptions: [{ dateFrom: '2026-11-10', dateTo: '2026-11-20', kind }],
      })
      expect(computeSlots(input({ barbers: [barber] }))).toEqual([])
    },
  )

  it('custom_hours replace the template, with their own breaks', () => {
    const barber = makeBarber({
      exceptions: [
        {
          dateFrom: MON,
          dateTo: MON,
          kind: 'custom_hours',
          location: LOC,
          start: '12:00',
          end: '15:00',
          breaks: [{ start: '13:30', end: '14:00' }],
        },
      ],
    })
    expect(times(computeSlots(input({ barbers: [barber] })))).toEqual([
      '12:00',
      '12:15',
      '12:30',
      '12:45',
      '13:00',
      '14:00',
      '14:15',
      '14:30',
    ])
  })

  it('custom_hours in another location give no slots in the requested one', () => {
    const barber = makeBarber({
      exceptions: [
        {
          dateFrom: MON,
          dateTo: MON,
          kind: 'custom_hours',
          location: 'locB',
          start: '09:00',
          end: '18:00',
        },
      ],
    })
    expect(computeSlots(input({ barbers: [barber] }))).toEqual([])
    expect(computeSlots(input({ barbers: [barber], locationId: 'locB' }))).toHaveLength(35)
  })

  it('an exception that does not cover the date is ignored', () => {
    const barber = makeBarber({
      exceptions: [{ dateFrom: '2026-11-17', dateTo: '2026-11-18', kind: 'vacation' }],
    })
    expect(computeSlots(input({ barbers: [barber] }))).toHaveLength(30)
  })
})

describe('computeSlots: online filters', () => {
  it('minLeadMinutes: the first slot is at or after now + lead', () => {
    const slots = times(computeSlots(input({ now: at('09:40') })))
    expect(slots[0]).toBe('11:45')
    // Exactly now + lead is allowed.
    expect(times(computeSlots(input({ now: at('09:45') })))[0]).toBe('11:45')
  })

  it('horizon: today + horizonDays is the last bookable date; past dates have no slots', () => {
    const now = at('08:00', '2026-10-19') // Monday
    const last = addLocalDays('2026-10-19', 28) // 2026-11-16, Monday
    expect(
      computeSlots(input({ now, date: last, settings: { ...settings, horizonDays: 28 } })),
    ).not.toEqual([])
    expect(
      computeSlots(input({ now, date: last, settings: { ...settings, horizonDays: 27 } })),
    ).toEqual([])
    expect(computeSlots(input({ now: at('08:00', '2026-11-23'), date: MON }))).toEqual([])
  })

  it.each([
    ['inactive barber', { barbers: [makeBarber({ active: false })] }],
    ['barber without online booking', { barbers: [makeBarber({ onlineBooking: false })] }],
    ['barber does not provide the service', { barbers: [makeBarber({ providesService: false })] }],
    ['blocked client', { clientBlocked: true }],
    ['online booking disabled', { settings: { ...settings, onlineBookingEnabled: false } }],
  ] as const)('%s → no online slots, staff mode still works', (_, overrides) => {
    expect(computeSlots(input(overrides))).toEqual([])
    expect(computeSlots(input({ ...overrides, mode: 'staff' }))).not.toEqual([])
  })
})

describe('computeSlots: "any barber" mode', () => {
  const b1 = makeBarber({ id: 'b1', order: 2, durationMinutes: 30 })
  const b2 = makeBarber({
    id: 'b2',
    order: 1,
    durationMinutes: 60,
    schedule: {
      locations: [LOC],
      weeklySchedule: [{ weekday: 1, location: LOC, start: '11:00', end: '12:00' }],
    },
  })

  it('returns the union of slots with each barber own duration', () => {
    const slots = computeSlots(input({ barbers: [b1, b2] }))
    expect(times(slots)).toEqual(times(computeSlots(input({ barbers: [b1] }))))
    const eleven = slots.find((s) => s.time === '11:00')!
    expect(eleven.barbers).toEqual([
      { barberId: 'b2', end: at('12:00'), durationMinutes: 60, warnings: [] },
      { barberId: 'b1', end: at('11:30'), durationMinutes: 30, warnings: [] },
    ])
    // 60 min from 11:15 no longer fits b2's 11:00–12:00.
    expect(slots.find((s) => s.time === '11:15')!.barbers.map((b) => b.barberId)).toEqual(['b1'])
  })

  it('skips barbers that are not eligible online and keeps the others', () => {
    const slots = computeSlots(input({ barbers: [b1, { ...b2, onlineBooking: false }] }))
    expect(slots.every((s) => s.barbers.every((b) => b.barberId === 'b1'))).toBe(true)
  })

  it('auto-pick: fewest appointments that day, then lower order, then id', () => {
    const base = { durationMinutes: 30 }
    const x = makeBarber({ ...base, id: 'x', order: 5, busy: [busy('09:00', '09:30')] })
    const y = makeBarber({
      ...base,
      id: 'y',
      order: 3,
      busy: [busy('09:00', '09:30'), busy('17:00', '17:30')],
    })
    const z = makeBarber({ ...base, id: 'z', order: 4, busy: [busy('16:00', '16:30', 'block')] })
    const start = at('10:00')
    // z has no appointments (blocks are not counted).
    expect(pickBarber(input({ barbers: [x, y, z] }), start)).toBe('z')
    // Busy at the start → skipped.
    expect(
      pickBarber(input({ barbers: [x, y, { ...z, busy: [busy('10:00', '10:30')] }] }), start),
    ).toBe('x')
    // Equal count → lower order wins.
    const w = makeBarber({ ...base, id: 'w', order: 1, busy: [busy('11:00', '11:30')] })
    expect(pickBarber(input({ barbers: [x, w] }), start)).toBe('w')
    // Equal count and order → lower id; missing order goes last.
    const a = makeBarber({ ...base, id: 'a', order: 5, busy: [busy('11:00', '11:30')] })
    expect(pickBarber(input({ barbers: [x, a] }), start)).toBe('a')
    expect(pickBarber(input({ barbers: [{ ...w, order: null }, x] }), start)).toBe('x')
    // Same answer whatever the input order.
    expect(pickBarber(input({ barbers: [z, y, x] }), start)).toBe('z')
    // Slot list puts the auto-pick first.
    expect(
      computeSlots(input({ barbers: [x, y, z] })).find((s) => s.time === '10:00')!.barbers[0]
        .barberId,
    ).toBe('z')
  })

  it('auto-pick counts only appointments of the requested local day', () => {
    const x = makeBarber({
      id: 'x',
      order: 1,
      busy: [busy('10:00', '10:30', 'appointment', '2026-11-15')],
    })
    const y = makeBarber({ id: 'y', order: 2, busy: [busy('17:00', '17:30')] })
    expect(pickBarber(input({ barbers: [x, y] }), at('10:00'))).toBe('x')
  })

  it('auto-pick returns null when nobody is free', () => {
    expect(
      pickBarber(input({ barbers: [makeBarber({ busy: [busy('09:00', '18:00')] })] }), at('10:00')),
    ).toBe(null)
    expect(pickBarber(input(), at('13:00'))).toBe(null)
  })
})

describe('computeSlots: staff mode', () => {
  const staff = (overrides: Partial<SlotInput> = {}) => input({ mode: 'staff', ...overrides })

  it('offers the whole local day; outside working time a slot carries OUTSIDE_SCHEDULE', () => {
    const slots = computeSlots(staff())
    // 96 grid points, the last one (23:45 + 30 min) crosses midnight.
    expect(slots).toHaveLength(95)
    expect(slots[0].time).toBe('00:00')
    expect(slots.at(-1)!.time).toBe('23:30')
    expect(slots.at(-1)!.barbers[0].end).toEqual(at('00:00', '2026-11-17'))
    const warn = (time: string) => slots.find((s) => s.time === time)!.barbers[0].warnings
    expect(warn('08:45')).toEqual(['OUTSIDE_SCHEDULE'])
    expect(warn('09:00')).toEqual([])
    expect(warn('12:30')).toEqual([])
    expect(warn('12:45')).toEqual(['OUTSIDE_SCHEDULE']) // runs into the break
    expect(warn('17:30')).toEqual([])
    expect(warn('17:45')).toEqual(['OUTSIDE_SCHEDULE'])
  })

  it('ignores lead time, horizon and day off, but never allows an overlap', () => {
    const barber = makeBarber({
      busy: [busy('10:00', '11:00')],
      exceptions: [{ dateFrom: MON, dateTo: MON, kind: 'sick' }],
    })
    const slots = computeSlots(staff({ now: at('15:00'), barbers: [barber] }))
    const list = times(slots)
    expect(list).toContain('08:00')
    expect(list).toContain('09:30')
    expect(list).not.toContain('09:45')
    expect(list).not.toContain('10:30')
    expect(list).toContain('11:00')
    expect(slots.every((s) => s.barbers[0].warnings.includes('OUTSIDE_SCHEDULE'))).toBe(true)
    expect(computeSlots(staff({ now: at('08:00', '2027-06-01') }))).toHaveLength(95)
  })

  it('a working day in another location is outside schedule for this location', () => {
    const slots = computeSlots(staff({ locationId: 'locB' }))
    expect(slots.find((s) => s.time === '10:00')!.barbers[0].warnings).toEqual(['OUTSIDE_SCHEDULE'])
  })
})

describe('checkSlot', () => {
  it('online: valid start returns the end and duration', () => {
    expect(checkSlot(input(), 'b1', at('10:00'))).toEqual({
      ok: true,
      barberId: 'b1',
      start: at('10:00'),
      end: at('10:30'),
      durationMinutes: 30,
      warnings: [],
    })
  })

  it('online: overlap → SLOT_TAKEN, off-grid / outside schedule / too soon / unknown barber → SLOT_UNAVAILABLE', () => {
    const taken = input({ barbers: [makeBarber({ busy: [busy('10:15', '10:45')] })] })
    expect(checkSlot(taken, 'b1', at('10:00'))).toEqual({ ok: false, code: 'SLOT_TAKEN' })
    expect(checkSlot(input(), 'b1', at('10:05'))).toEqual({ ok: false, code: 'SLOT_UNAVAILABLE' })
    expect(checkSlot(input(), 'b1', at('12:45'))).toEqual({ ok: false, code: 'SLOT_UNAVAILABLE' })
    expect(checkSlot(input({ now: at('09:00') }), 'b1', at('10:45'))).toEqual({
      ok: false,
      code: 'SLOT_UNAVAILABLE',
    })
    expect(checkSlot(input(), 'nobody', at('10:00'))).toEqual({
      ok: false,
      code: 'SLOT_UNAVAILABLE',
    })
  })

  it('staff: outside schedule is allowed with a warning, overlap never; off-grid start is allowed', () => {
    const staff = input({
      mode: 'staff',
      barbers: [makeBarber({ busy: [busy('10:15', '10:45')] })],
    })
    expect(checkSlot(staff, 'b1', at('07:00'))).toMatchObject({
      ok: true,
      warnings: ['OUTSIDE_SCHEDULE'],
    })
    expect(checkSlot(staff, 'b1', at('10:00'))).toEqual({ ok: false, code: 'SLOT_TAKEN' })
    expect(checkSlot(staff, 'b1', at('10:45'))).toMatchObject({ ok: true, warnings: [] })
    expect(checkSlot(staff, 'b1', at('11:05'))).toMatchObject({ ok: true, end: at('11:35') })
    // Must end by the end of the local day.
    expect(checkSlot(staff, 'b1', at('23:45'))).toEqual({ ok: false, code: 'SLOT_UNAVAILABLE' })
    expect(checkSlot(staff, 'b1', at('23:30'))).toMatchObject({ ok: true })
  })

  it('throws when the start is not on the input date', () => {
    expect(() => checkSlot(input(), 'b1', at('10:00', '2026-11-17'))).toThrow(RangeError)
  })
})

describe('computeSlots: DST', () => {
  it('spring forward (2026-03-29): daytime slots keep local times, UTC offset is +3', () => {
    const slots = computeSlots(input({ date: SPRING, now: new Date('2026-03-20T08:00:00Z') }))
    expect(times(slots)).toEqual(times(computeSlots(input())))
    expect(slots[0].start.toISOString()).toBe('2026-03-29T06:00:00.000Z')
  })

  it('spring forward: night shift skips the missing hour and lasts real minutes', () => {
    const barber = makeBarber({
      durationMinutes: 60,
      exceptions: [
        {
          dateFrom: SPRING,
          dateTo: SPRING,
          kind: 'custom_hours',
          location: LOC,
          start: '00:00',
          end: '06:00',
        },
      ],
    })
    const slots = computeSlots(
      input({ date: SPRING, now: new Date('2026-03-20T08:00:00Z'), barbers: [barber] }),
    )
    // 00:00–06:00 local is 5 real hours; 03:xx does not exist.
    expect(times(slots)).toEqual([...gridTimes('00:00', '03:00'), ...gridTimes('04:00', '05:15')])
    const s = slots.find((x) => x.time === '02:30')!
    expect(toLocalTime(s.barbers[0].end)).toBe('04:30')
  })

  it('spring forward: staff grid has 92 points (23 h day)', () => {
    const slots = computeSlots(
      input({ mode: 'staff', date: SPRING, barbers: [makeBarber({ durationMinutes: 15 })] }),
    )
    expect(slots).toHaveLength(92)
    expect(times(slots).some((t) => t.startsWith('03:'))).toBe(false)
  })

  it('fall back (2026-10-25): daytime slots keep local times, UTC offset is +2', () => {
    const slots = computeSlots(input({ date: AUTUMN, now: new Date('2026-10-20T08:00:00Z') }))
    expect(times(slots)).toEqual(times(computeSlots(input())))
    expect(slots[0].start.toISOString()).toBe('2026-10-25T07:00:00.000Z')
  })

  it('fall back: the repeated hour gives two distinct slots per grid time (25 h day)', () => {
    const slots = computeSlots(
      input({ mode: 'staff', date: AUTUMN, barbers: [makeBarber({ durationMinutes: 15 })] }),
    )
    expect(slots).toHaveLength(100)
    const three = slots.filter((s) => s.time === '03:00')
    expect(three.map((s) => s.start.toISOString())).toEqual([
      '2026-10-25T00:00:00.000Z',
      '2026-10-25T01:00:00.000Z',
    ])
  })

  it('fall back: a busy interval in the first 03:00 hour does not block the second one', () => {
    const barber = makeBarber({
      busy: [
        {
          start: new Date('2026-10-25T00:00:00Z'),
          end: new Date('2026-10-25T01:00:00Z'),
          kind: 'block',
        },
      ],
    })
    const slots = computeSlots(input({ mode: 'staff', date: AUTUMN, barbers: [barber] }))
    const three = slots.filter((s) => s.time === '03:00')
    expect(three.map((s) => s.start.toISOString())).toEqual(['2026-10-25T01:00:00.000Z'])
  })
})

describe('resolveDuration', () => {
  const service = { id: 's1', durationMinutes: 30 }
  const extras = [
    { id: 'e1', durationMinutes: 10 },
    { id: 'e2', durationMinutes: 0 },
  ]

  it('sums base durations of the service and extras', () => {
    expect(resolveDuration(service, extras, [])).toBe(40)
    expect(resolveDuration(service, [], [])).toBe(30)
  })

  it('applies barber overrides per item; an empty override keeps the base value', () => {
    expect(
      resolveDuration(service, extras, [
        { itemType: 'services', itemId: 's1', durationMinutes: 45 },
        { itemType: 'extras', itemId: 'e2', durationMinutes: 15 },
        { itemType: 'extras', itemId: 'e1', durationMinutes: null },
        // Same id in the other collection is not this item.
        { itemType: 'extras', itemId: 's1', durationMinutes: 999 },
      ]),
    ).toBe(70)
  })
})
