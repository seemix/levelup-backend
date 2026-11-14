'use client'
import { useAuth, useConfig } from '@payloadcms/ui'

import { useCrmT } from '../calendar/useCrmT'
import { adminPrefix, CrmNavLink } from '../nav/CrmNavLink'

const STAFF_ROLES = ['admin', 'manager', 'barber']

/** Navigation link to the schedule roster (staff; the server returns 404 to others). */
export const ScheduleNavLink = () => {
  const { user } = useAuth()
  const { config } = useConfig()
  const t = useCrmT()
  const roles = (user as { roles?: string[] } | null)?.roles ?? []
  if (!roles.some((role) => STAFF_ROLES.includes(role))) return null
  return (
    <CrmNavLink
      href={`${adminPrefix(config.routes.admin)}/schedule`}
      id="nav-crm-schedule"
      label={t('roster.nav')}
    />
  )
}
