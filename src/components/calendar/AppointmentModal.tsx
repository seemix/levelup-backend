'use client'
import { useAuth } from '@payloadcms/ui'
import { useEffect, useMemo, useState } from 'react'

import { emptyForm, type FormState } from '@/crm/appointment-form'
import { baniToLeiText } from '@/crm/money'
import { toLocalDate, toLocalTime } from '@/crm/time'

import { useCrmApi, useErrorText, useLanguage, type AppointmentDetail } from './api'
import { AppointmentDetails } from './AppointmentDetails'
import { AppointmentForm } from './AppointmentForm'
import { Modal } from './Modal'
import { PaymentTab } from './PaymentTab'
import type { CalendarData } from './types'
import { useCatalog } from './useCatalog'
import { useCrmT } from './useCrmT'

export type ModalTarget =
  { type: 'view'; id: string } | { type: 'create'; barberId: string; start: Date }

type Props = {
  target: ModalTarget
  data: CalendarData
  /** Role `admin` or `manager`: client lookup, promo code, manual discount. */
  isManager: boolean
  onClose: () => void
  /** The calendar data changed on the server: reload it. */
  onChanged: () => void
}

/** Form state of an existing appointment (edit mode). */
const formFromDetail = (detail: AppointmentDetail): FormState => {
  const { appointment: a } = detail
  const start = new Date(a.start)
  return emptyForm({
    kind: a.kind,
    barber: a.barber ?? '',
    date: toLocalDate(start),
    time: toLocalTime(start),
    duration: String(a.durationMinutes),
    service: a.service?.id ?? '',
    extras: a.extras.map((extra) => extra.id),
    clientId: a.client?.id ?? null,
    phone: a.client?.phone ?? '',
    withoutName: a.kind === 'appointment' && !a.client,
    promoCode: detail.promoCode ?? '',
    discountType: a.manualDiscountType === 'percent' ? 'percent' : 'amount',
    discountValue:
      a.manualDiscountValue === null || a.manualDiscountValue === 0
        ? ''
        : a.manualDiscountType === 'percent'
          ? String(a.manualDiscountValue)
          : baniToLeiText(a.manualDiscountValue),
    discountReason: a.manualDiscountReason ?? '',
    clientComment: a.clientComment ?? '',
    internalNote: a.internalNote ?? '',
  })
}

/** Modal of the calendar: appointment details with actions, or the create/edit form (stage 15). */
export const AppointmentModal = ({ target, data, isManager, onClose, onChanged }: Props) => {
  const t = useCrmT()
  const api = useCrmApi()
  const language = useLanguage()
  const errorText = useErrorText()
  const { catalog, failed } = useCatalog(language)
  const { user } = useAuth()
  // Convenience only: the refund endpoint checks the role itself.
  const isAdmin = ((user as { roles?: string[] } | null)?.roles ?? []).includes('admin')
  const [editing, setEditing] = useState(false)
  const [tab, setTab] = useState<'details' | 'payment'>('details')
  const [notice, setNotice] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const [loaded, setLoaded] = useState<{
    key: string
    detail: AppointmentDetail | null
    error: string | null
  } | null>(null)

  const viewId = target.type === 'view' ? target.id : null
  const key = `${viewId}|${reload}|${language}`
  useEffect(() => {
    if (!viewId) return
    const controller = new AbortController()
    api<AppointmentDetail>(`/crm/appointments/${viewId}?locale=${language}`, {
      signal: controller.signal,
    })
      .then((detail) => setLoaded({ key, detail, error: null }))
      .catch((caught: unknown) => {
        if ((caught as { name?: string }).name !== 'AbortError')
          setLoaded({ key, detail: null, error: errorText(caught) })
      })
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, api, viewId, language])

  const barbers = useMemo(() => {
    const seen = new Map<string, { id: string; name: string; own: boolean; active: boolean }>()
    for (const column of data.columns) seen.set(column.barber.id, column.barber)
    return [...seen.values()]
  }, [data.columns])
  const own = barbers.find((barber) => barber.own)
  // A barber works in their own column only (decision 37); admin/manager pick any active barber.
  const barberLocked = !isManager && !!own
  const selectable = (currentId?: string | null) =>
    barberLocked
      ? barbers.filter((barber) => barber.own)
      : barbers.filter((barber) => barber.active || barber.id === currentId)

  const detail = loaded?.key === key ? loaded.detail : null
  const loadError = loaded?.key === key ? loaded.error : null

  const reloadAll = () => {
    onChanged()
    setReload((value) => value + 1)
  }

  if (target.type === 'create') {
    const initial = emptyForm({
      barber: target.barberId,
      date: toLocalDate(target.start),
      time: toLocalTime(target.start),
    })
    return (
      <Modal title={t('calendar.modal.titleNew')} onClose={onClose}>
        {catalog ? (
          <AppointmentForm
            mode="create"
            initial={initial}
            locationId={data.location}
            barbers={selectable(target.barberId)}
            barberLocked={barberLocked}
            isManager={isManager}
            services={catalog.services}
            extras={catalog.extras}
            onCancel={onClose}
            onSaved={() => {
              onChanged()
              onClose()
            }}
          />
        ) : (
          <p className="calendar-modal__muted">
            {failed ? t('calendar.loadError') : t('calendar.loading')}
          </p>
        )}
      </Modal>
    )
  }

  const title = editing
    ? t('calendar.modal.titleEdit')
    : detail?.appointment.kind === 'block'
      ? t('calendar.modal.titleBlock')
      : t('calendar.modal.titleAppointment')

  return (
    <Modal title={title} onClose={onClose}>
      {loadError ? (
        <p className="calendar-modal__error" role="alert">
          {t('calendar.modal.loadError')}: {loadError}
        </p>
      ) : !detail ? (
        <p className="calendar-modal__muted">{t('calendar.loading')}</p>
      ) : editing ? (
        catalog ? (
          <AppointmentForm
            mode="edit"
            appointmentId={detail.appointment.id}
            initial={formFromDetail(detail)}
            locationId={detail.appointment.location ?? data.location}
            barbers={selectable(detail.appointment.barber)}
            barberLocked={barberLocked}
            isManager={isManager}
            services={catalog.services}
            extras={catalog.extras}
            clientName={
              detail.appointment.client
                ? [detail.appointment.client.firstName, detail.appointment.client.lastName]
                    .filter(Boolean)
                    .join(' ')
                : null
            }
            onCancel={() => setEditing(false)}
            onSaved={() => {
              setEditing(false)
              reloadAll()
            }}
          />
        ) : (
          <p className="calendar-modal__muted">
            {failed ? t('calendar.loadError') : t('calendar.loading')}
          </p>
        )
      ) : (
        <>
          {detail.appointment.kind === 'appointment' && (
            <div className="calendar-modal__tabs" role="tablist">
              {(['details', 'payment'] as const).map((id) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={tab === id}
                  className={`calendar-modal__tab${tab === id ? ' calendar-modal__tab--active' : ''}`}
                  onClick={() => {
                    setTab(id)
                    setNotice(null)
                  }}
                >
                  {t(id === 'details' ? 'calendar.modal.tabDetails' : 'calendar.modal.tabPayment')}
                </button>
              ))}
            </div>
          )}
          {notice && (
            <p className="calendar-modal__notice" role="status">
              {notice}
            </p>
          )}
          {tab === 'payment' && detail.appointment.kind === 'appointment' ? (
            <PaymentTab
              detail={detail}
              isAdmin={isAdmin}
              onChanged={reloadAll}
              onNotice={setNotice}
            />
          ) : (
            <AppointmentDetails
              detail={detail}
              barberName={
                barbers.find((barber) => barber.id === detail.appointment.barber)?.name ?? ''
              }
              onEdit={() => setEditing(true)}
              onChanged={reloadAll}
            />
          )}
        </>
      )}
    </Modal>
  )
}
