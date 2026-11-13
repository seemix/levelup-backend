'use client'
import { isCancelledStatus } from '@/crm/appointment-status'

import type { CalendarColumn } from './types'
import { useCrmT } from './useCrmT'

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('')

/** Column header: avatar, name, position, number of (not cancelled) appointments. */
export const ColumnHeader = ({ column }: { column: CalendarColumn }) => {
  const t = useCrmT()
  const { barber } = column
  const count = column.appointments.filter(
    (item) => 'busy' in item || !isCancelledStatus(item.status),
  ).length
  return (
    <div
      className={`calendar-head${barber.own ? ' calendar-head--own' : ''}`}
      title={barber.own ? t('calendar.own') : undefined}
    >
      {barber.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="calendar-head__avatar" src={barber.image} alt="" />
      ) : (
        <span className="calendar-head__avatar calendar-head__avatar--empty" aria-hidden="true">
          {initials(barber.name)}
        </span>
      )}
      <span className="calendar-head__text">
        <span className="calendar-head__name">{barber.name}</span>
        {barber.position && <span className="calendar-head__position">{barber.position}</span>}
      </span>
      {count > 0 && (
        <span className="calendar-head__count" title={t('calendar.appointmentsCount', { count })}>
          {count}
        </span>
      )}
    </div>
  )
}
