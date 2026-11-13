import type { CollectionConfig } from 'payload'
import { catalogAccess, catalogGroup, orderDescription } from '@/fields'
import { crmLabel } from '@/i18n'

export const ServiceCategories: CollectionConfig = {
  slug: 'service-categories',
  labels: {
    singular: crmLabel('serviceCategories.singular'),
    plural: crmLabel('serviceCategories.plural'),
  },
  access: catalogAccess,
  admin: {
    useAsTitle: 'name',
    group: catalogGroup,
    defaultColumns: ['name', 'order', 'active'],
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
      label: crmLabel('serviceCategories.active'),
      admin: { position: 'sidebar' },
    },
    {
      name: 'name',
      type: 'text',
      required: true,
      localized: true,
      label: crmLabel('serviceCategories.name'),
    },
  ],
}
