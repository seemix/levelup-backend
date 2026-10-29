import type { CollectionConfig } from 'payload'
import { adminOrEditor, anyone } from '@/access'

export const contentAccess: NonNullable<CollectionConfig['access']> = {
  read: anyone,
  create: adminOrEditor,
  update: adminOrEditor,
  delete: adminOrEditor,
}

export const contentGroup = 'Content'
