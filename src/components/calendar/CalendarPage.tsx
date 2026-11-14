import { DefaultTemplate } from '@payloadcms/next/templates'
import { Gutter } from '@payloadcms/ui'
import { notFound } from 'next/navigation'
import type { AdminViewServerProps } from 'payload'

import { allowed } from '@/access/policy'

import { CalendarClient } from './CalendarClient'

/** Admin view `/calendar`: staff only (editors and anonymous users get 404). */
export const CalendarPage = ({ initPageResult, params, searchParams }: AdminViewServerProps) => {
  const { req, locale, permissions, visibleEntities } = initPageResult
  if (!allowed(req.user, 'read', 'calendar')) notFound()
  return (
    <DefaultTemplate
      i18n={req.i18n}
      locale={locale}
      params={params}
      payload={req.payload}
      permissions={permissions}
      searchParams={searchParams}
      user={req.user ?? undefined}
      visibleEntities={visibleEntities}
    >
      <Gutter className="crm-gutter">
        <CalendarClient />
      </Gutter>
    </DefaultTemplate>
  )
}
