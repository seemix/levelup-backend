'use client'
import { useAuth, useConfig } from '@payloadcms/ui'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { useCrmT } from '../calendar/useCrmT'

const REPORT_ROLES = ['admin', 'manager']

/** Navigation link to «Reports → Clients» (admin and manager; the server returns 404 to others). */
export const ReportsNavLink = () => {
  const { user } = useAuth()
  const { config } = useConfig()
  const t = useCrmT()
  const pathname = usePathname()
  const roles = (user as { roles?: string[] } | null)?.roles ?? []
  if (!roles.some((role) => REPORT_ROLES.includes(role))) return null
  const href = `${config.routes.admin === '/' ? '' : config.routes.admin}/reports/clients`
  return (
    <Link
      className={`calendar-nav-link${pathname === href ? ' calendar-nav-link--active' : ''}`}
      href={href}
    >
      {t('reports.clients.nav')}
    </Link>
  )
}
