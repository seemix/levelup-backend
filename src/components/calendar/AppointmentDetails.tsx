'use client'
import { useState } from 'react'

import { appointmentActions } from '@/crm/appointment-form'
import { formatMoney } from '@/crm/money'
import { formatDateTime } from '@/crm/time'

import { CrmApiError, useCrmApi, useErrorText, useLanguage, type AppointmentDetail } from './api'
import { HistoryList } from './HistoryList'
import { useCrmT } from './useCrmT'
import { WarningsPanel } from './WarningsPanel'
import type { CrmWarning } from '@/endpoints/crm/http'

type Props = {
  detail: AppointmentDetail
  barberName: string
  onEdit: () => void
  /** The status changed on the server: reload the calendar and the details. */
  onChanged: () => void
}

type Pending = {
  status: string
  reason: string | null
  confirmation: { warnings: CrmWarning[]; total: null }
}

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="calendar-modal__row">
    <dt>{label}</dt>
    <dd>{children}</dd>
  </div>
)

/** Details of one appointment: price by lines, notes, history, and the actions allowed for the role. */
export const AppointmentDetails = ({ detail, barberName, onEdit, onChanged }: Props) => {
  const t = useCrmT()
  const api = useCrmApi()
  const language = useLanguage()
  const errorText = useErrorText()
  const { appointment: a } = detail
  const [cancelling, setCancelling] = useState(false)
  const [cancelBy, setCancelBy] = useState<'cancelled_by_client' | 'cancelled_by_salon'>(
    'cancelled_by_salon',
  )
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)

  const isBlock = a.kind === 'block'
  const actions = appointmentActions({
    kind: a.kind,
    status: a.status,
    startAt: new Date(a.start),
    now: new Date(),
    can: detail.can,
  })
  const money = (bani: number) => formatMoney(bani, language)
  const clientName = a.client
    ? [a.client.firstName, a.client.lastName].filter(Boolean).join(' ') || t('calendar.noName')
    : t('calendar.noName')

  const sendStatus = async (status: string, reasonText: string | null, confirm: boolean) => {
    setBusy(true)
    setError(null)
    try {
      await api(`/crm/appointments/${a.id}/status`, {
        method: 'POST',
        body: {
          status,
          ...(reasonText ? { reason: reasonText } : {}),
          ...(confirm ? { confirm: true } : {}),
        },
      })
      setPending(null)
      onChanged()
    } catch (caught) {
      const confirmation = caught instanceof CrmApiError ? caught.confirmation : null
      if (confirmation)
        setPending({ status, reason: reasonText, confirmation: { ...confirmation, total: null } })
      else {
        setPending(null)
        setError(errorText(caught))
      }
    } finally {
      setBusy(false)
    }
  }

  const submitCancel = () => sendStatus(cancelBy, reason.trim() || null, false)

  if (pending)
    return (
      <WarningsPanel
        warnings={pending.confirmation.warnings}
        total={null}
        busy={busy}
        onBack={() => setPending(null)}
        onConfirm={() => sendStatus(pending.status, pending.reason, true)}
      />
    )

  return (
    <div className="calendar-modal__details">
      <dl className="calendar-modal__list">
        <Row label={t('calendar.modal.status')}>
          {t(`calendar.status.${a.status as 'scheduled'}`)}
          {!isBlock && a.paymentStatus !== 'unpaid' && (
            <span className="calendar-modal__muted">
              {' · '}
              {t(`calendar.paymentStatus.${a.paymentStatus as 'paid'}`)}
            </span>
          )}
        </Row>
        <Row label={t('calendar.modal.when')}>
          {formatDateTime(new Date(a.start), language)}
          {' · '}
          {t('calendar.modal.minutes', { count: a.durationMinutes })}
        </Row>
        <Row label={t('calendar.modal.barber')}>{barberName}</Row>
        {!isBlock && (
          <>
            <Row label={t('calendar.modal.client')}>
              {clientName}
              {a.client?.phone && (
                <>
                  {' · '}
                  <a href={`tel:${a.client.phone}`}>{a.client.phone}</a>
                </>
              )}
            </Row>
            <Row label={t('calendar.modal.source')}>
              {a.source ? t(`calendar.source.${a.source as 'online'}`) : t('calendar.modal.none')}
            </Row>
          </>
        )}
        {a.cancelReason && <Row label={t('calendar.modal.cancelReason')}>{a.cancelReason}</Row>}
        {a.clientComment && <Row label={t('calendar.modal.clientComment')}>{a.clientComment}</Row>}
        {a.internalNote && <Row label={t('calendar.modal.internalNote')}>{a.internalNote}</Row>}
      </dl>

      {!isBlock && (
        <section className="calendar-modal__section">
          <h3>{t('calendar.modal.price')}</h3>
          <table className="calendar-modal__price">
            <tbody>
              {detail.lines.map((line) => (
                <tr key={`${line.itemType}-${line.item}`}>
                  <td>{line.name || t('calendar.modal.none')}</td>
                  <td>{t('calendar.modal.minutes', { count: line.durationMinutes })}</td>
                  <td>{money(line.price)}</td>
                </tr>
              ))}
              {(a.promoDiscount > 0 || a.manualDiscount > 0) && (
                <tr>
                  <td colSpan={2}>{t('calendar.modal.subtotal')}</td>
                  <td>{money(a.subtotal)}</td>
                </tr>
              )}
              {a.promoDiscount > 0 && (
                <tr>
                  <td colSpan={2}>
                    {t('calendar.modal.promoDiscount', { code: detail.promoCode ?? '' })}
                  </td>
                  <td>−{money(a.promoDiscount)}</td>
                </tr>
              )}
              {a.manualDiscount > 0 && (
                <tr>
                  <td colSpan={2}>
                    {t('calendar.modal.manualDiscount')}
                    {a.manualDiscountReason && (
                      <span className="calendar-modal__muted"> ({a.manualDiscountReason})</span>
                    )}
                  </td>
                  <td>−{money(a.manualDiscount)}</td>
                </tr>
              )}
              <tr className="calendar-modal__total">
                <td colSpan={2}>{t('calendar.modal.total')}</td>
                <td>{money(a.total)}</td>
              </tr>
              {a.paidAmount > 0 && (
                <tr>
                  <td colSpan={2}>{t('calendar.modal.paid')}</td>
                  <td>{money(a.paidAmount)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      )}

      {error && (
        <p className="calendar-modal__error" role="alert">
          {error}
        </p>
      )}

      {cancelling ? (
        <section className="calendar-modal__section">
          {!isBlock && (
            <label className="calendar-modal__field">
              <span>{t('calendar.actions.cancelBy')}</span>
              <select
                value={cancelBy}
                onChange={(event) => setCancelBy(event.target.value as typeof cancelBy)}
              >
                <option value="cancelled_by_salon">{t('calendar.actions.cancelBySalon')}</option>
                <option value="cancelled_by_client">{t('calendar.actions.cancelByClient')}</option>
              </select>
            </label>
          )}
          {!isBlock && (
            <label className="calendar-modal__field">
              <span>{t('calendar.modal.cancelReason')}</span>
              <input
                type="text"
                value={reason}
                maxLength={500}
                onChange={(event) => setReason(event.target.value)}
              />
            </label>
          )}
          <div className="calendar-modal__actions">
            <button
              type="button"
              className="calendar__button"
              disabled={busy}
              onClick={() => setCancelling(false)}
            >
              {t('calendar.actions.back')}
            </button>
            <button
              type="button"
              className="calendar__button calendar__button--danger"
              disabled={busy}
              onClick={submitCancel}
            >
              {busy ? t('calendar.actions.working') : t('calendar.actions.confirmCancel')}
            </button>
          </div>
        </section>
      ) : (
        <div className="calendar-modal__actions">
          {actions.edit && (
            <button type="button" className="calendar__button" disabled={busy} onClick={onEdit}>
              {t('calendar.actions.edit')}
            </button>
          )}
          {actions.complete && (
            <button
              type="button"
              className="calendar__button"
              disabled={busy || actions.completeTooEarly}
              title={actions.completeTooEarly ? t('calendar.actions.tooEarly') : undefined}
              onClick={() => sendStatus('completed', null, false)}
            >
              {t('calendar.actions.complete')}
            </button>
          )}
          {actions.noShow && (
            <button
              type="button"
              className="calendar__button"
              disabled={busy}
              onClick={() => sendStatus('no_show', null, false)}
            >
              {t('calendar.actions.noShow')}
            </button>
          )}
          {actions.restore && (
            <button
              type="button"
              className="calendar__button"
              disabled={busy}
              onClick={() => sendStatus('scheduled', null, false)}
            >
              {t('calendar.actions.restore')}
            </button>
          )}
          {actions.cancel && (
            <button
              type="button"
              className="calendar__button calendar__button--danger"
              disabled={busy}
              onClick={() =>
                isBlock ? sendStatus('cancelled_by_salon', null, false) : setCancelling(true)
              }
            >
              {t('calendar.actions.cancel')}
            </button>
          )}
        </div>
      )}

      {/* Collapsed by default: opened only when needed. */}
      <details className="calendar-accordion">
        <summary className="calendar-accordion__summary">
          <h3>{t('calendar.modal.history')}</h3>
          <span className="calendar-modal__muted">{detail.history.length}</span>
        </summary>
        <HistoryList history={detail.history} />
      </details>
    </div>
  )
}
