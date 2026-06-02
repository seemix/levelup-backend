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
        cookies: { domain: '.levelupbalti.com', secure: true, sameSite: 'Lax' },

        depth: 3,
        tokenExpiration: 1209600,
        useSessions: false,
    },
    fields: [
        // Email added by default
        // Add more fields as needed
    ],
};
