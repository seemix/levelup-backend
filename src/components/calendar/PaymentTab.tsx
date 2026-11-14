'use client'
import { useMemo, useState } from 'react'

import type { AppointmentStatus } from '@/crm/appointment-status'
import { normalizeCertificateCode } from '@/crm/certificate-code'
import { RULE_ERROR_KEYS } from '@/crm/error-keys'
import { canOfferRefund } from '@/crm/finance'
import { formatMoney } from '@/crm/money'
import {
  paymentBody,
  suggestedRows,
  summarizePayment,
  type CashRow,
  type PaymentSummary,
} from '@/crm/payment-form'
import { amountDue, PAYABLE_STATUSES, type AppointmentMoney } from '@/crm/payments'
import { formatDateTime } from '@/crm/time'
import type { CrmKey } from '@/i18n'

import { AmountInput } from '../finance/AmountInput'
import { CashRows } from '../finance/CashRows'
import type { CertificateDoc, Operation } from '../finance/types'
import { listQuery, useRestList } from '../finance/useRestList'
import { useRegisters } from '../finance/useRegisters'
import { useCrmApi, useErrorText, useLanguage, type AppointmentDetail } from './api'
import { useCrmT } from './useCrmT'

type Props = {
  detail: AppointmentDetail
  /** Role `admin`: refunds (the server checks it again). */
  isAdmin: boolean
  /** The money changed on the server: reload the calendar and the details. */
  onChanged: () => void
  /** A message that survives the reload of the details (kept by the modal). */
  onNotice: (text: string) => void
}

const certificateStatusKey: Record<string, CrmKey | undefined> = {
  expired: 'errors.certificateExpired',
  void: 'errors.certificateVoid',
  depleted: 'errors.certificateInsufficient',
}

/** Message of a summary error (`null` — nothing to say: an empty form, a non-payable visit). */
const summaryErrorKey = (error: PaymentSummary['error']): CrmKey | null => {
  switch (error) {
    case null:
    case 'PAYMENT_EMPTY':
    case 'APPOINTMENT_NOT_PAYABLE':
      return null
    case 'AMOUNT_INVALID':
      return 'errors.amountInvalid'
    case 'REGISTER_REQUIRED':
      return 'finance.errors.registerRequired'
    case 'REGISTER_DUPLICATE':
      return 'errors.ledgerSameRegister'
    default:
      return RULE_ERROR_KEYS[error]
  }
}

/**
 * "Payment" tab of the appointment modal (spec §5.8, §5.7, A35): split between the registers of the
 * appointment's location, a certificate by code, a tip, the summary "to pay / change", the history of
 * payments and the admin refund. The server re-checks everything.
 */
export const PaymentTab = ({ detail, isAdmin, onChanged, onNotice }: Props) => {
  const t = useCrmT()
  const api = useCrmApi()
  const language = useLanguage()
  const errorText = useErrorText()
  const { appointment: a } = detail
  const location = a.location

  const [reload, setReload] = useState(0)
  const { registers, failed: registersFailed } = useRegisters(location, 0)
  const history = useRestList<Operation>(
    `/transactions?${listQuery(language, {
      sort: 'occurredAt',
      'where[appointment][equals]': a.id,
    })}`,
    reload,
  )

  const money: AppointmentMoney = useMemo(
    () => ({
      kind: a.kind,
      status: a.status as AppointmentStatus,
      startAt: new Date(a.start),
      total: a.total,
      paidAmount: a.paidAmount,
      certificateAmount: a.certificateAmount,
      tipAmount: a.tipAmount,
    }),
    [a],
  )
  const due = amountDue(money)
  const payable = a.kind === 'appointment' && PAYABLE_STATUSES.includes(money.status) && due > 0
  const activeRegisters = useMemo(
    () => registers.filter((register) => register.active),
    [registers],
  )

  // Rows start as "the first cash register, the whole amount due"; the user's edits replace them.
  const [edited, setEdited] = useState<CashRow[] | null>(null)
  const rows = edited ?? suggestedRows(activeRegisters, due)
  const [tip, setTip] = useState('')
  const [comment, setComment] = useState('')
  const [codeText, setCodeText] = useState('')
  const [certificate, setCertificate] = useState<CertificateDoc | null>(null)
  const [certificateAmount, setCertificateAmount] = useState('')
  const [certificateError, setCertificateError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refunding, setRefunding] = useState<string | null>(null)
  const [refundComment, setRefundComment] = useState('')

  const summary = summarizePayment(money, {
    rows,
    tip,
    certificateBalance: certificate ? certificate.balance : null,
    certificateAmount,
  })
  const format = (bani: number) => formatMoney(bani, language)
  const registerName = (id: string) => registers.find((register) => register.id === id)?.name ?? id

  const checkCertificate = async () => {
    const code = normalizeCertificateCode(codeText)
    if (!code) return
    setChecking(true)
    setCertificateError(null)
    try {
      const params = new URLSearchParams({ depth: '0', limit: '1', 'where[code][equals]': code })
      const { docs } = await api<{ docs: CertificateDoc[] }>(`/gift-certificates?${params}`)
      const found = docs[0]
      const statusKey = found ? certificateStatusKey[found.status] : undefined
      if (!found) setCertificateError(t('errors.certificateNotFound'))
      else if (statusKey) setCertificateError(t(statusKey))
      else {
        setCertificate({ ...found, id: String(found.id) })
        setCodeText(found.code)
      }
    } catch (caught) {
      setCertificateError(errorText(caught))
    } finally {
      setChecking(false)
    }
  }

  const clearCertificate = () => {
    setCertificate(null)
    setCertificateAmount('')
    setCertificateError(null)
    setCodeText('')
  }

  const submit = async () => {
    if (!summary.ready) return
    setBusy(true)
    setError(null)
    try {
      await api(`/crm/appointments/${a.id}/payments`, {
        method: 'POST',
        body: paymentBody(summary, certificate?.code ?? null, comment),
      })
      setEdited(null)
      setTip('')
      setComment('')
      clearCertificate()
      setReload((value) => value + 1)
      onNotice(t('payment.saved'))
      onChanged()
    } catch (caught) {
      setError(errorText(caught))
    } finally {
      setBusy(false)
    }
  }

  const refund = async (id: string) => {
    setBusy(true)
    setError(null)
    try {
      await api(`/crm/transactions/${id}/refund`, {
        method: 'POST',
        body: refundComment.trim() ? { comment: refundComment.trim() } : {},
      })
      setRefunding(null)
      setRefundComment('')
      setReload((value) => value + 1)
      onNotice(t('payment.refunded'))
      onChanged()
    } catch (caught) {
      setError(errorText(caught))
    } finally {
      setBusy(false)
    }
  }

  const summaryMessage = summaryErrorKey(summary.error)
  const operations = history.docs ?? []

  return (
    <div className="calendar-modal__details finance-payment">
      <table className="calendar-modal__price">
        <tbody>
          <tr>
            <td>{t('calendar.modal.total')}</td>
            <td>{format(a.total)}</td>
          </tr>
          <tr>
            <td>{t('calendar.modal.paid')}</td>
            <td>{format(a.paidAmount)}</td>
          </tr>
          {a.certificateAmount > 0 && (
            <tr>
              <td>{t('payment.byCertificate')}</td>
              <td>{format(a.certificateAmount)}</td>
            </tr>
          )}
          {a.tipAmount > 0 && (
            <tr>
              <td>{t('payment.tips')}</td>
              <td>{format(a.tipAmount)}</td>
            </tr>
          )}
          <tr className="calendar-modal__total">
            <td>{t('payment.due')}</td>
            <td>{format(due)}</td>
          </tr>
        </tbody>
      </table>

      {error && (
        <p className="calendar-modal__error" role="alert">
          {error}
        </p>
      )}

      {payable ? (
        <section className="calendar-modal__section">
          {registersFailed ? (
            <p className="calendar-modal__error">{t('finance.loadError')}</p>
          ) : activeRegisters.length === 0 && certificate === null ? (
            <p className="calendar-modal__muted">{t('payment.noRegisters')}</p>
          ) : null}
          <CashRows
            label={t('payment.cash')}
            rows={rows}
            registers={activeRegisters}
            disabled={busy}
            onChange={setEdited}
          />
          <AmountInput
            label={t('payment.tip')}
            hint={t('payment.tipHint')}
            value={tip}
            disabled={busy}
            onChange={setTip}
          />

          <fieldset className="calendar-modal__field finance__rows">
            <legend>{t('payment.certificate')}</legend>
            {certificate ? (
              <>
                <div className="finance__certificate">
                  <strong>{certificate.code}</strong>
                  <span>
                    {t('payment.certificateBalance', { balance: format(certificate.balance) })}
                    {' · '}
                    {t('payment.certificateExpires', {
                      date: formatDateTime(new Date(certificate.expiresAt), language),
                    })}
                  </span>
                  <button
                    type="button"
                    className="calendar__button"
                    disabled={busy}
                    onClick={clearCertificate}
                  >
                    {t('payment.certificateClear')}
                  </button>
                </div>
                <AmountInput
                  label={t('payment.certificateAmount')}
                  hint={t('payment.certificateAmountHint')}
                  value={certificateAmount}
                  disabled={busy}
                  placeholder={format(summary.certificate)}
                  onChange={setCertificateAmount}
                />
              </>
            ) : (
              <div className="finance__row finance__row--code">
                <input
                  type="text"
                  autoComplete="off"
                  aria-label={t('payment.certificateCode')}
                  placeholder="LU-XXXX-XXXX"
                  value={codeText}
                  disabled={busy || checking}
                  onChange={(event) => setCodeText(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      void checkCertificate()
                    }
                  }}
                />
                <button
                  type="button"
                  className="calendar__button"
                  disabled={busy || checking || codeText.trim() === ''}
                  onClick={() => void checkCertificate()}
                >
                  {checking ? t('calendar.actions.working') : t('payment.certificateCheck')}
                </button>
              </div>
            )}
            {certificateError && (
              <span className="calendar-modal__error" role="alert">
                {certificateError}
              </span>
            )}
          </fieldset>

          <label className="calendar-modal__field">
            <span>{t('payment.comment')}</span>
            <input
              type="text"
              value={comment}
              maxLength={500}
              disabled={busy}
              onChange={(event) => setComment(event.target.value)}
            />
          </label>

          <dl className="finance__summary" aria-live="polite">
            <div>
              <dt>{t('payment.toPay')}</dt>
              <dd>{format(summary.due)}</dd>
            </div>
            <div>
              <dt>{t('payment.accepted')}</dt>
              <dd>{format(summary.applied)}</dd>
            </div>
            {summary.change > 0 ? (
              <div className="finance__summary--bad">
                <dt>{t('payment.change')}</dt>
                <dd>{format(summary.change)}</dd>
              </div>
            ) : (
              <div>
                <dt>{t('payment.remaining')}</dt>
                <dd>{format(summary.remaining)}</dd>
              </div>
            )}
          </dl>
          {summary.change > 0 && <p className="finance__hint">{t('payment.changeHint')}</p>}
          {summaryMessage && (
            <p className="calendar-modal__error" role="alert">
              {t(summaryMessage)}
            </p>
          )}
          <div className="calendar-modal__actions">
            <button
              type="button"
              className="calendar__button calendar__button--primary"
              disabled={busy || !summary.ready}
              onClick={() => void submit()}
            >
              {busy ? t('calendar.actions.working') : t('payment.submit')}
            </button>
          </div>
        </section>
      ) : (
        a.kind === 'appointment' && (
          <p className="calendar-modal__muted">
            {due === 0 && a.total > 0 ? t('payment.fullyPaid') : t('payment.notPayable')}
          </p>
        )
      )}

      <section className="calendar-modal__section">
        <h3>{t('payment.history')}</h3>
        {history.loading ? (
          <p className="calendar-modal__muted">{t('calendar.loading')}</p>
        ) : history.failed ? (
          <p className="calendar-modal__error">{t('finance.loadError')}</p>
        ) : operations.length === 0 ? (
          <p className="calendar-modal__muted">{t('payment.historyEmpty')}</p>
        ) : (
          <ul className="finance__history">
            {operations.map((operation) => {
              const id = String(operation.id)
              return (
                <li
                  key={id}
                  className={operation.reversed ? 'finance__history-item--reversed' : undefined}
                >
                  <div className="finance__history-head">
                    <span>{formatDateTime(new Date(operation.occurredAt), language)}</span>
                    <strong>
                      {t(`transactions.types.${operation.type as 'refund'}`)}
                      {operation.reversed && (
                        <span className="calendar-modal__muted">
                          {' · '}
                          {t('payment.reversedBadge')}
                        </span>
                      )}
                    </strong>
                  </div>
                  <ul className="finance__history-lines">
                    {operation.entries.map((entry) => (
                      <li key={entry.cashRegister}>
                        {registerName(String(entry.cashRegister))}: {format(entry.amount)}
                      </li>
                    ))}
                    {!!operation.certificateAmount && (
                      <li>
                        {t('payment.inCertificate', {
                          amount: format(operation.certificateAmount),
                        })}
                      </li>
                    )}
                    {!!operation.tipAmount && (
                      <li>{t('payment.inTip', { amount: format(operation.tipAmount) })}</li>
                    )}
                    {operation.comment && (
                      <li className="calendar-modal__muted">{operation.comment}</li>
                    )}
                  </ul>
                  {canOfferRefund(operation, isAdmin) &&
                    (refunding === id ? (
                      <div className="finance__confirm">
                        <p>{t('payment.refundHint')}</p>
                        <input
                          type="text"
                          aria-label={t('payment.comment')}
                          placeholder={t('payment.comment')}
                          value={refundComment}
                          maxLength={500}
                          disabled={busy}
                          onChange={(event) => setRefundComment(event.target.value)}
                        />
                        <div className="calendar-modal__actions">
                          <button
                            type="button"
                            className="calendar__button"
                            disabled={busy}
                            onClick={() => setRefunding(null)}
                          >
                            {t('calendar.actions.back')}
                          </button>
                          <button
                            type="button"
                            className="calendar__button calendar__button--danger"
                            disabled={busy}
                            onClick={() => void refund(id)}
                          >
                            {busy ? t('calendar.actions.working') : t('payment.refundConfirm')}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="calendar__button calendar__button--danger"
                        disabled={busy}
                        onClick={() => {
                          setRefunding(id)
                          setError(null)
                        }}
                      >
                        {t('payment.refund')}
                      </button>
                    ))}
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
