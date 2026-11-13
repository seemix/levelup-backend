import { CollectionConfig } from 'payload'
import { crmLabel } from '@/i18n'
import { contentAccess, contentGroup, orderDescription } from '@/fields'

export const Slides: CollectionConfig = {
  slug: 'slides',
  access: contentAccess,
  admin: {
    useAsTitle: 'title',
    group: contentGroup,
  },
  defaultSort: 'order',
  fields: [
    {
      name: 'order',
      type: 'number',
      defaultValue: 0,
      index: true,
      admin: { position: 'sidebar', description: orderDescription },
    },
    {
      name: 'title',
      type: 'text',
      required: false,
    },
    {
      name: 'image',
      type: 'upload',
      relationTo: 'media',
      label: crmLabel('fields.imageLandscape'),
    },
    {
      name: 'verticalImage',
      type: 'upload',
      relationTo: 'media',
      label: crmLabel('fields.imagePortrait'),
      required: true,
    },
  ],
}
