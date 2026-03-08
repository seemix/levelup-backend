import { CollectionConfig } from 'payload';

export const Slides: CollectionConfig = {
    slug: 'slides',
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
        }
    ]
};