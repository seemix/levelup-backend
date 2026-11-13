import type { EmailAdapter } from 'payload'

/**
 * Used when `RESEND_API_KEY` is not set (dev, tests): the email is written to the log
 * instead of being sent. Same contract as a real adapter, so jobs behave identically.
 */
export const consoleEmailAdapter =
  (defaults: { defaultFromAddress: string; defaultFromName: string }): EmailAdapter =>
  ({ payload }) => ({
    name: 'console',
    ...defaults,
    sendEmail: async (message) => {
      payload.logger.info({
        msg: 'Email (RESEND_API_KEY is not set, not sent)',
        to: message.to,
        subject: message.subject,
        text: message.text,
      })
      return { id: 'console' }
    },
  })
