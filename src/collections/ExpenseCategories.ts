import type { CollectionBeforeDeleteHook, CollectionConfig } from 'payload'
import { accessFor } from '@/access/policy'
import { ruleError } from '@/crm/errors'
import { crmLabel, crmLabels } from '@/i18n'

/** A category used by expenses stays (reports refer to it): deactivate it instead. */
const keepUsed: CollectionBeforeDeleteHook = async ({ id, req }) => {
  const { totalDocs } = await req.payload.count({
    collection: 'transactions',
    where: { expenseCategory: { equals: id } },
    overrideAccess: true,
    req,
  })
  if (totalDocs > 0) throw ruleError(req.t, 'EXPENSE_CATEGORY_IN_USE', 409)
}

/** Expense categories (spec §4.14): admin CRUD, manager reads; inactive ones are not offered for new expenses. */
export const ExpenseCategories: CollectionConfig = {
  slug: 'expense-categories',
  labels: {
    singular: crmLabel('expenseCategories.singular'),
    plural: crmLabel('expenseCategories.plural'),
  },
  access: {
    read: accessFor('read', 'expense-categories'),
    create: accessFor('create', 'expense-categories'),
    update: accessFor('update', 'expense-categories'),
    delete: accessFor('delete', 'expense-categories'),
  },
  admin: {
    useAsTitle: 'name',
    group: crmLabels('groups.finance'),
    defaultColumns: ['name', 'order', 'active'],
  },
  defaultSort: 'order',
  hooks: { beforeDelete: [keepUsed] },
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
      localized: true,
      label: crmLabel('expenseCategories.name'),
    },
    {
      name: 'order',
      type: 'number',
      defaultValue: 0,
      label: crmLabel('expenseCategories.order'),
      admin: { position: 'sidebar', description: crmLabel('fields.orderDescription') },
    },
    {
      name: 'active',
      type: 'checkbox',
      defaultValue: true,
      label: crmLabel('expenseCategories.active'),
      admin: { position: 'sidebar' },
    },
  ],
}
