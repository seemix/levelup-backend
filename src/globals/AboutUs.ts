import { GlobalConfig } from 'payload';
import { adminOrEditor, anyone } from '@/access';
import { contentGroup } from '@/fields';

export const AboutUs: GlobalConfig = {
    slug: 'about-us',
    access: {
        read: anyone,
        update: adminOrEditor,
    },
    admin: {
        group: contentGroup,
    },
    fields: [{ name: 'content', type: 'richText', localized: true }],
};
