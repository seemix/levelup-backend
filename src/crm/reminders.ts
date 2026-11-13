/**
 * Reminder selection (spec §7): `scheduled` appointments with `startAt ∈ [now + 24h − 5 min, now + 24h]`
 * and `reminderSentAt = null`, whose client has an email. The scheduled job runs every 5 minutes, so every
 * appointment falls into exactly one window (the closed boundary may hit two runs: the atomic claim in
 * `sendAppointmentEmail` guarantees a single email).
 */
import type { Payload, PayloadRequest } from 'payload'

import { addMinutes } from './time'

export const REMINDER_LEAD_MINUTES = 24 * 60
export const REMINDER_WINDOW_MINUTES = 5

export const reminderWindow = (now: Date): { from: Date; to: Date } => ({
  from: addMinutes(now, REMINDER_LEAD_MINUTES - REMINDER_WINDOW_MINUTES),
  to: addMinutes(now, REMINDER_LEAD_MINUTES),
})

type ReminderCandidate = {
  kind?: string | null
  status?: string | null
  startAt?: string | Date | null
  reminderSentAt?: string | Date | null
}

/** Pure form of the selection query (used by the tests and as the contract of the query below). */
export const isReminderDue = (appointment: ReminderCandidate, now: Date): boolean => {
  if (appointment.kind !== 'appointment' || appointment.status !== 'scheduled') return false
  if (appointment.reminderSentAt) return false
  if (!appointment.startAt) return false
  const startAt = new Date(appointment.startAt)
  const { from, to } = reminderWindow(now)
  return startAt >= from && startAt <= to
}

/** Ids of the appointments to remind now (client with an email only). */
export const findReminderAppointmentIds = async (
  payload: Payload,
  now: Date,
  req?: PayloadRequest,
): Promise<string[]> => {
  const { from, to } = reminderWindow(now)
  const { docs } = await payload.find({
    collection: 'appointments',
    where: {
      and: [
        { kind: { equals: 'appointment' } },
        { status: { equals: 'scheduled' } },
        { startAt: { greater_than_equal: from.toISOString() } },
        { startAt: { less_than_equal: to.toISOString() } },
        { reminderSentAt: { exists: false } },
        { client: { exists: true } },
      ],
    },
    depth: 0,
    limit: 0,
    pagination: false,
    overrideAccess: true,
    select: { client: true },
    ...(req ? { req } : {}),
  })
  const clientIds = [
    ...new Set(
      docs
        .map((doc) => (typeof doc.client === 'object' && doc.client ? doc.client.id : doc.client))
        .filter((id): id is string => typeof id === 'string'),
    ),
  ]
  if (clientIds.length === 0) return []
  const clients = await payload.find({
    collection: 'clients',
    where: { and: [{ id: { in: clientIds } }, { email: { exists: true } }] },
    depth: 0,
    limit: 0,
    pagination: false,
    overrideAccess: true,
    select: { email: true },
    ...(req ? { req } : {}),
  })
  const withEmail = new Set(clients.docs.filter((client) => client.email).map((c) => String(c.id)))
  return docs
    .filter((doc) => {
      const id = typeof doc.client === 'object' && doc.client ? doc.client.id : doc.client
      return withEmail.has(String(id))
    })
    .map((doc) => String(doc.id))
}
