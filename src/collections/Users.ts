import type { CollectionConfig } from 'payload'
import { adminOnly, adminOnlyField, adminOrSelf } from '@/access'
import { ROLES, fieldAccessFor } from '@/access/policy'
import { env } from '@/env'
import { crmLabel, crmT, supportedLocales } from '@/i18n'

export const Users: CollectionConfig = {
  slug: 'users',
  labels: {
    singular: crmLabel('users.singular'),
    plural: crmLabel('users.plural'),
  },
  access: {
    read: adminOrSelf,
    create: adminOnly,
    update: adminOrSelf,
    delete: adminOnly,
  },
  admin: {
    useAsTitle: 'email',
    defaultColumns: ['email', 'roles', 'locations'],
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
      label: crmLabel('users.roles'),
      options: ROLES.map((role) => ({ value: role, label: crmLabel(`roles.${role}`) })),
      defaultValue: ['editor'],
      required: true,
      saveToJWT: true,
      access: {
        create: adminOnlyField,
        update: adminOnlyField,
      },
    },
    {
      name: 'locations',
      type: 'relationship',
      relationTo: 'locations',
      hasMany: true,
      label: crmLabel('users.locations'),
      saveToJWT: true,
      access: {
        create: fieldAccessFor('create', 'users.privileged'),
        update: fieldAccessFor('update', 'users.privileged'),
      },
      admin: {
        description: crmLabel('users.locationsDescription'),
        condition: (data) => Boolean(data?.roles?.includes('manager')),
      },
      validate: (value: unknown, { siblingData, req: { t } }) => {
        const roles = (siblingData as { roles?: string[] | null }).roles
        const empty = !Array.isArray(value) || value.length === 0
        return roles?.includes('manager') && empty
          ? crmT(t, 'errors.managerLocationsRequired')
          : true
      },
    },
    {
      name: 'language',
      type: 'select',
      label: crmLabel('users.language'),
      options: supportedLocales.map((locale) => ({
        value: locale,
        label: crmLabel(`languages.${locale}`),
      })),
      defaultValue: 'ru',
      admin: { description: crmLabel('users.languageDescription') },
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
