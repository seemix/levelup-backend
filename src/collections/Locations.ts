import type { CollectionConfig, TextFieldSingleValidation } from 'payload'
import { accessFor } from '@/access/policy'
import { tryNormalizePhone } from '@/crm/phone'
import { orderDescription, settingsGroup } from '@/fields'
import { crmLabel, crmT } from '@/i18n'

export const Locations: CollectionConfig = {
  slug: 'locations',
  labels: {
    singular: crmLabel('locations.singular'),
    plural: crmLabel('locations.plural'),
  },
  access: {
    read: accessFor('read', 'locations'),
    create: accessFor('create', 'locations'),
    update: accessFor('update', 'locations'),
    delete: accessFor('delete', 'locations'),
  },
  admin: {
    useAsTitle: 'name',
    group: settingsGroup,
    defaultColumns: ['name', 'address', 'phone', 'active'],
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
      label: crmLabel('locations.active'),
      admin: { position: 'sidebar' },
    },
    {
      name: 'name',
      type: 'text',
      required: true,
      localized: true,
      label: crmLabel('locations.name'),
    },
    {
      name: 'address',
      type: 'text',
      localized: true,
      label: crmLabel('locations.address'),
    },
    {
      name: 'phone',
      type: 'text',
      label: crmLabel('locations.phone'),
      admin: { description: crmLabel('fields.phoneDescription') },
      hooks: {
        beforeValidate: [
          ({ value }) =>
            typeof value === 'string' ? (tryNormalizePhone(value) ?? value.trim()) : value,
        ],
      },
      validate: ((value, { req: { t } }) =>
        !value || tryNormalizePhone(value)
          ? true
          : crmT(t, 'errors.phoneInvalid')) satisfies TextFieldSingleValidation,
    },
    {
      name: 'mapUrl',
      type: 'text',
      label: crmLabel('locations.mapUrl'),
      validate: ((value, { req: { t } }) =>
        !value || /^https?:\/\/\S+$/i.test(value)
          ? true
          : crmT(t, 'errors.urlInvalid')) satisfies TextFieldSingleValidation,
    },
  ],
}
