import type { CollectionConfig } from 'payload';
import { generateBlurHash } from '@/hooks/generateBlurHash';

export const Media: CollectionConfig = {
    slug: 'media',
    access: {
        read: () => true,
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
        },
    ],
    upload: true,
    hooks: {
        beforeValidate: [generateBlurHash],
    },
};
