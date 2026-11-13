import type { CollectionConfig } from 'payload'
import { adminOrEditor, anyone } from '@/access'
import { accessFor } from '@/access/policy'
import { crmLabel, crmLabels } from '@/i18n'

export const contentAccess: NonNullable<CollectionConfig['access']> = {
  read: anyone,
  create: adminOrEditor,
  update: adminOrEditor,
  delete: adminOrEditor,
}

export const contentGroup = crmLabels('groups.content')

export const settingsGroup = crmLabels('groups.settings')

/** Shared description for the `order` sidebar field. */
export const orderDescription = crmLabel('fields.orderDescription')

export const catalogGroup = crmLabels('groups.catalog')

/** Catalog (service-categories, services, extras): anonymous reads active only, admin writes (spec §3.1). */
export const catalogAccess: NonNullable<CollectionConfig['access']> = {
  read: accessFor('read', 'catalog'),
  create: accessFor('create', 'catalog'),
  update: accessFor('update', 'catalog'),
  delete: accessFor('delete', 'catalog'),
}
