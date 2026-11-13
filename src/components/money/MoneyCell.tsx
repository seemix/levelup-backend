'use client'
import { useTranslation } from '@payloadcms/ui'
import type { DefaultCellComponentProps } from 'payload'
import { formatMoney, isBani } from '@/crm/money'

/** List-view cell: bani from the database shown as MDL in the admin language. */
export const MoneyCell = ({ cellData }: DefaultCellComponentProps) => {
  const { i18n } = useTranslation()
  return <span>{isBani(cellData) ? formatMoney(cellData, i18n.language) : '—'}</span>
}
