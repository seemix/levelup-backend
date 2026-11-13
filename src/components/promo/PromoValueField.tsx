'use client'
import { NumberField, useFormFields } from '@payloadcms/ui'
import type { NumberFieldClientComponent } from 'payload'
import { MoneyField } from '@/components/money/MoneyField'

/**
 * `promo-codes.value`: lei input (stored as bani) for a fixed amount, a plain number for a percent.
 * Reads the sibling `discountType` from the form.
 */
export const PromoValueField: NumberFieldClientComponent = (props) => {
  const typePath = props.path.replace(/value$/, 'discountType')
  const discountType = useFormFields(([fields]) => fields[typePath]?.value)
  return discountType === 'fixed' ? <MoneyField {...props} /> : <NumberField {...props} />
}
