import type {
  CollectionConfig,
  DateFieldValidation,
  FieldHook,
  NumberFieldSingleValidation,
  TextFieldSingleValidation,
} from 'payload'
import { accessFor, fieldAccessFor } from '@/access/policy'
import { isBani } from '@/crm/money'
import { isValidPromoCode, normalizePromoCode, PROMO_CODE_MAX_LENGTH } from '@/crm/promo'
import { outsideTransaction } from '@/crm/read-req'
import { toLocalDate } from '@/crm/time'
import { crmLabel, crmLabels, crmT } from '@/i18n'

const normalizeCode: FieldHook = ({ value }) =>
  typeof value === 'string' ? normalizePromoCode(value) : value

/** Format + uniqueness with a translated message; the unique index is the final guard. */
const validateCode: TextFieldSingleValidation = async (value, { id, req }) => {
  const code = normalizePromoCode(value ?? '')
  if (!code) return crmT(req.t, 'errors.required')
  if (!isValidPromoCode(code))
    return crmT(req.t, 'errors.promoCodeInvalid', { max: PROMO_CODE_MAX_LENGTH })
  const { totalDocs } = await req.payload.count({
    collection: 'promo-codes',
    where: {
      and: [{ code: { equals: code } }, ...(id === undefined ? [] : [{ id: { not_equals: id } }])],
    },
    req: outsideTransaction(req),
  })
  return totalDocs > 0 ? crmT(req.t, 'errors.promoCodeTaken') : true
}

/** Percent: whole 1–100; fixed: bani ≥ 1 (spec §4.16). */
const validateValue: NumberFieldSingleValidation = (value, { siblingData, req: { t } }) => {
  if (value === null || value === undefined) return crmT(t, 'errors.required')
  const type = (siblingData as { discountType?: string }).discountType
  if (type === 'fixed')
    return isBani(value) && value >= 1 ? true : crmT(t, 'errors.promoAmountInvalid')
  return Number.isInteger(value) && value >= 1 && value <= 100
    ? true
    : crmT(t, 'errors.promoPercentInvalid')
}

/** "Until" must not be earlier than "from", compared as local days. */
const validateValidTo: DateFieldValidation = (value, { siblingData, req: { t } }) => {
  const from = (siblingData as { validFrom?: string | Date | null }).validFrom
  if (!value || !from) return true
  return toLocalDate(new Date(value)) >= toLocalDate(new Date(from))
    ? true
    : crmT(t, 'errors.dateRangeInvalid')
}

const limitValidate: NumberFieldSingleValidation = (value, { req: { t } }) =>
  value === null || value === undefined || (Number.isInteger(value) && value >= 1)
    ? true
    : crmT(t, 'errors.integerRequired')

const dayOnly = { date: { pickerAppearance: 'dayOnly' as const, displayFormat: 'dd.MM.yyyy' } }

export const PromoCodes: CollectionConfig = {
  slug: 'promo-codes',
  labels: {
    singular: crmLabel('promoCodes.singular'),
    plural: crmLabel('promoCodes.plural'),
  },
  access: {
    read: accessFor('read', 'promo-codes'),
    create: accessFor('create', 'promo-codes'),
    update: accessFor('update', 'promo-codes'),
    delete: accessFor('delete', 'promo-codes'),
  },
  admin: {
    useAsTitle: 'code',
    group: crmLabels('groups.promotions'),
    defaultColumns: ['code', 'discountType', 'value', 'validTo', 'usedCount', 'active'],
    listSearchableFields: ['code', 'description'],
  },
  fields: [
    {
      name: 'code',
      type: 'text',
      required: true,
      unique: true,
      maxLength: PROMO_CODE_MAX_LENGTH,
      label: crmLabel('promoCodes.code'),
      admin: { description: crmLabel('promoCodes.codeDescription') },
      hooks: { beforeValidate: [normalizeCode] },
      validate: validateCode,
    },
    {
      name: 'description',
      type: 'textarea',
      label: crmLabel('promoCodes.description'),
    },
    {
      type: 'row',
      fields: [
        {
          name: 'discountType',
          type: 'select',
          required: true,
          defaultValue: 'percent',
          label: crmLabel('promoCodes.discountType'),
          admin: { width: '50%' },
          options: [
            { value: 'percent', label: crmLabel('promoCodes.discountTypes.percent') },
            { value: 'fixed', label: crmLabel('promoCodes.discountTypes.fixed') },
          ],
        },
        {
          name: 'value',
          type: 'number',
          required: true,
          min: 1,
          label: crmLabel('promoCodes.value'),
          admin: {
            width: '50%',
            description: crmLabel('promoCodes.valueDescription'),
            components: {
              Field: '@/components/promo/PromoValueField#PromoValueField',
              Cell: '@/components/promo/PromoValueCell#PromoValueCell',
            },
          },
          validate: validateValue,
        },
      ],
    },
    {
      type: 'row',
      fields: [
        {
          name: 'validFrom',
          type: 'date',
          label: crmLabel('promoCodes.validFrom'),
          admin: { ...dayOnly, width: '50%', description: crmLabel('promoCodes.validDescription') },
        },
        {
          name: 'validTo',
          type: 'date',
          label: crmLabel('promoCodes.validTo'),
          admin: { ...dayOnly, width: '50%', description: crmLabel('promoCodes.validDescription') },
          validate: validateValidTo,
        },
      ],
    },
    {
      type: 'row',
      fields: [
        {
          name: 'maxUses',
          type: 'number',
          min: 1,
          label: crmLabel('promoCodes.maxUses'),
          admin: { width: '50%', description: crmLabel('promoCodes.limitDescription') },
          validate: limitValidate,
        },
        {
          name: 'maxUsesPerClient',
          type: 'number',
          min: 1,
          label: crmLabel('promoCodes.maxUsesPerClient'),
          admin: { width: '50%', description: crmLabel('promoCodes.limitDescription') },
          validate: limitValidate,
        },
      ],
    },
    {
      name: 'appliesToServices',
      type: 'relationship',
      relationTo: 'services',
      hasMany: true,
      label: crmLabel('promoCodes.appliesToServices'),
      admin: { description: crmLabel('promoCodes.appliesToDescription') },
    },
    {
      name: 'appliesToExtras',
      type: 'relationship',
      relationTo: 'extras',
      hasMany: true,
      label: crmLabel('promoCodes.appliesToExtras'),
      admin: { description: crmLabel('promoCodes.appliesToDescription') },
    },
    {
      name: 'active',
      type: 'checkbox',
      defaultValue: true,
      index: true,
      label: crmLabel('promoCodes.active'),
      admin: { position: 'sidebar' },
    },
    {
      name: 'onlineAllowed',
      type: 'checkbox',
      defaultValue: true,
      label: crmLabel('promoCodes.onlineAllowed'),
      admin: { position: 'sidebar' },
    },
    {
      // Maintained by the appointments service with `$inc` in the booking transaction (spec §5.5).
      name: 'usedCount',
      type: 'number',
      defaultValue: 0,
      label: crmLabel('promoCodes.usedCount'),
      access: {
        read: fieldAccessFor('read', 'promo-codes.usage'),
        create: fieldAccessFor('create', 'promo-codes.usage'),
        update: fieldAccessFor('update', 'promo-codes.usage'),
      },
      admin: { position: 'sidebar', readOnly: true },
    },
  ],
}
