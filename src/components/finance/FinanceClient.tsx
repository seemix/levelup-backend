'use client'
import { useAuth } from '@payloadcms/ui'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { TRANSACTION_TYPES } from '@/crm/ledger'
import {
  canOfferReversal,
  emptyFilters,
  operationAmount,
  operationsQuery,
  type OperationFilters,
} from '@/crm/finance'
import { formatMoney } from '@/crm/money'
import { formatDateTime } from '@/crm/time'

import '../calendar/calendar.scss'
import './finance.scss'
import { Modal } from '../calendar/Modal'
import { useCrmApi, useErrorText, useLanguage } from '../calendar/api'
import { useCrmT } from '../calendar/useCrmT'
import { CertificateForm, ExpenseForm, TransferForm, type FormDone } from './FinanceForms'
import type { ExpenseCategory, ListResponse, LocationOption, Operation, Register } from './types'
import { listQuery, useRestList } from './useRestList'
import { useRegisters } from './useRegisters'

type FormKind = 'expense' | 'transfer' | 'certificate'

type Notice = { kind: 'ok' | 'warning'; text: string }

type Loaded = { key: string; docs: Operation[]; hasNext: boolean; page: number } | null

/**
 * Admin view «Cash registers» (spec §3.1, §4.13–§4.15, A35): balances, quick forms «Expense»,
 * «Transfer», «Sell certificate», the list of operations with filters and a reversal button. Data come
 * from the standard REST of the collections (the user's rights apply); the buttons only follow the
 * role — the server decides.
 */
export const FinanceClient = () => {
  const t = useCrmT()
  const api = useCrmApi()
  const language = useLanguage()
  const errorText = useErrorText()
  const { user } = useAuth()
  const roles = ((user as { roles?: string[] } | null)?.roles ?? []) as string[]
  const isAdmin = roles.includes('admin')
  const isManager = roles.includes('manager')

  const [reload, setReload] = useState(0)
  const [filters, setFilters] = useState<OperationFilters>(emptyFilters)
  const [form, setForm] = useState<FormKind | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [sold, setSold] = useState<NonNullable<FormDone['certificate']> | null>(null)
  const [reversing, setReversing] = useState<Operation | null>(null)
  const [reverseComment, setReverseComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [reverseError, setReverseError] = useState<string | null>(null)

  const {
    registers,
    failed: registersFailed,
    loading: registersLoading,
  } = useRegisters(null, reload)
  const locationsList = useRestList<{ id: string | number; name: string }>(
    `/locations?${listQuery(language, { sort: 'name' })}`,
  )
  const categoriesList = useRestList<{ id: string | number; name: string; active: boolean }>(
    `/expense-categories?${listQuery(language, { sort: 'order' })}`,
  )

  const locations: LocationOption[] = useMemo(() => {
    // Only the locations the user has registers in (manager: own locations).
    const used = new Set(registers.map((register) => register.location))
    return (locationsList.docs ?? [])
      .map((doc) => ({ id: String(doc.id), name: doc.name }))
      .filter((location) => used.has(location.id))
  }, [locationsList.docs, registers])
  const categories: ExpenseCategory[] = useMemo(
    () =>
      (categoriesList.docs ?? []).map((doc) => ({
        id: String(doc.id),
        name: doc.name,
        active: doc.active,
      })),
    [categoriesList.docs],
  )

  const money = (bani: number) => formatMoney(bani, language)
  const registerName = (id: string) => registers.find((register) => register.id === id)?.name ?? id
  const locationName = (id: string) => locations.find((location) => location.id === id)?.name ?? ''
  const categoryName = (id: string) => categories.find((category) => category.id === id)?.name ?? ''

  // --- operations (paged; the result is stored with the key of its request) ---
  const [list, setList] = useState<Loaded>(null)
  const [moreBusy, setMoreBusy] = useState(false)
  const query = operationsQuery(filters, { locale: language }).toString()
  const key = `${query}|${reload}`
  useEffect(() => {
    const controller = new AbortController()
    api<ListResponse<Operation>>(`/transactions?${query}`, { signal: controller.signal })
      .then((response) =>
        setList({ key, docs: response.docs, hasNext: response.hasNextPage, page: response.page }),
      )
      .catch((error: unknown) => {
        if ((error as { name?: string }).name !== 'AbortError')
          setList({ key, docs: [], hasNext: false, page: 0 })
      })
    return () => controller.abort()
  }, [api, query, key])
  const current = list?.key === key ? list : null
  const operations = (current ?? list)?.docs ?? []
  const listFailed = current?.page === 0

  const loadMore = async () => {
    if (!current) return
    setMoreBusy(true)
    try {
      const next = await api<ListResponse<Operation>>(
        `/transactions?${operationsQuery(filters, { locale: language, page: current.page + 1 })}`,
      )
      setList({
        key,
        docs: [...current.docs, ...next.docs],
        hasNext: next.hasNextPage,
        page: next.page,
      })
    } catch (caught) {
      setNotice({ kind: 'warning', text: errorText(caught) })
    } finally {
      setMoreBusy(false)
    }
  }

  const refresh = useCallback(() => setReload((value) => value + 1), [])

  /** A balance that fell below zero (A8): the REST create has no warnings, so the registers are re-read. */
  const negativeAmong = async (ids: string[]): Promise<boolean> => {
    if (ids.length === 0) return false
    try {
      const params = new URLSearchParams({ depth: '0', limit: '0', 'where[id][in]': ids.join(',') })
      const { docs } = await api<{ docs: Register[] }>(`/cash-registers?${params}`)
      return docs.some((doc) => typeof doc.balance === 'number' && doc.balance < 0)
    } catch {
      return false
    }
  }

  const done = async (result: FormDone) => {
    setForm(null)
    if (result.certificate) setSold(result.certificate)
    const negative =
      result.warnings.includes('NEGATIVE_BALANCE') || (await negativeAmong(result.registerIds))
    setNotice(
      negative
        ? { kind: 'warning', text: t('transactions.warnings.NEGATIVE_BALANCE') }
        : { kind: 'ok', text: t(result.notice) },
    )
    refresh()
  }

  const reverse = async () => {
    if (!reversing) return
    setBusy(true)
    setReverseError(null)
    try {
      const result = await api<{ warnings?: string[] }>(
        `/crm/transactions/${reversing.id}/reverse`,
        {
          method: 'POST',
          body: reverseComment.trim() ? { comment: reverseComment.trim() } : {},
        },
      )
      setReversing(null)
      setReverseComment('')
      setNotice(
        result.warnings?.includes('NEGATIVE_BALANCE')
          ? { kind: 'warning', text: t('transactions.warnings.NEGATIVE_BALANCE') }
          : { kind: 'ok', text: t('finance.done.reversal') },
      )
      refresh()
    } catch (caught) {
      setReverseError(errorText(caught))
    } finally {
      setBusy(false)
    }
  }

  const setFilter = (patch: Partial<OperationFilters>) =>
    setFilters((previous) => ({ ...previous, ...patch }))
  const filtered = Object.values(filters).some(Boolean)
  const activeRegisters = registers.filter((register) => register.active)
  const canWrite = (isAdmin || isManager) && locations.length > 0 && activeRegisters.length > 0
  const registerOptions = filters.location
    ? registers.filter((register) => register.location === filters.location)
    : registers

  const description = (operation: Operation) => {
    const lines = operation.entries.map(
      (entry) => `${registerName(String(entry.cashRegister))}: ${money(entry.amount)}`,
    )
    const extra = [
      operation.expenseCategory ? categoryName(String(operation.expenseCategory)) : '',
      operation.comment ?? '',
    ].filter(Boolean)
    return { lines, extra }
  }

  return (
    <div className="calendar finance">
      <div className="finance__toolbar">
        <h1 className="finance__title">{t('finance.title')}</h1>
        {canWrite && (
          <div className="finance__actions">
            <button
              type="button"
              className="calendar__button calendar__button--primary"
              onClick={() => setForm('expense')}
            >
              {t('finance.actions.expense')}
            </button>
            <button type="button" className="calendar__button" onClick={() => setForm('transfer')}>
              {t('finance.actions.transfer')}
            </button>
            <button
              type="button"
              className="calendar__button"
              onClick={() => setForm('certificate')}
            >
              {t('finance.actions.sellCertificate')}
            </button>
          </div>
        )}
      </div>

      {notice && (
        <p
          className={`finance__notice finance__notice--${notice.kind}`}
          role={notice.kind === 'warning' ? 'alert' : 'status'}
        >
          {notice.text}
          <button
            type="button"
            className="calendar__icon-button"
            aria-label={t('calendar.modal.close')}
            onClick={() => setNotice(null)}
          >
            ×
          </button>
        </p>
      )}

      <section aria-label={t('finance.registers')}>
        {registersFailed ? (
          <p className="calendar__state">{t('finance.loadError')}</p>
        ) : registersLoading ? (
          <p className="calendar__state">{t('calendar.loading')}</p>
        ) : registers.length === 0 ? (
          <p className="calendar__state">{t('finance.noRegisters')}</p>
        ) : (
          <div className="finance__cards">
            {registers.map((register) => {
              const selected = filters.cashRegister === register.id
              return (
                <button
                  key={register.id}
                  type="button"
                  aria-pressed={selected}
                  className={`finance__card${selected ? ' finance__card--selected' : ''}${
                    register.active ? '' : ' finance__card--inactive'
                  }`}
                  title={t('finance.showMovement')}
                  onClick={() => setFilter({ cashRegister: selected ? '' : register.id })}
                >
                  <span className="finance__card-name">{register.name}</span>
                  <span className="finance__card-meta">
                    {t(`finance.registerTypes.${register.type}`)}
                    {locations.length > 1 && ` · ${locationName(register.location)}`}
                    {!register.active && ` · ${t('finance.inactive')}`}
                  </span>
                  {typeof register.balance === 'number' && (
                    <strong
                      className={`finance__balance${register.balance < 0 ? ' finance__balance--negative' : ''}`}
                    >
                      {money(register.balance)}
                    </strong>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </section>

      <section className="finance__operations" aria-label={t('finance.operations')}>
        <h2 className="finance__subtitle">{t('finance.operations')}</h2>
        <div className="finance__filters">
          <label className="calendar-modal__field">
            <span>{t('finance.filters.from')}</span>
            <input
              type="date"
              value={filters.from}
              max={filters.to || undefined}
              onChange={(event) => setFilter({ from: event.target.value })}
            />
          </label>
          <label className="calendar-modal__field">
            <span>{t('finance.filters.to')}</span>
            <input
              type="date"
              value={filters.to}
              min={filters.from || undefined}
              onChange={(event) => setFilter({ to: event.target.value })}
            />
          </label>
          <label className="calendar-modal__field">
            <span>{t('finance.filters.type')}</span>
            <select
              value={filters.type}
              onChange={(event) => setFilter({ type: event.target.value })}
            >
              <option value="">{t('finance.filters.all')}</option>
              {TRANSACTION_TYPES.map((type) => (
                <option key={type} value={type}>
                  {t(`transactions.types.${type}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="calendar-modal__field">
            <span>{t('finance.filters.register')}</span>
            <select
              value={filters.cashRegister}
              onChange={(event) => setFilter({ cashRegister: event.target.value })}
            >
              <option value="">{t('finance.filters.all')}</option>
              {registerOptions.map((register) => (
                <option key={register.id} value={register.id}>
                  {register.name}
                </option>
              ))}
            </select>
          </label>
          {locations.length > 1 && (
            <label className="calendar-modal__field">
              <span>{t('finance.filters.location')}</span>
              <select
                value={filters.location}
                onChange={(event) => setFilter({ location: event.target.value, cashRegister: '' })}
              >
                <option value="">{t('finance.filters.all')}</option>
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {filtered && (
            <button
              type="button"
              className="calendar__button finance__reset"
              onClick={() => setFilters(emptyFilters())}
            >
              {t('finance.filters.reset')}
            </button>
          )}
        </div>

        {listFailed ? (
          <p className="calendar__state">
            {t('finance.loadError')}{' '}
            <button type="button" className="calendar__button" onClick={refresh}>
              {t('calendar.retry')}
            </button>
          </p>
        ) : !current ? (
          <p className="calendar__state">{t('calendar.loading')}</p>
        ) : operations.length === 0 ? (
          <p className="calendar__state">{t('finance.empty')}</p>
        ) : (
          <ul className="finance__list">
            {operations.map((operation) => {
              const { lines, extra } = description(operation)
              const amount = operationAmount(operation.entries)
              const offer = canOfferReversal({
                type: operation.type,
                reversed: operation.reversed,
                occurredAt: operation.occurredAt,
                isAdmin,
                isManager,
              })
              return (
                <li
                  key={operation.id}
                  className={`finance__op${operation.reversed ? ' finance__op--reversed' : ''}`}
                >
                  <div className="finance__op-when">
                    {formatDateTime(new Date(operation.occurredAt), language)}
                  </div>
                  <div className="finance__op-main">
                    <strong>
                      {t(`transactions.types.${operation.type as 'expense'}`)}
                      {operation.reversed && (
                        <span className="finance__badge">{t('finance.reversed')}</span>
                      )}
                    </strong>
                    <ul className="finance__op-lines">
                      {lines.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                      {extra.map((line) => (
                        <li key={line} className="calendar-modal__muted">
                          {line}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div
                    className={`finance__op-amount${amount < 0 ? ' finance__op-amount--negative' : ''}`}
                  >
                    {money(amount)}
                  </div>
                  <div className="finance__op-actions">
                    {offer && (
                      <button
                        type="button"
                        className="calendar__button calendar__button--danger"
                        onClick={() => {
                          setReversing(operation)
                          setReverseError(null)
                        }}
                      >
                        {t('finance.reverse')}
                      </button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
        {current?.hasNext && (
          <button
            type="button"
            className="calendar__button finance__more"
            disabled={moreBusy}
            onClick={() => void loadMore()}
          >
            {moreBusy ? t('calendar.actions.working') : t('finance.loadMore')}
          </button>
        )}
      </section>

      {form === 'expense' && (
        <ExpenseForm
          locations={locations}
          registers={registers}
          categories={categories.filter((category) => category.active)}
          onCancel={() => setForm(null)}
          onDone={(result) => void done(result)}
        />
      )}
      {form === 'transfer' && (
        <TransferForm
          locations={locations}
          registers={registers}
          onCancel={() => setForm(null)}
          onDone={(result) => void done(result)}
        />
      )}
      {form === 'certificate' && (
        <CertificateForm
          locations={locations}
          registers={registers}
          onCancel={() => setForm(null)}
          onDone={(result) => void done(result)}
        />
      )}

      {reversing && (
        <Modal title={t('finance.reverseTitle')} onClose={() => setReversing(null)}>
          <p>{t('finance.reverseHint')}</p>
          <ul className="finance__op-lines">
            {description(reversing).lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <label className="calendar-modal__field">
            <span>{t('finance.form.comment')}</span>
            <input
              type="text"
              value={reverseComment}
              maxLength={500}
              disabled={busy}
              onChange={(event) => setReverseComment(event.target.value)}
            />
          </label>
          {reverseError && (
            <p className="calendar-modal__error" role="alert">
              {reverseError}
            </p>
          )}
          <div className="calendar-modal__actions">
            <button
              type="button"
              className="calendar__button"
              disabled={busy}
              onClick={() => setReversing(null)}
            >
              {t('calendar.actions.back')}
            </button>
            <button
              type="button"
              className="calendar__button calendar__button--danger"
              disabled={busy}
              onClick={() => void reverse()}
            >
              {busy ? t('calendar.actions.working') : t('finance.reverseConfirm')}
            </button>
          </div>
        </Modal>
      )}

      {sold && (
        <Modal title={t('finance.done.certificate')} onClose={() => setSold(null)}>
          <p className="finance__code">{sold.code}</p>
          <dl className="calendar-modal__list">
            <div className="calendar-modal__row">
              <dt>{t('finance.form.nominal')}</dt>
              <dd>{money(sold.nominal)}</dd>
            </div>
            <div className="calendar-modal__row">
              <dt>{t('payment.certificateExpiresLabel')}</dt>
              <dd>{formatDateTime(new Date(sold.expiresAt), language)}</dd>
            </div>
          </dl>
          <div className="calendar-modal__actions">
            <button
              type="button"
              className="calendar__button"
              onClick={() => void navigator.clipboard?.writeText(sold.code).catch(() => undefined)}
            >
              {t('finance.copyCode')}
            </button>
            <button
              type="button"
              className="calendar__button calendar__button--primary"
              onClick={() => setSold(null)}
            >
              {t('finance.close')}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
