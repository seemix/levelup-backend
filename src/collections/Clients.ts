import type { CollectionBeforeValidateHook, CollectionConfig } from 'payload'
import { accessFor, fieldAccessFor } from '@/access/policy'
import { businessError } from '@/crm/errors'
import { tryNormalizePhone } from '@/crm/phone'
import { crmLabel, crmLabels, crmT, supportedLocales } from '@/i18n'

/**
 * Normalizes `phone` to E.164 (`PHONE_INVALID` otherwise) and rejects duplicates (`PHONE_TAKEN`).
 * The unique index is the final guard against races; this check gives the machine code.
 */
const normalizeAndCheckPhone: CollectionBeforeValidateHook = async ({
  data,
  originalDoc,
  operation,
  req,
}) => {
  if (!data) return data
  // On update without `phone` in the payload the stored value is kept.
  if (operation === 'update' && data.phone === undefined) return data
  const raw = typeof data.phone === 'string' ? data.phone : ''
  const phone = tryNormalizePhone(raw)
  if (!phone) throw businessError('PHONE_INVALID', crmT(req.t, 'errors.phoneInvalid'))
  data.phone = phone

  const { totalDocs } = await req.payload.count({
    collection: 'clients',
    where: {
      and: [
        { phone: { equals: phone } },
        ...(originalDoc?.id === undefined ? [] : [{ id: { not_equals: originalDoc.id } }]),
      ],
    },
    req,
  })
  if (totalDocs > 0) throw businessError('PHONE_TAKEN', crmT(req.t, 'errors.phoneTaken'), 409)
  return data
}

export const Clients: CollectionConfig = {
  slug: 'clients',
  labels: {
    singular: crmLabel('clients.singular'),
    plural: crmLabel('clients.plural'),
  },
  access: {
    read: accessFor('read', 'clients'),
    create: accessFor('create', 'clients'),
    update: accessFor('update', 'clients'),
    delete: accessFor('delete', 'clients'),
  },
  admin: {
    useAsTitle: 'phone',
    group: crmLabels('groups.clients'),
    defaultColumns: ['firstName', 'lastName', 'phone', 'language', 'blocked'],
    listSearchableFields: ['firstName', 'lastName', 'phone', 'email'],
  },
  hooks: { beforeValidate: [normalizeAndCheckPhone] },
  fields: [
    {
      type: 'row',
      fields: [
        {
          name: 'firstName',
          type: 'text',
          required: true,
          label: crmLabel('clients.firstName'),
          admin: { width: '50%' },
        },
        {
          name: 'lastName',
          type: 'text',
          label: crmLabel('clients.lastName'),
          admin: { width: '50%' },
        },
      ],
    },
    {
      type: 'row',
      fields: [
        {
          name: 'phone',
          type: 'text',
          required: true,
          unique: true,
          label: crmLabel('clients.phone'),
          admin: { description: crmLabel('fields.phoneDescription'), width: '50%' },
        },
        {
          name: 'email',
          type: 'email',
          label: crmLabel('clients.email'),
          access: { read: fieldAccessFor('read', 'clients.email') },
          admin: { width: '50%' },
        },
      ],
    },
    {
      name: 'language',
      type: 'select',
      required: true,
      defaultValue: 'ru',
      label: crmLabel('clients.language'),
      admin: { description: crmLabel('clients.languageDescription') },
      options: supportedLocales.map((locale) => ({
        value: locale,
        label: crmLabel(`languages.${locale}`),
      })),
    },
    {
      name: 'blocked',
      type: 'checkbox',
      defaultValue: false,
      index: true,
      label: crmLabel('clients.blocked'),
      admin: { position: 'sidebar', description: crmLabel('clients.blockedDescription') },
    },
    {
      name: 'source',
      type: 'text',
      label: crmLabel('clients.source'),
      admin: { position: 'sidebar', description: crmLabel('clients.sourceDescription') },
    },
    {
      name: 'externalId',
      type: 'text',
      index: true,
      label: crmLabel('clients.externalId'),
      admin: { position: 'sidebar' },
    },
    {
      name: 'notes',
      type: 'textarea',
      label: crmLabel('clients.notes'),
    },
  ],
}
