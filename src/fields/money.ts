import type { NumberField, NumberFieldSingleValidation } from 'payload'
import { isBani } from '@/crm/money'
import { crmLabel, crmT, type CrmKey } from '@/i18n'

type MoneyFieldOptions = {
  name: string
  label: CrmKey
  required?: boolean
}

/**
 * Money amount: the admin edits and sees lei (MDL), the database stores integer bani
 * (spec §2.1). Edit/display conversion lives in the `MoneyField`/`MoneyCell` admin components,
 * which use `src/crm/money.ts`; the server only ever sees bani.
 */
export const moneyField = ({ name, label, required = true }: MoneyFieldOptions): NumberField => ({
  name,
  type: 'number',
  required,
  min: 0,
  label: crmLabel(label),
  admin: {
    description: crmLabel('fields.moneyDescription'),
    components: {
      Field: '@/components/money/MoneyField#MoneyField',
      Cell: '@/components/money/MoneyCell#MoneyCell',
    },
  },
  validate: ((value, { req: { t } }) => {
    if (value === null || value === undefined) return required ? crmT(t, 'errors.required') : true
    return isBani(value) && value >= 0 ? true : crmT(t, 'errors.priceInvalid')
  }) satisfies NumberFieldSingleValidation,
})

/** Duration in minutes: a whole number ≥ `min`, optionally a multiple of `step`. */
export const durationField = (options: {
  name?: string
  label: CrmKey
  description?: CrmKey
  min: number
  step?: number
}): NumberField => {
  const { name = 'durationMinutes', label, description, min, step } = options
  return {
    name,
    type: 'number',
    required: true,
    min,
    label: crmLabel(label),
    admin: description ? { description: crmLabel(description) } : undefined,
    validate: ((value, { req: { t } }) => {
      if (value === null || value === undefined) return crmT(t, 'errors.required')
      if (!Number.isInteger(value) || value < min) return crmT(t, 'errors.durationInvalid', { min })
      if (step && value % step !== 0) return crmT(t, 'errors.durationStep', { step })
      return true
    }) satisfies NumberFieldSingleValidation,
  }
}
