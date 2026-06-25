import { CollectionConfig } from 'payload';

export const Slides: CollectionConfig = {
    slug: 'slides',
    access: {
        read: () => true,
    },
    admin: {
        useAsTitle: 'title',
        group: 'Content',
    },
    fields: [
        {
            name: 'title',
            type: 'text',
            required: false,
        },
        {
            name: 'image',
            type: 'upload',
            relationTo: 'media',
            label: '1920x1080'
        },
        {
            name: 'verticalImage',
            type: 'upload',
            relationTo: 'media',
            label: '1080x2400',
            required: true
        }
    ]
};