'use client'
import { useAuth, useConfig } from '@payloadcms/ui'

import { adminPrefix, CrmNavLink } from '../nav/CrmNavLink'
import { useCrmT } from './useCrmT'

const STAFF_ROLES = ['admin', 'manager', 'barber']

/** Navigation link to the calendar (shown to staff only). The calendar is the admin home page. */
export const CalendarNavLink = () => {
  const { user } = useAuth()
  const { config } = useConfig()
  const t = useCrmT()
  const roles = (user as { roles?: string[] } | null)?.roles ?? []
  if (!roles.some((role) => STAFF_ROLES.includes(role))) return null
  const admin = adminPrefix(config.routes.admin)
  return (
    <CrmNavLink
      alsoActive={[`${admin}/calendar`]}
      href={admin || '/'}
      id="nav-crm-calendar"
      label={t('calendar.nav')}
    />
  )
}
