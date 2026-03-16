import { GlobalConfig } from 'payload';

export const AboutUs: GlobalConfig = {
    slug: 'about-us',
    access: {
        read: () => true,
    },
    admin: {
        group: 'Content'
    },
    fields: [{ name: 'content', type: 'richText', localized: true }]
};