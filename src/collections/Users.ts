import type { CollectionConfig } from 'payload'

export const Users: CollectionConfig = {
  slug: 'users',
  admin: {
    useAsTitle: 'email',
  },

  auth: {
    cookies: { domain: '.levelupbalti.com', secure: true, sameSite: 'Lax' },
  },
  fields: [
    // Email added by default
    // Add more fields as needed
  ],
}
