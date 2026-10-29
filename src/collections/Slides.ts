import { CollectionConfig } from 'payload';
import { contentAccess, contentGroup } from '@/fields';

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
            admin: { position: 'sidebar', description: 'Lower numbers are shown first' },
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
            label: '1920x1080',
        },
        {
            name: 'verticalImage',
            type: 'upload',
            relationTo: 'media',
            label: '1080x2400',
            required: true,
        },
    ],
};
