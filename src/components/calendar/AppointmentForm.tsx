'use client'
import { useEffect, useMemo, useState } from 'react'

import {
  buildCreateBody,
  buildPatchBody,
  buildPreviewBody,
  validateForm,
  type FormState,
} from '@/crm/appointment-form'
import { formatMoney } from '@/crm/money'
import { tryNormalizePhone } from '@/crm/phone'

import {
  CrmApiError,
  useCrmApi,
  useErrorText,
  useLanguage,
  type CatalogExtra,
  type CatalogService,
  type ClientLookup,
  type PricePreview,
} from './api'
import { useCrmT } from './useCrmT'
import { WarningsPanel } from './WarningsPanel'
import type { CrmWarning } from '@/endpoints/crm/http'

type Props = {
  mode: 'create' | 'edit'
  /** Appointment being edited (edit mode). */
  appointmentId?: string
  initial: FormState
  locationId: string
  barbers: { id: string; name: string }[]
  /** `true` when the barber is fixed to the user's own column (role `barber`). */
  barberLocked: boolean
  /** Admin/manager: client lookup, promo code and manual discount (decisions 30, 36). */
  isManager: boolean
  services: CatalogService[]
  extras: CatalogExtra[]
  /** Name of the existing client (edit mode), shown while the phone is unchanged. */
  clientName?: string | null
  onSaved: () => void
  onCancel: () => void
}

const DEBOUNCE_MS = 350

type Pending = { warnings: CrmWarning[]; total: { from: number; to: number } | null }

export const AppointmentForm = ({
  mode,
  appointmentId,
  initial,
  locationId,
  barbers,
  barberLocked,
  isManager,
  services,
  extras,
  clientName,
  onSaved,
  onCancel,
}: Props) => {
  const t = useCrmT()
  const api = useCrmApi()
  const language = useLanguage()
  const errorText = useErrorText()
  const [state, setState] = useState<FormState>(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [serverFields, setServerFields] = useState<string[]>([])
  const [showIssues, setShowIssues] = useState(false)
  const [pending, setPending] = useState<Pending | null>(null)
  const [lookup, setLookup] = useState<{
    phone: string
    client: NonNullable<ClientLookup['client']> | null
  } | null>(null)
  const [preview, setPreview] = useState<{
    key: string
    data: PricePreview | null
    error: string | null
  } | null>(null)

  const patch = (changes: Partial<FormState>) => setState((current) => ({ ...current, ...changes }))
  const isBlock = state.kind === 'block'
  const options = { location: locationId, canDiscount: isManager }
  const issues = validateForm(state)
  const normalizedPhone = tryNormalizePhone(state.phone)

  // Extras that fit the chosen service (empty `appliesTo` = all, decision 15).
  const fittingExtras = useMemo(
    () =>
      extras.filter(
        (extra) => extra.appliesTo.length === 0 || extra.appliesTo.includes(state.service),
      ),
    [extras, state.service],
  )
  // Client lookup by phone (admin/manager only; a barber's phone is linked by the server).
  const initialPhone = tryNormalizePhone(initial.phone)
  const lookupActive =
    isManager &&
    !state.withoutName &&
    !!normalizedPhone &&
    !(state.clientId && normalizedPhone === initialPhone)
  const lookupResult = lookupActive && lookup?.phone === normalizedPhone ? lookup : null
  const lookupLoading = lookupActive && !lookupResult
  useEffect(() => {
    if (!lookupActive || !normalizedPhone) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      api<ClientLookup>(`/crm/clients/lookup?phone=${encodeURIComponent(normalizedPhone)}`, {
        signal: controller.signal,
      })
        .then(({ client }) => {
          setLookup({ phone: normalizedPhone, client })
          setState((current) => ({ ...current, clientId: client?.id ?? null }))
        })
        .catch(() => undefined)
    }, DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [normalizedPhone, lookupActive])

  // Server-side price preview (§5.4): the same code that prices the saved appointment.
  const previewBody = useMemo(
    () => buildPreviewBody(state, { ...options, clientId: state.clientId }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      state.kind,
      state.service,
      state.barber,
      state.extras,
      state.promoCode,
      state.discountType,
      state.discountValue,
      state.discountReason,
      state.clientId,
      locationId,
      isManager,
    ],
  )
  const previewKey = JSON.stringify(previewBody)
  useEffect(() => {
    if (!previewBody) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      api<PricePreview>('/crm/appointments/preview', {
        method: 'POST',
        body: previewBody,
        signal: controller.signal,
      })
        .then((data) => setPreview({ key: previewKey, data, error: null }))
        .catch((caught: unknown) => {
          if ((caught as { name?: string }).name !== 'AbortError')
            setPreview({ key: previewKey, data: null, error: errorText(caught) })
        })
    }, DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey])

  const money = (bani: number) => formatMoney(bani, language)
  const serviceName = (id: string) =>
    services.find((item) => item.id === id)?.name ??
    extras.find((item) => item.id === id)?.name ??
    ''

  const send = async (confirm: boolean) => {
    setBusy(true)
    setError(null)
    setServerFields([])
    try {
      const body =
        mode === 'create'
          ? buildCreateBody(state, options)
          : buildPatchBody(initial, state, options)
      if (mode === 'edit' && Object.keys(body).length === 0) {
        onCancel()
        return
      }
      await api(mode === 'create' ? '/crm/appointments' : `/crm/appointments/${appointmentId}`, {
        method: mode === 'create' ? 'POST' : 'PATCH',
        body: confirm ? { ...body, confirm: true } : body,
      })
      onSaved()
    } catch (caught) {
      const confirmation = caught instanceof CrmApiError ? caught.confirmation : null
      if (confirmation) setPending(confirmation)
      else {
        setPending(null)
        if (caught instanceof CrmApiError) setServerFields(caught.fields)
        setError(errorText(caught))
      }
    } finally {
      setBusy(false)
    }
  }

  const submit = () => {
    setShowIssues(true)
    if (Object.keys(issues).length > 0) return
    void send(false)
  }

  if (pending)
    return (
      <WarningsPanel
        warnings={pending.warnings}
        total={pending.total}
        busy={busy}
        onBack={() => setPending(null)}
        onConfirm={() => void send(true)}
      />
    )

  const issueText = (field: keyof FormState) =>
    showIssues && issues[field] ? t(`errors.${issues[field] as 'required'}`, { min: 1 }) : null
  const fieldError = (field: keyof FormState, text: string | null) =>
    text ? (
      <small className="calendar-modal__error" role="alert">
        {text}
      </small>
    ) : null

  const nameRequired = serverFields.includes('clientFirstName')
  const lookupClient = lookupResult?.client ?? null
  const phoneUnchanged =
    !!state.clientId &&
    normalizedPhone !== null &&
    normalizedPhone === tryNormalizePhone(initial.phone)

  return (
    <form
      className="calendar-modal__form"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
      noValidate
    >
      {mode === 'create' && (
        <div className="calendar-modal__tabs" role="tablist">
          {(['appointment', 'block'] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              role="tab"
              aria-selected={state.kind === kind}
              className={`calendar-modal__tab${state.kind === kind ? ' calendar-modal__tab--active' : ''}`}
              onClick={() => patch({ kind })}
            >
              {t(kind === 'block' ? 'calendar.form.kindBlock' : 'calendar.form.kindAppointment')}
            </button>
          ))}
        </div>
      )}

      <div className="calendar-modal__grid">
        <label className="calendar-modal__field">
          <span>{t('calendar.form.barber')}</span>
          <select
            value={state.barber}
            disabled={barberLocked}
            onChange={(event) => patch({ barber: event.target.value })}
          >
            {barbers.map((barber) => (
              <option key={barber.id} value={barber.id}>
                {barber.name}
              </option>
            ))}
          </select>
          {fieldError('barber', issueText('barber'))}
        </label>
        <label className="calendar-modal__field">
          <span>{t('calendar.form.date')}</span>
          <input
            type="date"
            value={state.date}
            onChange={(event) => patch({ date: event.target.value })}
          />
          {fieldError('date', issueText('date'))}
        </label>
        <label className="calendar-modal__field">
          <span>{t('calendar.form.time')}</span>
          <input
            type="time"
            value={state.time}
            onChange={(event) => patch({ time: event.target.value })}
          />
          {fieldError('time', issueText('time'))}
        </label>
        {isBlock && (
          <label className="calendar-modal__field">
            <span>{t('calendar.form.duration')}</span>
            <input
              type="number"
              min={1}
              step={5}
              inputMode="numeric"
              value={state.duration}
              onChange={(event) => patch({ duration: event.target.value })}
            />
            {fieldError('duration', issueText('duration'))}
          </label>
        )}
      </div>

      {!isBlock && (
        <>
          <label className="calendar-modal__field">
            <span>{t('calendar.form.service')}</span>
            <select
              value={state.service}
              onChange={(event) => {
                const service = event.target.value
                // Keep only the extras that fit the new service.
                const fits = (extra: CatalogExtra) =>
                  extra.appliesTo.length === 0 || extra.appliesTo.includes(service)
                patch({
                  service,
                  extras: state.extras.filter((id) =>
                    extras.some((extra) => extra.id === id && fits(extra)),
                  ),
                })
              }}
            >
              <option value="">{t('calendar.form.servicePlaceholder')}</option>
              {services.map((service) => (
                <option key={service.id} value={service.id}>
                  {service.name} · {money(service.price)}
                </option>
              ))}
            </select>
            {fieldError('service', issueText('service'))}
          </label>

          {fittingExtras.length > 0 && (
            <fieldset className="calendar-modal__field calendar-modal__checks">
              <legend>{t('calendar.form.extras')}</legend>
              {fittingExtras.map((extra) => (
                <label key={extra.id} className="calendar-modal__check">
                  <input
                    type="checkbox"
                    checked={state.extras.includes(extra.id)}
                    onChange={(event) =>
                      patch({
                        extras: event.target.checked
                          ? [...state.extras, extra.id]
                          : state.extras.filter((id) => id !== extra.id),
                      })
                    }
                  />
                  {extra.name} · {money(extra.price)}
                </label>
              ))}
            </fieldset>
          )}

          <fieldset className="calendar-modal__field calendar-modal__client">
            <legend>{t('calendar.modal.client')}</legend>
            <label className="calendar-modal__check">
              <input
                type="checkbox"
                checked={state.withoutName}
                onChange={(event) => patch({ withoutName: event.target.checked })}
              />
              {t('calendar.form.withoutName')}
            </label>
            {!state.withoutName && (
              <>
                <label className="calendar-modal__field">
                  <span>{t('calendar.form.phone')}</span>
                  <input
                    type="tel"
                    inputMode="tel"
                    autoComplete="off"
                    value={state.phone}
                    onChange={(event) => {
                      const phone = event.target.value
                      const same = tryNormalizePhone(phone) === tryNormalizePhone(initial.phone)
                      patch({ phone, clientId: same ? initial.clientId : null })
                    }}
                  />
                  {state.phone.trim() !== '' && !normalizedPhone && (
                    <small className="calendar-modal__error" role="alert">
                      {t('errors.phoneInvalid')}
                    </small>
                  )}
                </label>
                {phoneUnchanged && clientName && (
                  <p className="calendar-modal__hint">
                    {t('calendar.form.clientFound', { name: clientName })}
                  </p>
                )}
                {isManager && lookupLoading && (
                  <p className="calendar-modal__hint">{t('calendar.form.clientSearching')}</p>
                )}
                {lookupClient && (
                  <p className="calendar-modal__hint">
                    {t('calendar.form.clientFound', {
                      name: [lookupClient.firstName, lookupClient.lastName]
                        .filter(Boolean)
                        .join(' '),
                    })}
                    {lookupClient.blocked && (
                      <span className="calendar-modal__warn">
                        {' '}
                        · {t('calendar.form.clientBlocked')}
                      </span>
                    )}
                  </p>
                )}
                {!!normalizedPhone &&
                  !phoneUnchanged &&
                  !lookupClient &&
                  (!isManager || lookupResult !== null) && (
                    <>
                      <p className="calendar-modal__hint">
                        {isManager ? t('calendar.form.clientNew') : t('calendar.form.clientLinked')}
                      </p>
                      <div className="calendar-modal__grid">
                        <label className="calendar-modal__field">
                          <span>{t('calendar.form.firstName')}</span>
                          <input
                            type="text"
                            maxLength={60}
                            value={state.firstName}
                            onChange={(event) => patch({ firstName: event.target.value })}
                          />
                          {nameRequired && fieldError('firstName', t('errors.required'))}
                        </label>
                        <label className="calendar-modal__field">
                          <span>{t('calendar.form.lastName')}</span>
                          <input
                            type="text"
                            maxLength={60}
                            value={state.lastName}
                            onChange={(event) => patch({ lastName: event.target.value })}
                          />
                        </label>
                      </div>
                    </>
                  )}
              </>
            )}
          </fieldset>

          {isManager && (
            <>
              <label className="calendar-modal__field">
                <span>{t('calendar.form.promoCode')}</span>
                <input
                  type="text"
                  autoCapitalize="characters"
                  maxLength={32}
                  value={state.promoCode}
                  onChange={(event) => patch({ promoCode: event.target.value })}
                />
              </label>
              <fieldset className="calendar-modal__field">
                <legend>{t('calendar.form.discount')}</legend>
                <div className="calendar-modal__grid">
                  <label className="calendar-modal__field">
                    <span>{t('calendar.form.discountType')}</span>
                    <select
                      value={state.discountType}
                      onChange={(event) =>
                        patch({ discountType: event.target.value as FormState['discountType'] })
                      }
                    >
                      <option value="amount">{t('calendar.form.discountAmount')}</option>
                      <option value="percent">{t('calendar.form.discountPercent')}</option>
                    </select>
                  </label>
                  <label className="calendar-modal__field">
                    <span>{t('calendar.form.discountValue')}</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={state.discountValue}
                      onChange={(event) => patch({ discountValue: event.target.value })}
                    />
                    {fieldError('discountValue', issueText('discountValue'))}
                  </label>
                </div>
                <label className="calendar-modal__field">
                  <span>{t('calendar.form.discountReason')}</span>
                  <input
                    type="text"
                    maxLength={500}
                    value={state.discountReason}
                    onChange={(event) => patch({ discountReason: event.target.value })}
                  />
                </label>
              </fieldset>
            </>
          )}

          {previewBody && (
            <section className="calendar-modal__section" aria-live="polite">
              <h3>{t('calendar.form.pricePreview')}</h3>
              {preview?.key !== previewKey ? (
                <p className="calendar-modal__muted">{t('calendar.form.priceLoading')}</p>
              ) : preview.error ? (
                <p className="calendar-modal__error" role="alert">
                  {preview.error}
                </p>
              ) : (
                preview.data && (
                  <table className="calendar-modal__price">
                    <tbody>
                      {preview.data.lines.map((line) => (
                        <tr key={`${line.itemType}-${line.item}`}>
                          <td>{serviceName(line.item)}</td>
                          <td>{t('calendar.modal.minutes', { count: line.durationMinutes })}</td>
                          <td>{money(line.price)}</td>
                        </tr>
                      ))}
                      {preview.data.promoDiscount > 0 && (
                        <tr>
                          <td colSpan={2}>
                            {t('calendar.modal.promoDiscount', {
                              code: state.promoCode.trim().toUpperCase(),
                            })}
                          </td>
                          <td>−{money(preview.data.promoDiscount)}</td>
                        </tr>
                      )}
                      {preview.data.manualDiscount > 0 && (
                        <tr>
                          <td colSpan={2}>{t('calendar.modal.manualDiscount')}</td>
                          <td>−{money(preview.data.manualDiscount)}</td>
                        </tr>
                      )}
                      <tr className="calendar-modal__total">
                        <td colSpan={2}>{t('calendar.modal.total')}</td>
                        <td>{money(preview.data.total)}</td>
                      </tr>
                    </tbody>
                  </table>
                )
              )}
            </section>
          )}
        </>
      )}

      <label className="calendar-modal__field">
        <span>{t('calendar.form.clientComment')}</span>
        <textarea
          rows={2}
          maxLength={1000}
          value={state.clientComment}
          onChange={(event) => patch({ clientComment: event.target.value })}
        />
      </label>
      <label className="calendar-modal__field">
        <span>{t('calendar.form.internalNote')}</span>
        <textarea
          rows={2}
          maxLength={1000}
          value={state.internalNote}
          onChange={(event) => patch({ internalNote: event.target.value })}
        />
      </label>

      {error && (
        <p className="calendar-modal__error" role="alert">
          {error}
        </p>
      )}
      <div className="calendar-modal__actions">
        <button type="button" className="calendar__button" disabled={busy} onClick={onCancel}>
          {t('calendar.actions.back')}
        </button>
        <button type="submit" className="calendar__button calendar__button--dark" disabled={busy}>
          {busy
            ? t('calendar.actions.working')
            : t(mode === 'create' ? 'calendar.actions.create' : 'calendar.actions.save')}
        </button>
      </div>
    </form>
  )
}
