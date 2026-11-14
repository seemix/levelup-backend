import { DefaultTemplate } from '@payloadcms/next/templates'
import { Gutter } from '@payloadcms/ui'
import { notFound } from 'next/navigation'
import type { AdminViewServerProps } from 'payload'

import { allowed } from '@/access/policy'

import { ClientsReportClient } from './ClientsReportClient'

/** Admin view `/reports/clients`: admin and manager only (a barber and anonymous users get 404). */
export const ClientsReportPage = ({
  initPageResult,
  params,
  searchParams,
}: AdminViewServerProps) => {
  const { req, locale, permissions, visibleEntities } = initPageResult
  if (!allowed(req.user, 'read', 'reports.clients')) notFound()
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
      <Gutter>
        <ClientsReportClient />
      </Gutter>
    </DefaultTemplate>
  )
}
