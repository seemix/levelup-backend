'use client'
import type { CSSProperties } from 'react'

import { isCancelledStatus } from '@/crm/appointment-status'
import { readableTextColor, type BlockPosition, type Lane } from '@/crm/calendar-layout'
import { toLocalTime } from '@/crm/time'

import type { CalendarAppointment } from './types'
import { useCrmT } from './useCrmT'

type Props = {
  appointment: CalendarAppointment
  color: string
  position: BlockPosition
  lane: Lane
  /** Opens the details modal (blocks the user may read only). */
  onOpen: (id: string) => void
}

const CommentIcon = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
    <path
      d="M2 3.5A1.5 1.5 0 0 1 3.5 2h9A1.5 1.5 0 0 1 14 3.5v6A1.5 1.5 0 0 1 12.5 11H7l-3 3v-3h-.5A1.5 1.5 0 0 1 2 9.5z"
      fill="currentColor"
    />
  </svg>
)

const CheckIcon = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
    <path d="M3 8.5l3.2 3.2L13 5" fill="none" stroke="currentColor" strokeWidth="2" />
  </svg>
)

/** Appointment block (A1): barber color, status as icon/style. Time is shown in the salon zone. */
export const AppointmentBlock = ({ appointment, color, position, lane, onOpen }: Props) => {
  const t = useCrmT()
  const start = new Date(appointment.start)
  const end = new Date(appointment.end)
  const range = `${toLocalTime(start)}-${toLocalTime(end)}`
  const style = {
    top: position.top,
    height: position.height,
    left: `${(lane.lane / lane.lanes) * 100}%`,
    width: `${100 / lane.lanes}%`,
    '--block-color': color,
    '--block-text': readableTextColor(color),
  } as CSSProperties

  if ('busy' in appointment) {
    return (
      <div className="calendar-block calendar-block--busy" style={style}>
        <div className="calendar-block__head">{range}</div>
        <div className="calendar-block__body">{t('calendar.busy')}</div>
      </div>
    )
  }

  const isBlock = appointment.kind === 'block'
  const status = appointment.status
  const className = [
    'calendar-block',
    isBlock && 'calendar-block--time-off',
    status === 'completed' && 'calendar-block--completed',
    status === 'no_show' && 'calendar-block--no-show',
    isCancelledStatus(status) && 'calendar-block--cancelled',
  ]
    .filter(Boolean)
    .join(' ')
  const note = appointment.clientComment || appointment.internalNote
  const paid = status === 'paid' || appointment.paymentStatus === 'paid'
  const client = appointment.client
  const clientName = client
    ? [client.firstName, client.lastName].filter(Boolean).join(' ') || t('calendar.noName')
    : t('calendar.noName')
  const extras = appointment.extras.map((item) => item.name)
  const service = [appointment.service?.name, ...extras].filter(Boolean).join(' + ')

  return (
    <div
      className={className}
      style={style}
      role="button"
      tabIndex={0}
      title={`${range} ${isBlock ? '' : clientName}`.trim()}
      onClick={() => onOpen(appointment.id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen(appointment.id)
        }
      }}
    >
      <div className="calendar-block__head">
        <span>{range}</span>
        <span className="calendar-block__icons">
          {note && (
            <span title={t('calendar.hasComment')}>
              <CommentIcon />
            </span>
          )}
          {paid && (
            <span title={t('calendar.paid')}>
              <CheckIcon />
            </span>
          )}
          {status === 'no_show' && <span title={t('calendar.noShow')}>!</span>}
        </span>
      </div>
      <div className="calendar-block__body">
        {isBlock ? (
          <strong>{t('calendar.block')}</strong>
        ) : (
          <>
            <strong>{clientName}</strong>
            {client?.phone && <span> {client.phone}</span>}
            {service && <em className="calendar-block__service">{service}</em>}
          </>
        )}
        {note && <span className="calendar-block__note">{note}</span>}
      </div>
    </div>
  )
}
