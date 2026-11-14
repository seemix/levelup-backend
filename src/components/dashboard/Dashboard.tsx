import { DefaultDashboard, type DashboardViewServerProps } from '@payloadcms/next/views'
import { Gutter } from '@payloadcms/ui'

import { allowed } from '@/access/policy'

import { CalendarClient } from '../calendar/CalendarClient'

/**
 * Admin home page: staff (admin, manager, barber) land on the appointment calendar;
 * everyone else (editor) keeps Payload's default dashboard with collection cards.
 * Rendered inside Payload's DefaultTemplate, so no template wrapper here.
 */
export const Dashboard = (props: DashboardViewServerProps) => {
  const user = props.initPageResult.req.user
  if (!allowed(user, 'read', 'calendar')) return <DefaultDashboard {...props} />
  return (
    <Gutter className="crm-gutter">
      <CalendarClient />
    </Gutter>
  )
}
