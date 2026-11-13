/**
 * Appointment emails (spec §7, A10): the `appointments` afterChange hook queues `sendAppointmentEmail`
 * jobs (in the same transaction as the appointment, so a rolled back booking sends nothing); the job
 * renders the template in the client's language, sends it through the Payload email adapter and writes
 * `appointment-logs {action: email}`. A Resend failure fails only the job (3 retries), never the booking.
 */
import type { MongooseAdapter } from '@payloadcms/db-mongodb'
import type { CollectionAfterChangeHook, Payload, PayloadRequest } from 'payload'

import { env } from '@/env'
import { buildCancelUrl, renderEmail, type EmailData, type EmailType } from '@/emails/templates'
import { resolveEmailLanguage, type EmailLanguage } from '@/emails/language'

import { APPOINTMENT_CONTEXT, type AppointmentResult } from './appointments'
import { relationId } from './schedule'

export type SendEmailInput = {
  appointmentId: string
  type: EmailType
  /** `confirmation`: plain cancel token (only its hash is stored on the appointment). */
  cancelToken?: string | null
  /** `moved`: ISO time before the move. */
  previousStartAt?: string | null
}

export type SendEmailResult =
  | { status: 'sent'; language: EmailLanguage }
  | { status: 'skipped'; reason: 'not_found' | 'stale' | 'no_email' | 'already_sent' }

// ---------------------------------------------------------------------------
// Queueing (afterChange hook)
// ---------------------------------------------------------------------------

export const queueAppointmentEmail = async (
  req: PayloadRequest,
  input: SendEmailInput,
): Promise<void> => {
  await req.payload.jobs.queue({
    task: 'sendAppointmentEmail',
    input,
    queue: 'default',
    req,
  })
}

const timeOf = (value: unknown): number | null => {
  if (!value) return null
  const time = new Date(value as string | Date).getTime()
  return Number.isNaN(time) ? null : time
}

const clientHasEmail = async (req: PayloadRequest, clientId: string): Promise<boolean> => {
  const client = await req.payload
    .findByID({
      collection: 'clients',
      id: clientId,
      depth: 0,
      overrideAccess: true,
      select: { email: true },
      req,
    })
    .catch(() => null)
  return Boolean(client?.email)
}

/** Which email (if any) a change of an appointment calls for. */
export const emailTypeFor = (
  operation: 'create' | 'update',
  previous: Record<string, unknown> | undefined,
  next: Record<string, unknown>,
): EmailType | null => {
  if (next.kind !== 'appointment') return null
  if (operation === 'create') return next.status === 'scheduled' ? 'confirmation' : null
  if (!previous) return null
  if (previous.status === 'scheduled' && String(next.status).startsWith('cancelled_'))
    return 'cancelled'
  if (previous.status === 'scheduled' && next.status === 'scheduled') {
    const moved =
      timeOf(previous.startAt) !== timeOf(next.startAt) ||
      relationId(previous.barber as never) !== relationId(next.barber as never) ||
      relationId(previous.location as never) !== relationId(next.location as never)
    return moved ? 'moved' : null
  }
  return null
}

export const queueAppointmentEmails: CollectionAfterChangeHook = async ({
  doc,
  previousDoc,
  operation,
  req,
}) => {
  const options = (req.context[APPOINTMENT_CONTEXT.options] ?? {}) as {
    now?: Date
    skipEmail?: boolean
  }
  if (options.skipEmail || (operation !== 'create' && operation !== 'update')) return doc
  const type = emailTypeFor(operation, previousDoc, doc)
  if (!type) return doc
  // Nothing to tell about the past (import, late corrections).
  const startAt = timeOf(doc.startAt)
  if (startAt === null || startAt < (options.now ?? new Date()).getTime()) return doc
  const clientId = relationId(doc.client)
  if (!clientId || !(await clientHasEmail(req, clientId))) return doc

  // A moved appointment must be reminded again at its new time.
  if (type === 'moved') {
    await req.payload.db.updateOne({
      collection: 'appointments',
      id: doc.id,
      data: { reminderSentAt: null },
      returning: false,
      req,
    })
  }
  const result = req.context[APPOINTMENT_CONTEXT.result] as AppointmentResult | undefined
  await queueAppointmentEmail(req, {
    appointmentId: String(doc.id),
    type,
    cancelToken: type === 'confirmation' ? (result?.cancelToken ?? null) : null,
    previousStartAt:
      type === 'moved' && previousDoc?.startAt ? new Date(previousDoc.startAt).toISOString() : null,
  })
  return doc
}

// ---------------------------------------------------------------------------
// Sending (job handler)
// ---------------------------------------------------------------------------

type Named = { name?: string | null } | string | null | undefined
const nameOf = (value: Named): string =>
  value && typeof value === 'object' ? (value.name ?? '') : ''

type LoadedAppointment = {
  id: string
  kind?: string | null
  status?: string | null
  startAt: string
  total?: number | null
  language?: string | null
  reminderSentAt?: string | null
  client?: {
    id: string
    firstName?: string | null
    email?: string | null
    language?: string | null
  } | null
  service?: Named
  extras?: Named[] | null
  barber?: Named
  location?: { name?: string | null; address?: string | null; phone?: string | null } | null
}

const load = async (payload: Payload, id: string, locale?: EmailLanguage) =>
  (await payload
    .findByID({
      collection: 'appointments',
      id,
      depth: 1,
      overrideAccess: true,
      ...(locale ? { locale, fallbackLocale: 'ru' } : {}),
    })
    .catch(() => null)) as unknown as LoadedAppointment | null

const claimReminder = async (payload: Payload, id: string, at: Date): Promise<boolean> => {
  const model = (payload.db as MongooseAdapter).collections['appointments']
  const result = await model.updateOne(
    { _id: id, reminderSentAt: null },
    { $set: { reminderSentAt: at } },
  )
  return result.modifiedCount === 1
}

const releaseReminder = async (payload: Payload, id: string): Promise<void> => {
  const model = (payload.db as MongooseAdapter).collections['appointments']
  await model.updateOne({ _id: id }, { $set: { reminderSentAt: null } })
}

export const sendAppointmentEmail = async (
  payload: Payload,
  input: SendEmailInput,
  now: Date = new Date(),
): Promise<SendEmailResult> => {
  let appointment = await load(payload, input.appointmentId)
  if (!appointment || appointment.kind !== 'appointment') {
    return { status: 'skipped', reason: 'not_found' }
  }
  const client = appointment.client
  const language = resolveEmailLanguage(appointment.language, client?.language)
  if (language !== 'ru')
    appointment = (await load(payload, input.appointmentId, language)) ?? appointment

  // The appointment may have changed since the job was queued.
  const status = appointment.status ?? ''
  const stale =
    input.type === 'cancelled' ? !status.startsWith('cancelled_') : status !== 'scheduled'
  if (stale) return { status: 'skipped', reason: 'stale' }
  if (!client?.email) return { status: 'skipped', reason: 'no_email' }

  const claimed = input.type === 'reminder'
  if (claimed && !(await claimReminder(payload, input.appointmentId, now))) {
    return { status: 'skipped', reason: 'already_sent' }
  }

  try {
    const data: EmailData = {
      clientName: client.firstName,
      serviceName: nameOf(appointment.service),
      extraNames: (appointment.extras ?? []).map(nameOf).filter(Boolean),
      barberName: nameOf(appointment.barber),
      locationName: appointment.location?.name,
      locationAddress: appointment.location?.address,
      locationPhone: appointment.location?.phone,
      startAt: new Date(appointment.startAt),
      previousStartAt: input.previousStartAt ? new Date(input.previousStartAt) : null,
      total: appointment.total ?? 0,
      cancelUrl:
        input.type === 'confirmation' && input.cancelToken
          ? buildCancelUrl(env.frontendUrl, language, input.cancelToken)
          : null,
      cancelledBy: status === 'cancelled_by_client' ? 'client' : 'salon',
    }
    const email = renderEmail(input.type, data, language)
    await payload.sendEmail({ to: client.email, ...email })
  } catch (error) {
    if (claimed) await releaseReminder(payload, input.appointmentId)
    throw error
  }

  // Bookkeeping that must not make the job fail (the email is already out).
  try {
    if (input.type === 'confirmation') {
      await payload.db.updateOne({
        collection: 'appointments',
        id: input.appointmentId,
        data: { confirmationSentAt: now.toISOString() },
        returning: false,
      })
    }
    await payload.create({
      collection: 'appointment-logs',
      data: {
        appointment: input.appointmentId,
        location: relationId(appointment.location as never) ?? undefined,
        barber: relationId(appointment.barber as never) ?? undefined,
        actorType: 'system',
        action: 'email',
        changes: [{ field: 'email', from: null, to: { type: input.type, language } }],
        at: now.toISOString(),
      } as never,
      depth: 0,
      overrideAccess: true,
    })
  } catch (error) {
    payload.logger.error({ err: error, msg: 'Failed to record the sent email' })
  }
  return { status: 'sent', language }
}
