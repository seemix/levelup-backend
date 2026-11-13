'use client'
import { useAuth, useConfig } from '@payloadcms/ui'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { useCrmT } from './useCrmT'

const STAFF_ROLES = ['admin', 'manager', 'barber']

/** Navigation link to the calendar (shown to staff only). */
export const CalendarNavLink = () => {
  const { user } = useAuth()
  const { config } = useConfig()
  const t = useCrmT()
  const pathname = usePathname()
  const roles = (user as { roles?: string[] } | null)?.roles ?? []
  if (!roles.some((role) => STAFF_ROLES.includes(role))) return null
  const href = `${config.routes.admin === '/' ? '' : config.routes.admin}/calendar`
  return (
    <Link
      className={`calendar-nav-link${pathname === href ? ' calendar-nav-link--active' : ''}`}
      href={href}
    >
      {t('calendar.nav')}
    </Link>
  )
}
