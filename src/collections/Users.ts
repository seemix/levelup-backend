import type { CollectionConfig } from 'payload'
import { adminOnly, adminOnlyField, adminOrSelf } from '@/access'
import { env } from '@/env'

export const Users: CollectionConfig = {
  slug: 'users',
  access: {
    read: adminOrSelf,
    create: adminOnly,
    update: adminOrSelf,
    delete: adminOnly,
  },
  admin: {
    useAsTitle: 'email',
  },
  auth: {
    cookies: {
      domain: env.cookieDomain,
      secure: env.isProduction,
      sameSite: 'Lax',
    },
    depth: 1,
    tokenExpiration: 60 * 60 * 24 * 7,
    maxLoginAttempts: 5,
    lockTime: 10 * 60 * 1000,
    useSessions: true,
  },
  fields: [
    {
      name: 'roles',
      type: 'select',
      hasMany: true,
      options: ['admin', 'editor'],
      defaultValue: ['editor'],
      required: true,
      saveToJWT: true,
      access: {
        update: adminOnlyField,
      },
    },
  ],
  hooks: {
    // The very first user (created via the admin "create first user" screen) must be an admin.
    beforeChange: [
      async ({ data, operation, req }) => {
        if (operation !== 'create') return data
        const { docs } = await req.payload.find({
          collection: 'users',
          depth: 0,
          limit: 1,
          pagination: false,
          select: {},
          req,
        })
        if (docs.length === 0) data.roles = ['admin']
        return data
      },
    ],
  },
}
