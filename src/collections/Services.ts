import type { CollectionConfig } from 'payload'
import { catalogAccess, catalogGroup, orderDescription } from '@/fields'
import { durationField, moneyField } from '@/fields/money'
import { crmLabel } from '@/i18n'

export const Services: CollectionConfig = {
  slug: 'services',
  labels: {
    singular: crmLabel('services.singular'),
    plural: crmLabel('services.plural'),
  },
  access: catalogAccess,
  admin: {
    useAsTitle: 'name',
    group: catalogGroup,
    defaultColumns: ['name', 'category', 'durationMinutes', 'price', 'active'],
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
      label: crmLabel('services.active'),
      admin: { position: 'sidebar' },
    },
    {
      name: 'onlineBooking',
      type: 'checkbox',
      required: true,
      defaultValue: true,
      label: crmLabel('services.onlineBooking'),
      admin: { position: 'sidebar' },
    },
    {
      name: 'name',
      type: 'text',
      required: true,
      localized: true,
      label: crmLabel('services.name'),
    },
    {
      name: 'description',
      type: 'textarea',
      localized: true,
      label: crmLabel('services.description'),
    },
    {
      name: 'category',
      type: 'relationship',
      relationTo: 'service-categories',
      index: true,
      label: crmLabel('services.category'),
    },
    durationField({
      label: 'services.durationMinutes',
      description: 'services.durationDescription',
      min: 5,
      step: 5,
    }),
    moneyField({ name: 'price', label: 'services.price' }),
  ],
}
