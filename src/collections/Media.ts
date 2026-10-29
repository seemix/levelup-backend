import type { CollectionConfig } from 'payload'
import { adminOrEditor, anyone } from '@/access'
import { generateBlurHash } from '@/hooks/generateBlurHash'

export const Media: CollectionConfig = {
  slug: 'media',
  access: {
    read: anyone,
    create: adminOrEditor,
    update: adminOrEditor,
    delete: adminOrEditor,
  },
  admin: {
    useAsTitle: 'filename',
  },
  fields: [
    {
      name: 'blurHash',
      type: 'text',
      admin: {
        hidden: true,
        disableListColumn: true,
      },
    },
    {
      name: 'alt',
      type: 'text',
      required: true,
      localized: true,
    },
  ],
  upload: {
    mimeTypes: ['image/*'],
    imageSizes: [
      { name: 'thumbnail', width: 400, withoutEnlargement: true },
      { name: 'card', width: 900, withoutEnlargement: true },
      { name: 'hero', width: 1920, withoutEnlargement: true },
    ],
    formatOptions: { format: 'webp', options: { quality: 82 } },
  },
  hooks: {
    beforeChange: [generateBlurHash],
  },
}
