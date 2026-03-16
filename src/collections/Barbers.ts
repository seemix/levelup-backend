import { CollectionConfig } from 'payload';

export const Barbers: CollectionConfig = {
    slug: 'barbers',
    access: {
        read: () => true,
    },
    admin: {
        useAsTitle: 'name',
        group: 'Content'
    },
    fields: [
        {
            name: 'name',
            type: 'text',
            required: true,
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
        }
    ]
}