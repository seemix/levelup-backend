'use client'
import { useAuth, useConfig } from '@payloadcms/ui'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

import type { CrmKey } from '@/i18n'

import { useCrmT } from '../calendar/useCrmT'

/** Report links by role (§3.1); the server returns 404 / 403 to everyone else anyway. */
const LINKS: { path: string; key: CrmKey; roles: string[] }[] = [
  { path: '/reports/clients', key: 'reports.clients.nav', roles: ['admin', 'manager'] },
  { path: '/reports/finance', key: 'reports.finance.nav', roles: ['admin', 'manager'] },
  { path: '/reports/salary', key: 'reports.salary.nav', roles: ['admin', 'barber'] },
]

/** Navigation links to the reports: clients and finance (admin, manager), salary (admin, barber). */
export const ReportsNavLink = () => {
  const { user } = useAuth()
  const { config } = useConfig()
  const t = useCrmT()
  const pathname = usePathname()
  const roles = (user as { roles?: string[] } | null)?.roles ?? []
  const admin = config.routes.admin === '/' ? '' : config.routes.admin
  const links = LINKS.filter((link) => roles.some((role) => link.roles.includes(role)))
  if (links.length === 0) return null
  return (
    <>
      {links.map((link) => {
        const href = `${admin}${link.path}`
        return (
          <Link
            key={link.path}
            className={`calendar-nav-link${pathname === href ? ' calendar-nav-link--active' : ''}`}
            href={href}
          >
            {t(link.key)}
          </Link>
        )
      })}
    </>
  )
}
