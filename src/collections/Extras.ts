import type { CollectionConfig } from 'payload'
import { catalogAccess, catalogGroup, orderDescription } from '@/fields'
import { durationField, moneyField } from '@/fields/money'
import { crmLabel } from '@/i18n'

export const Extras: CollectionConfig = {
  slug: 'extras',
  labels: {
    singular: crmLabel('extras.singular'),
    plural: crmLabel('extras.plural'),
  },
  access: catalogAccess,
  admin: {
    useAsTitle: 'name',
    group: catalogGroup,
    defaultColumns: ['name', 'durationMinutes', 'price', 'active'],
  },
  defaultSort: 'order',
  fields: [
    {
      name: 'order',
      type: 'number',
      defaultValue: 0,
      index: true,
      label: crmLabel('fields.order'),
      admin: { position: 'sidebar', description: orderDescription },
    },
    {
      name: 'active',
      type: 'checkbox',
      required: true,
      defaultValue: true,
      index: true,
      label: crmLabel('extras.active'),
      admin: { position: 'sidebar' },
    },
    {
      name: 'onlineBooking',
      type: 'checkbox',
      required: true,
      defaultValue: true,
      label: crmLabel('extras.onlineBooking'),
      admin: { position: 'sidebar' },
    },
    {
      name: 'name',
      type: 'text',
      required: true,
      localized: true,
      label: crmLabel('extras.name'),
    },
    {
      name: 'description',
      type: 'textarea',
      localized: true,
      label: crmLabel('extras.description'),
    },
    // Empty = available with every service (decision 15).
    {
      name: 'appliesTo',
      type: 'relationship',
      relationTo: 'services',
      hasMany: true,
      label: crmLabel('extras.appliesTo'),
      admin: { description: crmLabel('extras.appliesToDescription') },
    },
    durationField({ label: 'extras.durationMinutes', min: 0 }),
    moneyField({ name: 'price', label: 'extras.price' }),
  ],
}
