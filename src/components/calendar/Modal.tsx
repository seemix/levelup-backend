'use client'
import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { useCrmT } from './useCrmT'

type Props = {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}

/** Dialog shell: a centered card on desktop, full screen on a phone (see `calendar-modal` styles). */
export const Modal = ({ title, onClose, children, footer }: Props) => {
  const t = useCrmT()
  const card = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    card.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
      previous?.focus?.()
    }
  }, [onClose])

  return createPortal(
    <div
      className="calendar-modal"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        className="calendar-modal__card"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={card}
      >
        <header className="calendar-modal__header">
          <h2 className="calendar-modal__title">{title}</h2>
          <button
            type="button"
            className="calendar__icon-button"
            aria-label={t('calendar.modal.close')}
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <div className="calendar-modal__body">{children}</div>
        {footer && <footer className="calendar-modal__footer">{footer}</footer>}
      </div>
    </div>,
    document.body,
  )
}
