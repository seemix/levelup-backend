'use client'
import { useState, type FormEvent, type ReactNode } from 'react'

import { formatMoney, parseLeiInput } from '@/crm/money'
import { emptyRow, parseRows, type CashRow } from '@/crm/payment-form'
import { isLocalDate, localToInstant } from '@/crm/time'
import type { CrmKey } from '@/i18n'

import { Modal } from '../calendar/Modal'
import { useCrmApi, useErrorText, useLanguage } from '../calendar/api'
import { useCrmT } from '../calendar/useCrmT'
import { AmountInput } from './AmountInput'
import { CashRows } from './CashRows'
import type { CertificateDoc, ExpenseCategory, LocationOption, Register } from './types'

/** What a form reports to the page: the registers it touched (balance check) and server warnings. */
export type FormDone = {
  notice: CrmKey
  registerIds: string[]
  warnings: string[]
  certificate?: { code: string; nominal: number; expiresAt: string }
}

type Shared = {
  locations: LocationOption[]
  registers: Register[]
  onCancel: () => void
  onDone: (done: FormDone) => void
}

type FrameProps = {
  title: string
  busy: boolean
  error: string | null
  submitLabel: string
  onSubmit: () => void
  onCancel: () => void
  children: ReactNode
  valid: boolean
}

const Frame = ({
  title,
  busy,
  error,
  submitLabel,
  onSubmit,
  onCancel,
  children,
  valid,
}: FrameProps) => {
  const t = useCrmT()
  return (
    <Modal title={title} onClose={onCancel}>
      <form
        className="calendar-modal__form"
        onSubmit={(event: FormEvent) => {
          event.preventDefault()
          if (valid && !busy) onSubmit()
        }}
      >
        {children}
        {error && (
          <p className="calendar-modal__error" role="alert">
            {error}
          </p>
        )}
        <div className="calendar-modal__actions">
          <button type="button" className="calendar__button" disabled={busy} onClick={onCancel}>
            {t('finance.form.cancel')}
          </button>
          <button
            type="submit"
            className="calendar__button calendar__button--primary"
            disabled={busy || !valid}
          >
            {busy ? t('calendar.actions.working') : submitLabel}
          </button>
        </div>
      </form>
    </Modal>
  )
}

/** Location select (hidden when the user has exactly one); changing it drops the register picks. */
const LocationField = ({
  locations,
  value,
  onChange,
}: {
  locations: LocationOption[]
  value: string
  onChange: (id: string) => void
}) => {
  const t = useCrmT()
  if (locations.length <= 1) return null
  return (
    <label className="calendar-modal__field">
      <span>{t('finance.form.location')}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {locations.map((location) => (
          <option key={location.id} value={location.id}>
            {location.name}
          </option>
        ))}
      </select>
    </label>
  )
}

const RegisterSelect = ({
  label,
  registers,
  value,
  onChange,
}: {
  label: string
  registers: Register[]
  value: string
  onChange: (id: string) => void
}) => {
  const t = useCrmT()
  return (
    <label className="calendar-modal__field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">{t('finance.form.pickRegister')}</option>
        {registers.map((register) => (
          <option key={register.id} value={register.id}>
            {register.name} · {t(`finance.registerTypes.${register.type}`)}
          </option>
        ))}
      </select>
    </label>
  )
}

const CommentField = ({
  value,
  onChange,
  disabled,
}: {
  value: string
  onChange: (value: string) => void
  disabled: boolean
}) => {
  const t = useCrmT()
  return (
    <label className="calendar-modal__field">
      <span>{t('finance.form.comment')}</span>
      <input
        type="text"
        value={value}
        maxLength={500}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}

/** Active registers of a location. */
const inLocation = (registers: Register[], location: string) =>
  registers.filter((register) => register.active && register.location === location)

const useSubmit = () => {
  const errorText = useErrorText()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (caught) {
      setError(errorText(caught))
      setBusy(false)
    }
  }
  return { busy, error, run }
}

// ---------------------------------------------------------------------------
// Expense
// ---------------------------------------------------------------------------

export const ExpenseForm = ({
  locations,
  registers,
  categories,
  onCancel,
  onDone,
}: Shared & { categories: ExpenseCategory[] }) => {
  const t = useCrmT()
  const api = useCrmApi()
  const { busy, error, run } = useSubmit()
  const [location, setLocation] = useState(locations[0]?.id ?? '')
  const [register, setRegister] = useState('')
  const [category, setCategory] = useState('')
  const [amountText, setAmountText] = useState('')
  const [comment, setComment] = useState('')
  const options = inLocation(registers, location)
  const amount = parseLeiInput(amountText)
  const valid = !!location && !!register && !!category && amount !== null && amount > 0

  const submit = () =>
    run(async () => {
      await api('/transactions', {
        method: 'POST',
        body: {
          type: 'expense',
          location,
          expenseCategory: category,
          entries: [{ cashRegister: register, amount: -(amount as number) }],
          ...(comment.trim() ? { comment: comment.trim() } : {}),
        },
      })
      onDone({ notice: 'finance.done.expense', registerIds: [register], warnings: [] })
    })

  return (
    <Frame
      title={t('finance.actions.expense')}
      busy={busy}
      error={error}
      submitLabel={t('finance.form.save')}
      valid={valid}
      onSubmit={() => void submit()}
      onCancel={onCancel}
    >
      <LocationField
        locations={locations}
        value={location}
        onChange={(id) => {
          setLocation(id)
          setRegister('')
        }}
      />
      <RegisterSelect
        label={t('finance.form.registerFrom')}
        registers={options}
        value={register}
        onChange={setRegister}
      />
      <label className="calendar-modal__field">
        <span>{t('finance.form.category')}</span>
        <select value={category} onChange={(event) => setCategory(event.target.value)}>
          <option value="">{t('finance.form.pickCategory')}</option>
          {categories.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
      <AmountInput
        label={t('finance.form.amount')}
        value={amountText}
        disabled={busy}
        autoFocus
        onChange={setAmountText}
      />
      <CommentField value={comment} onChange={setComment} disabled={busy} />
    </Frame>
  )
}

// ---------------------------------------------------------------------------
// Transfer
// ---------------------------------------------------------------------------

export const TransferForm = ({ locations, registers, onCancel, onDone }: Shared) => {
  const t = useCrmT()
  const api = useCrmApi()
  const { busy, error, run } = useSubmit()
  const [location, setLocation] = useState(locations[0]?.id ?? '')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [amountText, setAmountText] = useState('')
  const [comment, setComment] = useState('')
  const options = inLocation(registers, location)
  const amount = parseLeiInput(amountText)
  const valid = !!location && !!from && !!to && from !== to && amount !== null && amount > 0

  const submit = () =>
    run(async () => {
      await api('/transactions', {
        method: 'POST',
        body: {
          type: 'transfer',
          location,
          entries: [
            { cashRegister: from, amount: -(amount as number) },
            { cashRegister: to, amount: amount as number },
          ],
          ...(comment.trim() ? { comment: comment.trim() } : {}),
        },
      })
      onDone({ notice: 'finance.done.transfer', registerIds: [from, to], warnings: [] })
    })

  return (
    <Frame
      title={t('finance.actions.transfer')}
      busy={busy}
      error={error}
      submitLabel={t('finance.form.save')}
      valid={valid}
      onSubmit={() => void submit()}
      onCancel={onCancel}
    >
      <LocationField
        locations={locations}
        value={location}
        onChange={(id) => {
          setLocation(id)
          setFrom('')
          setTo('')
        }}
      />
      <RegisterSelect
        label={t('finance.form.registerFrom')}
        registers={options}
        value={from}
        onChange={setFrom}
      />
      <RegisterSelect
        label={t('finance.form.registerTo')}
        registers={options.filter((register) => register.id !== from)}
        value={to}
        onChange={setTo}
      />
      {from && to && from === to && (
        <p className="calendar-modal__error">{t('errors.ledgerSameRegister')}</p>
      )}
      <AmountInput
        label={t('finance.form.amount')}
        value={amountText}
        disabled={busy}
        autoFocus
        onChange={setAmountText}
      />
      <CommentField value={comment} onChange={setComment} disabled={busy} />
    </Frame>
  )
}

// ---------------------------------------------------------------------------
// Certificate sale
// ---------------------------------------------------------------------------

export const CertificateForm = ({ locations, registers, onCancel, onDone }: Shared) => {
  const t = useCrmT()
  const api = useCrmApi()
  const language = useLanguage()
  const { busy, error, run } = useSubmit()
  const [location, setLocation] = useState(locations[0]?.id ?? '')
  const [nominalText, setNominalText] = useState('')
  const [rows, setRows] = useState<CashRow[]>([emptyRow()])
  const [buyerName, setBuyerName] = useState('')
  const [buyerPhone, setBuyerPhone] = useState('')
  const [expires, setExpires] = useState('')
  const [comment, setComment] = useState('')
  const options = inLocation(registers, location)
  const nominal = parseLeiInput(nominalText)

  // One row without an amount = the whole nominal goes to that register.
  const effective =
    rows.length === 1 && rows[0].amount.trim() === '' && nominal !== null
      ? [{ ...rows[0], amount: nominalText }]
      : rows
  const parsed = parseRows(effective)
  const mismatch = nominal !== null && parsed.entries.length > 0 && parsed.total !== nominal
  const expiresValid = expires === '' || isLocalDate(expires)
  const valid =
    !!location &&
    nominal !== null &&
    nominal > 0 &&
    parsed.error === null &&
    parsed.entries.length > 0 &&
    !mismatch &&
    expiresValid

  const submit = () =>
    run(async () => {
      const result = await api<{ certificate: CertificateDoc; warnings: string[] }>(
        '/crm/certificates/sell',
        {
          method: 'POST',
          body: {
            nominal,
            location,
            entries: parsed.entries,
            ...(expires ? { expiresAt: localToInstant(expires, '23:59').toISOString() } : {}),
            ...(buyerName.trim() || buyerPhone.trim()
              ? { buyer: { name: buyerName.trim(), phone: buyerPhone.trim() } }
              : {}),
            ...(comment.trim() ? { comment: comment.trim() } : {}),
          },
        },
      )
      onDone({
        notice: 'finance.done.certificate',
        registerIds: parsed.entries.map((entry) => entry.cashRegister),
        warnings: result.warnings ?? [],
        certificate: {
          code: result.certificate.code,
          nominal: result.certificate.nominal,
          expiresAt: result.certificate.expiresAt,
        },
      })
    })

  return (
    <Frame
      title={t('finance.actions.sellCertificate')}
      busy={busy}
      error={error}
      submitLabel={t('finance.form.sell')}
      valid={valid}
      onSubmit={() => void submit()}
      onCancel={onCancel}
    >
      <LocationField
        locations={locations}
        value={location}
        onChange={(id) => {
          setLocation(id)
          setRows([emptyRow()])
        }}
      />
      <AmountInput
        label={t('finance.form.nominal')}
        value={nominalText}
        disabled={busy}
        autoFocus
        onChange={setNominalText}
      />
      <CashRows
        label={t('finance.form.receivedIn')}
        rows={rows}
        registers={options}
        disabled={busy}
        onChange={setRows}
      />
      {mismatch && (
        <p className="calendar-modal__error" role="alert">
          {t('finance.errors.sumMismatch', {
            sum: formatMoney(parsed.total, language),
            nominal: formatMoney(nominal, language),
          })}
        </p>
      )}
      <div className="calendar-modal__grid">
        <label className="calendar-modal__field">
          <span>{t('finance.form.buyerName')}</span>
          <input
            type="text"
            value={buyerName}
            maxLength={120}
            disabled={busy}
            onChange={(event) => setBuyerName(event.target.value)}
          />
        </label>
        <label className="calendar-modal__field">
          <span>{t('finance.form.buyerPhone')}</span>
          <input
            type="tel"
            value={buyerPhone}
            maxLength={40}
            disabled={busy}
            onChange={(event) => setBuyerPhone(event.target.value)}
          />
        </label>
      </div>
      <label className="calendar-modal__field">
        <span>{t('finance.form.expiresAt')}</span>
        <input
          type="date"
          value={expires}
          disabled={busy}
          onChange={(event) => setExpires(event.target.value)}
        />
        <span className="finance__hint">{t('finance.form.expiresAtHint')}</span>
      </label>
      <CommentField value={comment} onChange={setComment} disabled={busy} />
    </Frame>
  )
}
