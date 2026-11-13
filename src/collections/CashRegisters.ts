import type { CollectionConfig } from 'payload'
import { accessFor, fieldAccessFor } from '@/access/policy'
import { CASH_REGISTER_TYPES } from '@/crm/ledger'
import { moneyField } from '@/fields/money'
import { crmLabel, crmLabels } from '@/i18n'

const nobody = () => false

/**
 * Cash registers (spec §4.13, decision 33). `balance` changes only in the `transactions` afterChange
 * hook (atomic `$inc` in the same DB transaction); admin and manager read it, a barber does not.
 */
export const CashRegisters: CollectionConfig = {
  slug: 'cash-registers',
  labels: {
    singular: crmLabel('cashRegisters.singular'),
    plural: crmLabel('cashRegisters.plural'),
  },
  access: {
    read: accessFor('read', 'cash-registers'),
    create: accessFor('create', 'cash-registers'),
    update: accessFor('update', 'cash-registers'),
    // Operations reference registers forever: deactivate instead of deleting.
    delete: nobody,
  },
  admin: {
    useAsTitle: 'name',
    group: crmLabels('groups.finance'),
    defaultColumns: ['name', 'type', 'location', 'balance', 'active'],
  },
  defaultSort: 'name',
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
      localized: true,
      label: crmLabel('cashRegisters.name'),
    },
    {
      type: 'row',
      fields: [
        {
          name: 'type',
          type: 'select',
          required: true,
          defaultValue: 'cash',
          label: crmLabel('cashRegisters.type'),
          admin: { width: '50%' },
          options: CASH_REGISTER_TYPES.map((value) => ({
            value,
            label: crmLabel(`cashRegisters.types.${value}`),
          })),
        },
        {
          name: 'location',
          type: 'relationship',
          relationTo: 'locations',
          required: true,
          index: true,
          label: crmLabel('cashRegisters.location'),
          admin: { width: '50%' },
        },
      ],
    },
    {
      name: 'active',
      type: 'checkbox',
      defaultValue: true,
      label: crmLabel('cashRegisters.active'),
      admin: { position: 'sidebar', description: crmLabel('cashRegisters.activeDescription') },
    },
    {
      ...moneyField({
        name: 'balance',
        label: 'cashRegisters.balance',
        required: false,
        signed: true,
        description: 'cashRegisters.balanceDescription',
      }),
      defaultValue: 0,
      access: {
        read: fieldAccessFor('read', 'cash-registers.balance'),
        create: nobody,
        update: nobody,
      },
      admin: {
        position: 'sidebar',
        readOnly: true,
        description: crmLabel('cashRegisters.balanceDescription'),
        components: {
          Field: '@/components/money/MoneyField#MoneyField',
          Cell: '@/components/money/MoneyCell#MoneyCell',
        },
      },
    },
  ],
}
