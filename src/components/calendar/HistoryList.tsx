'use client'
import { formatMoney } from '@/crm/money'
import { formatDateTime } from '@/crm/time'

import type { AppointmentDetail } from './api'
import { useLanguage } from './api'
import { useCrmT } from './useCrmT'

const MONEY_FIELDS = new Set([
  'subtotal',
  'promoDiscount',
  'manualDiscount',
  'total',
  'paidAmount',
  'certificateAmount',
  'tipAmount',
])
const DATE_FIELDS = new Set(['startAt', 'endAt', 'confirmationSentAt', 'reminderSentAt'])
const KNOWN_FIELDS = new Set([
  'kind',
  'location',
  'barber',
  'client',
  'service',
  'extras',
  'startAt',
  'endAt',
  'durationMinutes',
  'subtotal',
  'promoCode',
  'promoDiscount',
  'manualDiscount',
  'manualDiscountReason',
  'total',
  'paidAmount',
  'certificateAmount',
  'tipAmount',
  'paymentStatus',
  'status',
  'cancelReason',
  'clientComment',
  'internalNote',
  'language',
  'confirmationSentAt',
  'reminderSentAt',
])
const KNOWN_ACTIONS = new Set(['create', 'update', 'move', 'status', 'payment', 'refund', 'email'])

/** Change history of an appointment (spec §5.11): newest first, one entry per operation. */
export const HistoryList = ({ history }: { history: AppointmentDetail['history'] }) => {
  const t = useCrmT()
  const language = useLanguage()

  const value = (field: string, raw: unknown): string => {
    if (raw === null || raw === undefined || raw === '') return t('calendar.modal.none')
    if (MONEY_FIELDS.has(field) && typeof raw === 'number') return formatMoney(raw, language)
    if (DATE_FIELDS.has(field) && typeof raw === 'string') {
      const date = new Date(raw)
      if (!Number.isNaN(date.getTime())) return formatDateTime(date, language)
    }
    if (field === 'status' && typeof raw === 'string')
      return t(`calendar.status.${raw as 'scheduled'}`)
    if (field === 'paymentStatus' && typeof raw === 'string')
      return t(`calendar.paymentStatus.${raw as 'paid'}`)
    if (typeof raw === 'object') return JSON.stringify(raw)
    return String(raw)
  }

  if (history.length === 0)
    return <p className="calendar-modal__muted">{t('calendar.modal.historyEmpty')}</p>
  return (
    <ol className="calendar-history">
      {history.map((entry) => (
        <li key={entry.id} className="calendar-history__item">
          <div className="calendar-history__head">
            <strong>
              {KNOWN_ACTIONS.has(entry.action)
                ? t(`calendar.history.action.${entry.action as 'create'}`)
                : entry.action}
            </strong>
            <span className="calendar-modal__muted">
              {formatDateTime(new Date(entry.at), language)} ·{' '}
              {entry.actor ?? t(`calendar.history.actor.${entry.actorType}`)}
            </span>
          </div>
          <ul className="calendar-history__changes">
            {entry.changes.map((change) => (
              <li key={change.field}>
                {KNOWN_FIELDS.has(change.field)
                  ? t(`calendar.history.field.${change.field as 'kind'}`)
                  : change.field}
                : {value(change.field, change.from)} → {value(change.field, change.to)}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  )
}
