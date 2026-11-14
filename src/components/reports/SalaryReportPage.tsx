import { DefaultTemplate } from '@payloadcms/next/templates'
import { Gutter } from '@payloadcms/ui'
import { notFound } from 'next/navigation'
import type { AdminViewServerProps } from 'payload'

import { allowed } from '@/access/policy'

import { SalaryReportClient } from './SalaryReportClient'

/** Admin view `/reports/salary`: admin and barbers — a barber sees their own salary (a manager and anonymous users get 404). */
export const SalaryReportPage = ({
  initPageResult,
  params,
  searchParams,
}: AdminViewServerProps) => {
  const { req, locale, permissions, visibleEntities } = initPageResult
  if (!allowed(req.user, 'read', 'reports.salary')) notFound()
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
        <SalaryReportClient />
      </Gutter>
    </DefaultTemplate>
  )
}
