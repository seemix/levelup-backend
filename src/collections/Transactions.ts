import type { CollectionConfig, Condition, FieldAccess, FilterOptions, Where } from 'payload'
import { accessFor, rowAccessFor } from '@/access/policy'
import { TRANSACTION_TYPES, UNDO_TYPES, type TransactionType } from '@/crm/ledger'
import { applyTransaction, prepareTransaction } from '@/crm/ledger.service'
import { moneyField } from '@/fields/money'
import { crmLabel, crmLabels } from '@/i18n'

const nobody: FieldAccess = () => false

/** Sums and links never change after creation (§4.15, decision 34): only comment and category do. */
const immutable = { update: nobody }
/** Filled by the server (author, reversed flag). */
const serverOnly = { create: nobody, update: nobody }

type FormData = { id?: unknown; type?: TransactionType; location?: unknown }

const typeIs =
  (...types: TransactionType[]): Condition =>
  (data) =>
    types.includes((data as FormData)?.type as TransactionType)

/** A refund / reversal copies the entries of the original: they are typed only for other types. */
const entriesShown: Condition = (data) =>
  Boolean((data as FormData)?.id) ||
  !UNDO_TYPES.includes((data as FormData)?.type as TransactionType)

const relId = (value: unknown) =>
  value && typeof value === 'object' ? (value as { id?: unknown }).id : value

/** Registers of the operation's location, active ones for a new operation. */
const registerOptions: FilterOptions = ({ data }): Where => {
  const location = relId((data as FormData)?.location) as string | undefined
  return location
    ? { and: [{ location: { equals: location } }, { active: { equals: true } }] }
    : { active: { equals: true } }
}

/**
 * Financial operations, the ledger (spec §4.15, §5.6). Rules by type — `src/crm/ledger.ts`; balances,
 * reversal and permissions — hooks in `src/crm/ledger.service.ts`. Nobody deletes an operation:
 * corrections are reversals.
 */
export const Transactions: CollectionConfig = {
  slug: 'transactions',
  labels: {
    singular: crmLabel('transactions.singular'),
    plural: crmLabel('transactions.plural'),
  },
  access: {
    read: rowAccessFor('read', 'transactions'),
    create: accessFor('create', 'transactions'),
    update: accessFor('update', 'transactions'),
    delete: accessFor('delete', 'transactions'),
  },
  admin: {
    group: crmLabels('groups.finance'),
    defaultColumns: ['occurredAt', 'type', 'location', 'comment', 'author', 'reversed'],
  },
  defaultSort: '-occurredAt',
  hooks: {
    beforeChange: [prepareTransaction],
    afterChange: [applyTransaction],
  },
  fields: [
    {
      type: 'row',
      fields: [
        {
          name: 'type',
          type: 'select',
          required: true,
          index: true,
          label: crmLabel('transactions.type'),
          access: immutable,
          admin: { width: '50%' },
          options: TRANSACTION_TYPES.map((value) => ({
            value,
            label: crmLabel(`transactions.types.${value}`),
          })),
        },
        {
          name: 'occurredAt',
          type: 'date',
          required: true,
          index: true,
          label: crmLabel('transactions.occurredAt'),
          access: immutable,
          admin: {
            width: '50%',
            description: crmLabel('transactions.occurredAtDescription'),
            date: { pickerAppearance: 'dayAndTime', displayFormat: 'dd.MM.yyyy HH:mm' },
          },
        },
      ],
    },
    {
      name: 'location',
      type: 'relationship',
      relationTo: 'locations',
      required: true,
      index: true,
      label: crmLabel('transactions.location'),
      access: immutable,
      admin: { condition: entriesShown },
    },
    {
      name: 'reverses',
      type: 'relationship',
      relationTo: 'transactions',
      label: crmLabel('transactions.reverses'),
      access: immutable,
      admin: { condition: typeIs(...UNDO_TYPES) },
    },
    {
      name: 'entries',
      type: 'array',
      label: crmLabel('transactions.entries'),
      access: immutable,
      admin: { condition: entriesShown, description: crmLabel('transactions.entriesDescription') },
      fields: [
        {
          type: 'row',
          fields: [
            {
              name: 'cashRegister',
              type: 'relationship',
              relationTo: 'cash-registers',
              required: true,
              label: crmLabel('transactions.cashRegister'),
              filterOptions: registerOptions,
              admin: { width: '50%' },
            },
            {
              ...moneyField({
                name: 'amount',
                label: 'transactions.amount',
                signed: true,
                description: 'transactions.amountDescription',
              }),
              admin: {
                width: '50%',
                description: crmLabel('transactions.amountDescription'),
                components: {
                  Field: '@/components/money/MoneyField#MoneyField',
                  Cell: '@/components/money/MoneyCell#MoneyCell',
                },
              },
            },
          ],
        },
      ],
    },
    {
      name: 'expenseCategory',
      type: 'relationship',
      relationTo: 'expense-categories',
      index: true,
      label: crmLabel('transactions.expenseCategory'),
      filterOptions: { active: { equals: true } },
      admin: { condition: typeIs('expense') },
    },
    {
      name: 'comment',
      type: 'textarea',
      maxLength: 1000,
      label: crmLabel('transactions.comment'),
    },
    {
      type: 'row',
      admin: { condition: typeIs('appointment_payment', 'refund') },
      fields: [
        {
          name: 'appointment',
          type: 'relationship',
          relationTo: 'appointments',
          index: true,
          label: crmLabel('transactions.appointment'),
          access: immutable,
          admin: { width: '50%' },
        },
        {
          // Snapshot of the appointment's barber (salary reports, barber read access).
          name: 'barber',
          type: 'relationship',
          relationTo: 'barbers',
          index: true,
          label: crmLabel('transactions.barber'),
          access: immutable,
          admin: { width: '50%' },
        },
      ],
    },
    {
      type: 'row',
      admin: { condition: typeIs('appointment_payment', 'refund') },
      fields: [
        {
          ...moneyField({
            name: 'certificateAmount',
            label: 'transactions.certificateAmount',
            required: false,
          }),
          access: immutable,
        },
      ],
    },
    {
      // The certificate sold, used for payment or returned by a refund (§4.15, §5.7).
      name: 'certificate',
      type: 'relationship',
      relationTo: 'gift-certificates',
      index: true,
      label: crmLabel('transactions.certificate'),
      access: immutable,
      admin: { condition: typeIs('certificate_sale', 'appointment_payment', 'refund') },
    },
    {
      name: 'author',
      type: 'relationship',
      relationTo: 'users',
      label: crmLabel('transactions.author'),
      access: serverOnly,
      admin: { position: 'sidebar', readOnly: true },
    },
    {
      name: 'reversed',
      type: 'checkbox',
      defaultValue: false,
      index: true,
      label: crmLabel('transactions.reversed'),
      access: serverOnly,
      admin: { position: 'sidebar', readOnly: true },
    },
  ],
}
