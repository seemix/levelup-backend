'use client'
import { useTranslation } from '@payloadcms/ui'

import type { CrmKey } from '@/i18n'

/** Typed `t` of the `crm` namespace for client components: `t('calendar.today')`. */
export const useCrmT = () => {
  const { t } = useTranslation()
  return (key: CrmKey, options?: Record<string, unknown>) =>
    (t as unknown as (key: string, options?: Record<string, unknown>) => string)(
      `crm:${key}`,
      options,
    )
}
