'use client'
import { formatMoney } from '@/crm/money'
import type { CrmWarning } from '@/endpoints/crm/http'

import { useLanguage } from './api'
import { useCrmT } from './useCrmT'

type Props = {
  warnings: CrmWarning[]
  total: { from: number; to: number } | null
  busy: boolean
  onConfirm: () => void
  onBack: () => void
}

/** Warnings of the server that need `confirm = true` (spec A29): the action is repeated on "Confirm". */
export const WarningsPanel = ({ warnings, total, busy, onConfirm, onBack }: Props) => {
  const t = useCrmT()
  const language = useLanguage()
  return (
    <div className="calendar-warnings" role="alertdialog" aria-label={t('calendar.warnings.title')}>
      <strong>{t('calendar.warnings.title')}</strong>
      <ul>
        {warnings.map((warning) => (
          <li key={warning}>{t(`calendar.warnings.${warning}`)}</li>
        ))}
      </ul>
      {total && (
        <p>
          {t('calendar.warnings.totalChange', {
            from: formatMoney(total.from, language),
            to: formatMoney(total.to, language),
          })}
        </p>
      )}
      <p className="calendar-warnings__hint">{t('calendar.warnings.hint')}</p>
      <div className="calendar-modal__actions">
        <button type="button" className="calendar__button" disabled={busy} onClick={onBack}>
          {t('calendar.actions.back')}
        </button>
        <button
          type="button"
          className="calendar__button calendar__button--dark"
          disabled={busy}
          onClick={onConfirm}
        >
          {busy ? t('calendar.actions.working') : t('calendar.warnings.confirm')}
        </button>
      </div>
    </div>
  )
}
