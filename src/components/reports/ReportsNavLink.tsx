'use client'
import { useAuth, useConfig } from '@payloadcms/ui'

import type { CrmKey } from '@/i18n'

import { useCrmT } from '../calendar/useCrmT'
import { adminPrefix, CrmNavLink } from '../nav/CrmNavLink'

/** Report links by role (§3.1); the server returns 404 / 403 to everyone else anyway. */
const LINKS: { path: string; id: string; key: CrmKey; roles: string[] }[] = [
  {
    path: '/reports/clients',
    id: 'nav-crm-report-clients',
    key: 'reports.clients.nav',
    roles: ['admin', 'manager'],
  },
  {
    path: '/reports/finance',
    id: 'nav-crm-report-finance',
    key: 'reports.finance.nav',
    roles: ['admin', 'manager'],
  },
  {
    path: '/reports/salary',
    id: 'nav-crm-report-salary',
    key: 'reports.salary.nav',
    roles: ['admin', 'barber'],
  },
]

/** Navigation links to the reports: clients and finance (admin, manager), salary (admin, barber). */
export const ReportsNavLink = () => {
  const { user } = useAuth()
  const { config } = useConfig()
  const t = useCrmT()
  const roles = (user as { roles?: string[] } | null)?.roles ?? []
  const admin = adminPrefix(config.routes.admin)
  const links = LINKS.filter((link) => roles.some((role) => link.roles.includes(role)))
  if (links.length === 0) return null
  return (
    <>
      {links.map((link) => (
        <CrmNavLink
          key={link.path}
          href={`${admin}${link.path}`}
          id={link.id}
          label={t(link.key)}
        />
      ))}
    </>
  )
}
