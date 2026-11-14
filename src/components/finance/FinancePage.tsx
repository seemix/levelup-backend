import { DefaultTemplate } from '@payloadcms/next/templates'
import { Gutter } from '@payloadcms/ui'
import { notFound } from 'next/navigation'
import type { AdminViewServerProps } from 'payload'

import { allowed } from '@/access/policy'

import { FinanceClient } from './FinanceClient'

/** Admin view `/cash`: admin and manager only (a barber and anonymous users get 404). */
export const FinancePage = ({ initPageResult, params, searchParams }: AdminViewServerProps) => {
  const { req, locale, permissions, visibleEntities } = initPageResult
  if (!allowed(req.user, 'read', 'finance')) notFound()
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
        <FinanceClient />
      </Gutter>
    </DefaultTemplate>
  )
}
