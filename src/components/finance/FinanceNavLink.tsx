'use client'
import { useAuth, useConfig } from '@payloadcms/ui'

import { useCrmT } from '../calendar/useCrmT'
import { adminPrefix, CrmNavLink } from '../nav/CrmNavLink'

const FINANCE_ROLES = ['admin', 'manager']

/** Navigation link to «Cash registers» (admin and manager; the server returns 404 to others). */
export const FinanceNavLink = () => {
  const { user } = useAuth()
  const { config } = useConfig()
  const t = useCrmT()
  const roles = (user as { roles?: string[] } | null)?.roles ?? []
  if (!roles.some((role) => FINANCE_ROLES.includes(role))) return null
  return (
    <CrmNavLink
      href={`${adminPrefix(config.routes.admin)}/cash`}
      id="nav-crm-cash"
      label={t('finance.nav')}
    />
  )
}
