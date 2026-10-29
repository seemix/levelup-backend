import { CollectionConfig } from 'payload'
import { contentAccess, contentGroup } from '@/fields'

export const Barbers: CollectionConfig = {
  slug: 'barbers',
  access: contentAccess,
  admin: {
    useAsTitle: 'name',
    group: contentGroup,
  },
  defaultSort: 'order',
  versions: { maxPerDoc: 20 },
  fields: [
    {
      name: 'order',
      type: 'number',
      defaultValue: 0,
      index: true,
      admin: { position: 'sidebar', description: 'Lower numbers are shown first' },
    },
    {
      name: 'name',
      type: 'text',
      required: true,
      index: true,
    },
    {
      name: 'description',
      type: 'text',
      required: true,
      localized: true,
    },
    {
      name: 'image',
      type: 'upload',
      relationTo: 'media',
    },
    {
      name: 'about',
      type: 'richText',
      required: true,
      localized: true,
    },
  ],
}
