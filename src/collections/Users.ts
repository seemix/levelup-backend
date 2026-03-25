import type { CollectionConfig } from 'payload';

export const Users: CollectionConfig = {
    slug: 'users',
    access: {
        read: () => true,
        create: () => true,
        update: () => true,
        delete: () => true,
    },
    admin: {
        useAsTitle: 'email',
    },
    auth: {
        cookies: { domain: 'admin.levelupbalti.com', secure: true, sameSite: 'Lax' },
    },
    fields: [
        // Email added by default
        // Add more fields as needed
    ],
};
