import type { CollectionConfig, FieldAccess } from 'payload'
import { accessFor, fieldAccessFor } from '@/access/policy'
import { CERTIFICATE_STATUSES } from '@/crm/certificates'
import { certificateStatusField, prepareCertificate } from '@/crm/certificates.service'
import { moneyField } from '@/fields/money'
import { crmLabel, crmLabels } from '@/i18n'

const nobody: FieldAccess = () => false

/** Filled by the sale service; never written through the API. */
const serverOnly = { create: nobody, update: nobody }

const dateTime = {
  date: { pickerAppearance: 'dayAndTime' as const, displayFormat: 'dd.MM.yyyy HH:mm' },
}

const buyerRead = { read: fieldAccessFor('read', 'gift-certificates.buyer') }

/**
 * Gift certificates (spec §4.17, §5.7, A6, A34). Created only by the sale
 * (`POST /api/crm/certificates/sell` → `sellCertificate`), which also writes the `certificate_sale`
 * operation; the balance changes only by payments and refunds (atomic `$inc`). `status` is derived
 * on read. Admin may void a certificate or change its expiry, buyer and comment; nobody deletes it.
 */
export const GiftCertificates: CollectionConfig = {
  slug: 'gift-certificates',
  labels: {
    singular: crmLabel('giftCertificates.singular'),
    plural: crmLabel('giftCertificates.plural'),
  },
  access: {
    read: accessFor('read', 'gift-certificates'),
    create: accessFor('create', 'gift-certificates'),
    update: accessFor('update', 'gift-certificates'),
    delete: () => false,
  },
  admin: {
    useAsTitle: 'code',
    group: crmLabels('groups.finance'),
    defaultColumns: ['code', 'nominal', 'balance', 'status', 'expiresAt', 'issuedAt'],
  },
  defaultSort: '-issuedAt',
  hooks: {
    beforeChange: [prepareCertificate],
  },
  fields: [
    {
      name: 'code',
      type: 'text',
      unique: true,
      index: true,
      label: crmLabel('giftCertificates.code'),
      access: serverOnly,
      admin: { readOnly: true },
    },
    {
      type: 'row',
      fields: [
        {
          ...moneyField({ name: 'nominal', label: 'giftCertificates.nominal' }),
          access: { update: nobody },
          admin: {
            width: '50%',
            readOnly: true,
            components: {
              Field: '@/components/money/MoneyField#MoneyField',
              Cell: '@/components/money/MoneyCell#MoneyCell',
            },
          },
        },
        {
          ...moneyField({
            name: 'balance',
            label: 'giftCertificates.balance',
            required: false,
            description: 'giftCertificates.balanceDescription',
          }),
          access: serverOnly,
          admin: {
            width: '50%',
            readOnly: true,
            description: crmLabel('giftCertificates.balanceDescription'),
            components: {
              Field: '@/components/money/MoneyField#MoneyField',
              Cell: '@/components/money/MoneyCell#MoneyCell',
            },
          },
        },
      ],
    },
    {
      type: 'row',
      fields: [
        {
          name: 'issuedAt',
          type: 'date',
          index: true,
          label: crmLabel('giftCertificates.issuedAt'),
          access: serverOnly,
          admin: { width: '50%', readOnly: true, ...dateTime },
        },
        {
          name: 'expiresAt',
          type: 'date',
          required: true,
          index: true,
          label: crmLabel('giftCertificates.expiresAt'),
          admin: { width: '50%', ...dateTime },
        },
      ],
    },
    {
      name: 'status',
      type: 'select',
      virtual: true,
      label: crmLabel('giftCertificates.status'),
      options: CERTIFICATE_STATUSES.map((value) => ({
        value,
        label: crmLabel(`giftCertificates.statuses.${value}`),
      })),
      admin: { position: 'sidebar', readOnly: true },
      hooks: { afterRead: [certificateStatusField] },
    },
    {
      name: 'voided',
      type: 'checkbox',
      defaultValue: false,
      label: crmLabel('giftCertificates.voided'),
      admin: {
        position: 'sidebar',
        description: crmLabel('giftCertificates.voidedDescription'),
      },
    },
    {
      type: 'row',
      fields: [
        {
          name: 'buyerName',
          type: 'text',
          maxLength: 120,
          label: crmLabel('giftCertificates.buyerName'),
          access: buyerRead,
          admin: { width: '50%' },
        },
        {
          name: 'buyerPhone',
          type: 'text',
          label: crmLabel('giftCertificates.buyerPhone'),
          access: buyerRead,
          admin: { width: '50%' },
        },
      ],
    },
    {
      name: 'saleTransaction',
      type: 'relationship',
      relationTo: 'transactions',
      label: crmLabel('giftCertificates.saleTransaction'),
      access: serverOnly,
      admin: { position: 'sidebar', readOnly: true },
    },
    {
      name: 'comment',
      type: 'textarea',
      maxLength: 1000,
      label: crmLabel('giftCertificates.comment'),
    },
  ],
}
