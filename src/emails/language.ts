import { en } from './i18n/en'
import { ro } from './i18n/ro'
import { ru } from './i18n/ru'
import type { EmailTranslations } from './i18n/types'

export const EMAIL_LANGUAGES = ['ru', 'ro', 'en'] as const
export type EmailLanguage = (typeof EMAIL_LANGUAGES)[number]
export const DEFAULT_EMAIL_LANGUAGE: EmailLanguage = 'ru'

export const dictionaries: Record<EmailLanguage, EmailTranslations> = { ru, ro, en }

export const isEmailLanguage = (value: unknown): value is EmailLanguage =>
  EMAIL_LANGUAGES.includes(value as EmailLanguage)

/**
 * Language of an email (spec §7, `clients.language`): the appointment's own language (copied from the
 * client when it was booked), then the client's language, then `ru`. Unknown values are ignored.
 */
export const resolveEmailLanguage = (
  appointmentLanguage?: unknown,
  clientLanguage?: unknown,
): EmailLanguage => {
  if (isEmailLanguage(appointmentLanguage)) return appointmentLanguage
  if (isEmailLanguage(clientLanguage)) return clientLanguage
  return DEFAULT_EMAIL_LANGUAGE
}
