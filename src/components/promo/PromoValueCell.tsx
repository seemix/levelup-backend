'use client'
import { useTranslation } from '@payloadcms/ui'
import type { DefaultCellComponentProps } from 'payload'
import { formatMoney, isBani } from '@/crm/money'

/** List-view cell of `promo-codes.value`: "10 %" or the fixed amount in MDL. */
export const PromoValueCell = ({ cellData, rowData }: DefaultCellComponentProps) => {
  const { i18n } = useTranslation()
  if (!isBani(cellData)) return <span>—</span>
  const fixed = (rowData as { discountType?: string } | undefined)?.discountType === 'fixed'
  return <span>{fixed ? formatMoney(cellData, i18n.language) : `${cellData} %`}</span>
}
