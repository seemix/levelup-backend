/**
 * Plain HTML email templates (spec §7). No React Email: strings from the `ru/ro/en` dictionaries,
 * dates through `time.ts`, amounts through `money.ts`.
 */
import { formatMoney } from '@/crm/money'
import { formatDateTime } from '@/crm/time'

import { dictionaries, type EmailLanguage } from './language'

export const EMAIL_TYPES = ['confirmation', 'moved', 'cancelled', 'reminder'] as const
export type EmailType = (typeof EMAIL_TYPES)[number]

export type EmailData = {
  clientName?: string | null
  serviceName: string
  extraNames?: string[]
  barberName: string
  locationName?: string | null
  locationAddress?: string | null
  locationPhone?: string | null
  startAt: Date
  /** `moved`: the time before the move. */
  previousStartAt?: Date | null
  /** In bani. */
  total: number
  /** `confirmation`: full cancel link. */
  cancelUrl?: string | null
  /** `cancelled`: who cancelled. */
  cancelledBy?: 'client' | 'salon' | null
}

export type RenderedEmail = { subject: string; html: string; text: string }

const interpolate = (template: string, values: Record<string, string>): string =>
  template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? '')

export const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

type Row = { label: string; value: string }

export const renderEmail = (
  type: EmailType,
  data: EmailData,
  language: EmailLanguage,
): RenderedEmail => {
  const dict = dictionaries[language]
  const dateTime = formatDateTime(data.startAt, language)
  const subject = interpolate(dict[type].subject, { dateTime })

  const greeting = data.clientName
    ? interpolate(dict.common.greeting, { name: data.clientName })
    : dict.common.greetingNoName

  const intro =
    type === 'cancelled'
      ? data.cancelledBy === 'client'
        ? dict.cancelled.introByClient
        : dict.cancelled.introBySalon
      : dict[type].intro

  const rows: Row[] = [
    { label: dict.common.service, value: data.serviceName },
    ...(data.extraNames && data.extraNames.length > 0
      ? [{ label: dict.common.extras, value: data.extraNames.join(', ') }]
      : []),
    { label: dict.common.barber, value: data.barberName },
    { label: dict.common.dateTime, value: dateTime },
    ...(type === 'moved' && data.previousStartAt
      ? [{ label: dict.moved.previous, value: formatDateTime(data.previousStartAt, language) }]
      : []),
    ...(data.locationName || data.locationAddress
      ? [
          {
            label: dict.common.location,
            value: [data.locationName, data.locationAddress].filter(Boolean).join(', '),
          },
        ]
      : []),
    ...(data.locationPhone ? [{ label: dict.common.phone, value: data.locationPhone }] : []),
    { label: dict.common.total, value: formatMoney(data.total, language) },
  ]

  const cancelUrl = type === 'confirmation' ? (data.cancelUrl ?? null) : null
  const hint =
    type === 'confirmation'
      ? cancelUrl
        ? dict.confirmation.cancelHint
        : null
      : type === 'cancelled'
        ? dict.cancelled.rebook
        : dict[type].cancelHint

  const htmlRows = rows
    .map(
      (row) =>
        `<tr><td style="padding:6px 12px 6px 0;color:#666">${escapeHtml(row.label)}</td>` +
        `<td style="padding:6px 0"><strong>${escapeHtml(row.value)}</strong></td></tr>`,
    )
    .join('')
  const html =
    `<!doctype html><html lang="${language}"><body style="margin:0;padding:24px;background:#f4f4f4;font-family:Arial,Helvetica,sans-serif;color:#111">` +
    `<div style="max-width:520px;margin:0 auto;background:#fff;padding:24px;border-radius:8px">` +
    `<p style="margin:0 0 12px">${escapeHtml(greeting)}</p>` +
    `<p style="margin:0 0 16px">${escapeHtml(intro)}</p>` +
    `<table style="border-collapse:collapse;margin:0 0 16px">${htmlRows}</table>` +
    (hint ? `<p style="margin:0 0 12px">${escapeHtml(hint)}</p>` : '') +
    (cancelUrl
      ? `<p style="margin:0 0 16px"><a href="${escapeHtml(cancelUrl)}" style="display:inline-block;padding:10px 18px;background:#111;color:#fff;text-decoration:none;border-radius:4px">${escapeHtml(dict.confirmation.cancelButton)}</a></p>`
      : '') +
    `<p style="margin:16px 0 0;color:#666">${escapeHtml(dict.common.signature)}</p>` +
    `</div></body></html>`

  const text = [
    greeting,
    '',
    intro,
    '',
    ...rows.map((row) => `${row.label}: ${row.value}`),
    ...(hint ? ['', hint] : []),
    ...(cancelUrl ? [cancelUrl] : []),
    '',
    dict.common.signature,
  ].join('\n')

  return { subject, html, text }
}

/** `${FRONTEND_URL}/{lang}/booking/cancel/{token}` (spec §5.10). */
export const buildCancelUrl = (
  frontendUrl: string,
  language: EmailLanguage,
  token: string,
): string =>
  `${frontendUrl.replace(/\/+$/, '')}/${language}/booking/cancel/${encodeURIComponent(token)}`
