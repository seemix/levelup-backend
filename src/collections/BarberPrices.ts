import type { CollectionConfig, NumberField, RelationshipFieldSingleValidation } from 'payload'
import { accessFor } from '@/access/policy'
import { outsideTransaction } from '@/crm/read-req'
import { relationId, type RelationValue } from '@/crm/schedule'
import { moneyField } from '@/fields/money'
import { crmLabel, crmLabels, crmT } from '@/i18n'

type ItemValue = { relationTo?: 'services' | 'extras'; value?: RelationValue } | null | undefined

/** Optional duration override: services — > 0 and a multiple of 5, extras — ≥ 0 (spec §4.7, §4.8). */
const durationOverride: NumberField = {
  name: 'durationMinutes',
  type: 'number',
  min: 0,
  label: crmLabel('barberPrices.durationMinutes'),
  admin: { description: crmLabel('barberPrices.durationDescription'), width: '50%' },
  validate: (value: number | null | undefined, { siblingData, req: { t } }) => {
    if (value === null || value === undefined) return true
    const isService = (siblingData as { item?: ItemValue }).item?.relationTo !== 'extras'
    const min = isService ? 5 : 0
    if (!Number.isInteger(value) || value < min) return crmT(t, 'errors.durationInvalid', { min })
    if (isService && value % 5 !== 0) return crmT(t, 'errors.durationStep', { step: 5 })
    return true
  },
}

export const BarberPrices: CollectionConfig = {
  slug: 'barber-prices',
  labels: {
    singular: crmLabel('barberPrices.singular'),
    plural: crmLabel('barberPrices.plural'),
  },
  access: {
    read: accessFor('read', 'barber-prices'),
    create: accessFor('create', 'barber-prices'),
    update: accessFor('update', 'barber-prices'),
    delete: accessFor('delete', 'barber-prices'),
  },
  admin: {
    group: crmLabels('groups.barbers'),
    defaultColumns: ['barber', 'item', 'price', 'durationMinutes'],
  },
  fields: [
    {
      name: 'barber',
      type: 'relationship',
      relationTo: 'barbers',
      required: true,
      index: true,
      label: crmLabel('barberPrices.barber'),
    },
    {
      name: 'item',
      type: 'relationship',
      relationTo: ['services', 'extras'],
      required: true,
      label: crmLabel('barberPrices.item'),
      // The pair (barber, item) is unique (spec §4.9); a unique index backs it up (migration).
      validate: (async (value, { data, id, req }) => {
        const item = value as ItemValue
        const itemId = relationId(item?.value)
        if (!item?.relationTo || !itemId) return crmT(req.t, 'errors.required')
        const barberId = relationId((data as { barber?: RelationValue }).barber)
        if (!barberId) return true
        const { docs } = await req.payload.find({
          collection: 'barber-prices',
          where: {
            and: [
              { barber: { equals: barberId } },
              { 'item.relationTo': { equals: item.relationTo } },
              { 'item.value': { equals: itemId } },
              ...(id === undefined ? [] : [{ id: { not_equals: id } }]),
            ],
          },
          depth: 0,
          limit: 1,
          pagination: false,
          select: {},
          req: outsideTransaction(req),
        })
        return docs.length > 0 ? crmT(req.t, 'errors.barberPriceTaken') : true
      }) satisfies RelationshipFieldSingleValidation,
    },
    {
      type: 'row',
      fields: [
        {
          ...moneyField({ name: 'price', label: 'barberPrices.price', required: false }),
          admin: {
            ...moneyField({ name: 'price', label: 'barberPrices.price' }).admin,
            description: crmLabel('barberPrices.priceDescription'),
            width: '50%',
          },
        },
        durationOverride,
      ],
    },
  ],
}
