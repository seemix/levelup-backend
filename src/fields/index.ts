import type { CollectionConfig } from 'payload'
import { adminOrEditor, anyone } from '@/access'
import { crmLabel, crmLabels } from '@/i18n'

export const contentAccess: NonNullable<CollectionConfig['access']> = {
  read: anyone,
  create: adminOrEditor,
  update: adminOrEditor,
  delete: adminOrEditor,
}

export const contentGroup = crmLabels('groups.content')

/** Shared description for the `order` sidebar field. */
export const orderDescription = crmLabel('fields.orderDescription')
