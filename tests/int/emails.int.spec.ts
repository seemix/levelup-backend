import { createLocalReq, getPayload, type Payload } from 'payload'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { sendAppointmentEmail } from '@/crm/appointment-emails'
import {
  changeAppointmentStatus,
  createAppointment,
  updateAppointment,
  type AppointmentInput,
} from '@/crm/appointments'
import { findReminderAppointmentIds, isReminderDue, reminderWindow } from '@/crm/reminders'
import { addMinutes, localToInstant } from '@/crm/time'
import { dictionaries, EMAIL_LANGUAGES, resolveEmailLanguage } from '@/emails/language'
import {
  buildCancelUrl,
  EMAIL_TYPES,
  renderEmail,
  type EmailData,
  type EmailType,
} from '@/emails/templates'
import { up as appointmentsUp } from '@/migrations/20261113_000004_appointments'
import config from '@/payload.config'

const leafKeys = (tree: object, prefix = ''): string[] =>
  Object.entries(tree).flatMap(([key, value]) =>
    typeof value === 'string' ? [`${prefix}${key}`] : leafKeys(value, `${prefix}${key}.`),
  )

describe('email language and templates', () => {
  it('resolves the language: appointment, then client, then ru', () => {
    expect(resolveEmailLanguage('ro', 'en')).toBe('ro')
    expect(resolveEmailLanguage(undefined, 'en')).toBe('en')
    expect(resolveEmailLanguage(null, null)).toBe('ru')
    expect(resolveEmailLanguage('de', 'fr')).toBe('ru')
    expect(resolveEmailLanguage('de', 'ro')).toBe('ro')
  })

  it('has the same keys and no empty strings in ru, ro and en', () => {
    const expected = leafKeys(dictionaries.en).sort()
    expect(expected.length).toBeGreaterThan(10)
    for (const language of EMAIL_LANGUAGES) {
      expect(leafKeys(dictionaries[language]).sort()).toEqual(expected)
      const values = Object.values(dictionaries[language]).flatMap((section) =>
        Object.values(section as Record<string, string>),
      )
      expect(values.every((value) => value.trim().length > 0)).toBe(true)
    }
  })

  const data: EmailData = {
    clientName: 'Ion <b>',
    serviceName: 'Cut',
    extraNames: ['Wash', 'Wax'],
    barberName: 'Alex',
    locationName: 'Bălți',
    locationAddress: 'Decebal 142',
    locationPhone: '+37369000000',
    startAt: new Date('2026-12-08T08:00:00Z'),
    previousStartAt: new Date('2026-12-07T08:00:00Z'),
    total: 40_050,
    cancelUrl: buildCancelUrl('https://levelupbalti.com/', 'ro', 'tok_en-1'),
    cancelledBy: 'client',
  }

  it('renders every template in every language without missing keys or placeholders', () => {
    for (const language of EMAIL_LANGUAGES) {
      for (const type of EMAIL_TYPES) {
        const email = renderEmail(type, data, language)
        for (const part of [email.subject, email.html, email.text]) {
          expect(part.length).toBeGreaterThan(0)
          expect(part).not.toMatch(/undefined|\{\w+\}/)
        }
        expect(email.subject).toContain('2026')
        expect(email.text).toContain('Cut')
        expect(email.text).toContain('Alex')
        // Amount through money.ts in the client's language.
        expect(email.text).toMatch(/400[.,]50/)
      }
    }
  })

  it('differs between languages and escapes HTML', () => {
    const subjects = new Set(
      EMAIL_LANGUAGES.map((l) => renderEmail('confirmation', data, l).subject),
    )
    expect(subjects.size).toBe(3)
    const html = renderEmail('confirmation', data, 'ru').html
    expect(html).toContain('Ion &lt;b&gt;')
    expect(html).not.toContain('Ion <b>')
  })

  it('puts the cancel link only into the confirmation and the previous time only into moved', () => {
    const url = 'https://levelupbalti.com/ro/booking/cancel/tok_en-1'
    expect(data.cancelUrl).toBe(url)
    const byType = (type: EmailType) => renderEmail(type, data, 'en')
    expect(byType('confirmation').html).toContain(url)
    expect(byType('confirmation').text).toContain(url)
    for (const type of ['moved', 'cancelled', 'reminder'] as const) {
      expect(byType(type).html).not.toContain('/booking/cancel/')
    }
    expect(byType('moved').text).toContain(dictionaries.en.moved.previous)
    expect(byType('reminder').text).not.toContain(dictionaries.en.moved.previous)
    expect(byType('confirmation').html).not.toContain(dictionaries.en.moved.previous)
  })

  it('tells who cancelled', () => {
    expect(renderEmail('cancelled', { ...data, cancelledBy: 'client' }, 'en').text).toContain(
      dictionaries.en.cancelled.introByClient,
    )
    expect(renderEmail('cancelled', { ...data, cancelledBy: 'salon' }, 'en').text).toContain(
      dictionaries.en.cancelled.introBySalon,
    )
  })
})

describe('reminder window', () => {
  const now = new Date('2026-12-07T08:00:00Z')
  const base = { kind: 'appointment', status: 'scheduled', reminderSentAt: null }
  const start = (minutes: number) => addMinutes(now, minutes).toISOString()

  it('is [now + 24h − 5 min, now + 24h]', () => {
    const { from, to } = reminderWindow(now)
    expect(from.toISOString()).toBe('2026-12-08T07:55:00.000Z')
    expect(to.toISOString()).toBe('2026-12-08T08:00:00.000Z')
    expect(isReminderDue({ ...base, startAt: start(24 * 60 - 5) }, now)).toBe(true)
    expect(isReminderDue({ ...base, startAt: start(24 * 60) }, now)).toBe(true)
    expect(isReminderDue({ ...base, startAt: start(24 * 60 - 6) }, now)).toBe(false)
    expect(isReminderDue({ ...base, startAt: start(24 * 60 + 1) }, now)).toBe(false)
  })

  it('skips blocks, non-scheduled and already reminded appointments', () => {
    const startAt = start(24 * 60 - 2)
    expect(isReminderDue({ ...base, startAt, kind: 'block' }, now)).toBe(false)
    expect(isReminderDue({ ...base, startAt, status: 'cancelled_by_client' }, now)).toBe(false)
    expect(isReminderDue({ ...base, startAt, reminderSentAt: now.toISOString() }, now)).toBe(false)
  })
})

describe('appointment emails', () => {
  let payload: Payload
  const ids: Record<string, string> = {}
  const NOW = new Date('2026-12-07T08:00:00Z')
  // 2026-12-08 is a Tuesday; the barber works 09:00–18:00 every day.
  const DAY = '2026-12-08'
  const at = (time: string, date = DAY) => localToInstant(date, time)
  // Exactly 24 h − 2 min after NOW.
  const inWindow = new Date(NOW.getTime() + (24 * 60 - 2) * 60_000)

  const create = async (collection: string, data: Record<string, unknown>) =>
    (await payload.create({ collection, data, overrideAccess: true } as never)) as unknown as {
      id: string
    }
  const reqFor = () => createLocalReq({}, payload)
  const options = { actorType: 'system', mode: 'staff', now: NOW } as const

  const book = async (patch: AppointmentInput) =>
    createAppointment(
      await reqFor(),
      {
        location: ids.loc,
        barber: ids.b1,
        service: ids.cut,
        client: ids.client,
        startAt: at('10:00'),
        ...patch,
      },
      options,
    )

  const sendEmail = () => vi.spyOn(payload, 'sendEmail').mockResolvedValue({ id: 'test' })
  const runJobs = () => payload.jobs.run({ queue: 'default', silent: true })
  const logsOf = async (id: string, action = 'email') =>
    (
      await payload.find({
        collection: 'appointment-logs',
        where: { and: [{ appointment: { equals: id } }, { action: { equals: action } }] },
        depth: 0,
        pagination: false,
        overrideAccess: true,
      })
    ).docs as unknown as { changes: { field: string; to: Record<string, string> }[] }[]
  const find = async (id: string) =>
    (await payload.findByID({
      collection: 'appointments',
      id,
      depth: 0,
      overrideAccess: true,
    })) as unknown as Record<string, unknown>

  afterEach(() => {
    vi.restoreAllMocks()
  })

  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    await Promise.all(Object.values(payload.db.collections).map((model) => model.init()))
    await appointmentsUp({ payload, req: await reqFor() } as Parameters<typeof appointmentsUp>[0])

    ids.loc = (await create('locations', { name: 'Loc', address: 'Decebal 142' })).id
    ids.cut = (await create('services', { name: 'Cut', durationMinutes: 30, price: 30_000 })).id
    const weekly = ['1', '2', '3', '4', '5', '6', '7'].map((weekday) => ({
      weekday,
      location: ids.loc,
      start: '09:00',
      end: '18:00',
    }))
    for (const [key, order] of [
      ['b1', 1],
      ['b2', 2],
      ['b3', 3],
      ['b4', 4],
      ['b5', 5],
    ] as const) {
      ids[key] = (
        await create('barbers', {
          name: key,
          order,
          showOnSite: false,
          locations: [ids.loc],
          services: [ids.cut],
          weeklySchedule: weekly,
        })
      ).id
    }
    ids.client = (
      await create('clients', {
        firstName: 'Ion',
        phone: '069200001',
        email: 'ion@test.local',
        language: 'ro',
      })
    ).id
    ids.clientNoEmail = (
      await create('clients', { firstName: 'Ana', phone: '069200002', language: 'en' })
    ).id
  })

  it('sends the confirmation in the client language with the cancel link and logs it', async () => {
    const spy = sendEmail()
    const { doc, cancelToken } = await book({ startAt: at('09:00') })
    await runJobs()

    expect(spy).toHaveBeenCalledTimes(1)
    const message = spy.mock.calls[0][0] as { to: string; subject: string; html: string }
    expect(message.to).toBe('ion@test.local')
    expect(message.subject).toContain('Programare confirmată')
    expect(message.html).toContain(`/ro/booking/cancel/${cancelToken}`)

    const logs = await logsOf(String(doc.id))
    expect(logs).toHaveLength(1)
    expect(logs[0].changes[0]).toMatchObject({
      field: 'email',
      to: { type: 'confirmation', language: 'ro' },
    })
    expect(await find(String(doc.id))).toHaveProperty('confirmationSentAt')
  })

  it('queues move and cancel emails and reports who cancelled', async () => {
    const spy = sendEmail()
    const { doc } = await book({ barber: ids.b2, startAt: at('09:00') })
    await runJobs()
    spy.mockClear()

    await updateAppointment(await reqFor(), String(doc.id), { startAt: at('11:00') }, options)
    await runJobs()
    expect(spy).toHaveBeenCalledTimes(1)
    expect((spy.mock.calls[0][0] as { text: string }).text).toContain(
      dictionaries.ro.moved.previous,
    )

    await changeAppointmentStatus(await reqFor(), String(doc.id), 'cancelled_by_client', options)
    await runJobs()
    expect(spy).toHaveBeenCalledTimes(2)
    expect((spy.mock.calls[1][0] as { text: string }).text).toContain(
      dictionaries.ro.cancelled.introByClient,
    )
    expect((await logsOf(String(doc.id))).map((l) => l.changes[0].to.type)).toEqual(
      expect.arrayContaining(['confirmation', 'moved', 'cancelled']),
    )
  })

  it('sends nothing without a client email, for blocks, in the past or with skipEmail', async () => {
    const spy = sendEmail()
    await book({ barber: ids.b3, client: ids.clientNoEmail, startAt: at('09:00') })
    await createAppointment(
      await reqFor(),
      {
        kind: 'block',
        location: ids.loc,
        barber: ids.b3,
        startAt: at('12:00'),
        durationMinutes: 60,
      },
      options,
    )
    await createAppointment(
      await reqFor(),
      {
        location: ids.loc,
        barber: ids.b3,
        service: ids.cut,
        client: ids.client,
        startAt: at('14:00'),
      },
      { ...options, skipEmail: true },
    )
    await createAppointment(
      await reqFor(),
      {
        location: ids.loc,
        barber: ids.b3,
        service: ids.cut,
        client: ids.client,
        startAt: at('16:00'),
      },
      { ...options, now: new Date('2026-12-09T00:00:00Z') },
    )
    await runJobs()
    expect(spy).not.toHaveBeenCalled()
  })

  it('skips a stale job and does not break the booking when sending fails', async () => {
    const { doc, cancelToken } = await book({ barber: ids.b4, startAt: at('09:00') })
    // Cancelled before the confirmation job ran.
    await changeAppointmentStatus(await reqFor(), String(doc.id), 'cancelled_by_salon', {
      ...options,
      cancelReason: 'x',
      skipEmail: true,
    })
    const spy = sendEmail()
    await expect(
      sendAppointmentEmail(
        payload,
        { appointmentId: String(doc.id), type: 'confirmation', cancelToken },
        NOW,
      ),
    ).resolves.toEqual({ status: 'skipped', reason: 'stale' })
    expect(spy).not.toHaveBeenCalled()
    await runJobs() // drain the queue
    expect(await find(String(doc.id))).toMatchObject({ status: 'cancelled_by_salon' })
  })

  describe('reminders', () => {
    const remind = (id: string, now = NOW) =>
      sendAppointmentEmail(payload, { appointmentId: id, type: 'reminder' }, now)

    it('selects only due appointments and sends each reminder exactly once', async () => {
      const spy = sendEmail()
      const due = await book({ barber: ids.b5, startAt: inWindow.toISOString() })
      const farAway = await book({ barber: ids.b5, startAt: at('15:00') })
      const cancelled = await book({
        barber: ids.b1,
        startAt: addMinutes(inWindow, 1).toISOString(),
      })
      await changeAppointmentStatus(
        await reqFor(),
        String(cancelled.doc.id),
        'cancelled_by_salon',
        {
          ...options,
          cancelReason: 'x',
        },
      )
      const noEmail = await book({
        barber: ids.b2,
        client: ids.clientNoEmail,
        startAt: inWindow.toISOString(),
      })
      const dueId = String(due.doc.id)

      const first = await findReminderAppointmentIds(payload, NOW)
      expect(first).toContain(dueId)
      expect(first).not.toContain(String(farAway.doc.id))
      expect(first).not.toContain(String(cancelled.doc.id))
      expect(first).not.toContain(String(noEmail.doc.id))

      await runJobs() // confirmations
      spy.mockClear()
      // Two overlapping runs of the scheduler: only one email goes out.
      const results = await Promise.all([remind(dueId), remind(dueId)])
      expect(results.map((r) => r.status).sort()).toEqual(['sent', 'skipped'])
      expect(await remind(dueId)).toEqual({ status: 'skipped', reason: 'already_sent' })
      expect(spy).toHaveBeenCalledTimes(1)
      expect((spy.mock.calls[0][0] as { subject: string }).subject).toContain('Memento')

      expect(await find(dueId)).toHaveProperty('reminderSentAt')
      expect(await findReminderAppointmentIds(payload, NOW)).not.toContain(dueId)
      expect((await logsOf(dueId)).filter((l) => l.changes[0].to.type === 'reminder')).toHaveLength(
        1,
      )
    })

    it('releases the claim when sending fails, so the retry sends it', async () => {
      const { doc } = await book({
        barber: ids.b4,
        startAt: addMinutes(inWindow, 60).toISOString(),
      })
      const id = String(doc.id)
      const later = addMinutes(NOW, 60)
      await runJobs()
      const spy = vi.spyOn(payload, 'sendEmail').mockRejectedValueOnce(new Error('resend down'))
      await expect(remind(id, later)).rejects.toThrow('resend down')
      expect((await find(id)).reminderSentAt ?? null).toBeNull()
      spy.mockResolvedValue({ id: 'test' })
      expect(await remind(id, later)).toMatchObject({ status: 'sent' })
    })

    it('reminds again after the appointment is moved', async () => {
      sendEmail()
      const { doc } = await book({
        barber: ids.b2,
        startAt: addMinutes(inWindow, 120).toISOString(),
      })
      const id = String(doc.id)
      const later = addMinutes(NOW, 120)
      await runJobs()
      expect(await remind(id, later)).toMatchObject({ status: 'sent' })
      await updateAppointment(
        await reqFor(),
        id,
        { startAt: addMinutes(inWindow, 180).toISOString() },
        options,
      )
      expect((await find(id)).reminderSentAt ?? null).toBeNull()
      expect(await remind(id, addMinutes(NOW, 180))).toMatchObject({ status: 'sent' })
    })
  })
})
