import type { TaskConfig } from 'payload'

import { sendAppointmentEmail, queueAppointmentEmail } from '@/crm/appointment-emails'
import type { SendEmailInput } from '@/crm/appointment-emails'
import { findReminderAppointmentIds } from '@/crm/reminders'
import { EMAIL_TYPES } from '@/emails/templates'

/** Every 5 minutes (spec §7); the same cron drives the queue runner (`jobs.autoRun`). */
export const REMINDERS_CRON = '*/5 * * * *'

/** One email of one appointment; 3 retries so a Resend outage does not lose it (A10). */
export const sendAppointmentEmailTask: TaskConfig<'sendAppointmentEmail'> = {
  slug: 'sendAppointmentEmail',
  retries: 3,
  inputSchema: [
    { name: 'appointmentId', type: 'text', required: true },
    { name: 'type', type: 'select', required: true, options: [...EMAIL_TYPES] },
    // Plain cancel token of a new appointment: lives in the job only until it completes (it is deleted on success).
    { name: 'cancelToken', type: 'text' },
    { name: 'previousStartAt', type: 'text' },
  ],
  outputSchema: [
    { name: 'status', type: 'text' },
    { name: 'reason', type: 'text' },
  ],
  handler: async ({ input, req }) => {
    const result = await sendAppointmentEmail(req.payload, input as SendEmailInput)
    return {
      output: { status: result.status, reason: result.status === 'skipped' ? result.reason : '' },
    }
  },
}

/** Scheduled check: queues a reminder for every appointment that starts in about 24 hours. */
export const queueAppointmentRemindersTask: TaskConfig<'queueAppointmentReminders'> = {
  slug: 'queueAppointmentReminders',
  retries: 1,
  schedule: [{ cron: REMINDERS_CRON, queue: 'default' }],
  outputSchema: [{ name: 'queued', type: 'number' }],
  handler: async ({ req }) => {
    const ids = await findReminderAppointmentIds(req.payload, new Date())
    for (const appointmentId of ids) {
      await queueAppointmentEmail(req, { appointmentId, type: 'reminder' })
    }
    return { output: { queued: ids.length } }
  },
}

export const jobTasks = [sendAppointmentEmailTask, queueAppointmentRemindersTask]
