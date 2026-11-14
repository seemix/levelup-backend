'use client'
import { useAuth, useConfig, useTranslation } from '@payloadcms/ui'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { formatDateTime } from '@/crm/time'

import { useCrmT } from '../calendar/useCrmT'

/** Window event: new appointments arrived — an open calendar reloads itself. */
export const APPOINTMENTS_CREATED_EVENT = 'crm:appointments-created'

const STAFF_ROLES = ['admin', 'manager', 'barber']
const POLL_MS = 20_000
/** The next request overlaps the previous one a little; duplicates are dropped by id. */
const OVERLAP_MS = 10_000
const TOAST_MS = 20_000
const MAX_TOASTS = 5

type Item = { id: string; start: string; client: string; barber: string; source: string | null }
type Toast = Item & { key: number }

/** Short beep; browsers may block audio before the first click on the page — then it is silent. */
const beep = () => {
  try {
    const Context =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Context) return
    const context = new Context()
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.type = 'sine'
    oscillator.frequency.value = 880
    gain.gain.setValueAtTime(0.15, context.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.35)
    oscillator.connect(gain)
    gain.connect(context.destination)
    oscillator.start()
    oscillator.stop(context.currentTime + 0.35)
    oscillator.onended = () => void context.close()
  } catch {
    // no sound — the toast is still shown
  }
}

/**
 * Notifications about new appointments while the admin panel is open (staff only): polls
 * `/api/crm/new-appointments`, shows a toast with a beep and tells an open calendar to reload.
 * Appointments the user created themselves are not reported; polling pauses in a hidden tab.
 */
export const NewAppointmentNotifier = () => {
  const { user } = useAuth()
  const { config } = useConfig()
  const { i18n } = useTranslation()
  const t = useCrmT()
  const [toasts, setToasts] = useState<Toast[]>([])
  const cursor = useRef<string | null>(null)
  const seen = useRef(new Set<string>())
  const counter = useRef(0)
  const isStaff = ((user as { roles?: string[] } | null)?.roles ?? []).some((role) =>
    STAFF_ROLES.includes(role),
  )
  const userId = (user as { id?: string | number } | null)?.id
  const api = config.routes.api

  useEffect(() => {
    if (!isStaff) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const controller = new AbortController()

    const poll = async () => {
      if (stopped) return
      if (!document.hidden) {
        try {
          const since = cursor.current
          const response = await fetch(
            `${api}/crm/new-appointments${since ? `?since=${encodeURIComponent(since)}` : ''}`,
            { credentials: 'include', signal: controller.signal },
          )
          if (response.ok) {
            const body = (await response.json()) as { now: string; items: Item[] }
            cursor.current = new Date(new Date(body.now).getTime() - OVERLAP_MS).toISOString()
            const fresh = body.items.filter((item) => !seen.current.has(item.id))
            for (const item of fresh) seen.current.add(item.id)
            if (fresh.length > 0) {
              setToasts((current) =>
                [...current, ...fresh.map((item) => ({ ...item, key: ++counter.current }))].slice(
                  -MAX_TOASTS,
                ),
              )
              beep()
              window.dispatchEvent(new CustomEvent(APPOINTMENTS_CREATED_EVENT))
            }
          }
        } catch {
          // network hiccup or abort: try again on the next tick
        }
      }
      if (!stopped) timer = setTimeout(() => void poll(), POLL_MS)
    }
    void poll()
    return () => {
      stopped = true
      controller.abort()
      if (timer) clearTimeout(timer)
    }
  }, [isStaff, api, userId])

  // Toasts disappear by themselves.
  useEffect(() => {
    if (toasts.length === 0) return
    const timer = setTimeout(() => setToasts((current) => current.slice(1)), TOAST_MS)
    return () => clearTimeout(timer)
  }, [toasts])

  if (!isStaff || toasts.length === 0) return null
  return createPortal(
    <div className="crm-notifications" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div className="crm-notifications__toast" key={toast.key}>
          <div className="crm-notifications__body">
            <strong>
              {t('notifications.newAppointment')}
              {toast.source === 'online' ? ` · ${t('notifications.online')}` : ''}
            </strong>
            <span>
              {t('notifications.line', {
                client: toast.client || '—',
                barber: toast.barber || '—',
                when: formatDateTime(new Date(toast.start), i18n.language),
              })}
            </span>
          </div>
          <button
            type="button"
            className="crm-notifications__close"
            aria-label={t('notifications.close')}
            onClick={() => setToasts((current) => current.filter((item) => item.key !== toast.key))}
          >
            ×
          </button>
        </div>
      ))}
    </div>,
    document.body,
  )
}
