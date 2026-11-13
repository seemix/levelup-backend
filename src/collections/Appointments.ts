import type { CollectionConfig, Field, NumberField } from 'payload'
import { accessFor, rowAccessFor } from '@/access/policy'
import {
  APPOINTMENT_KINDS,
  APPOINTMENT_SOURCES,
  APPOINTMENT_STATUSES,
  PAYMENT_STATUSES,
} from '@/crm/appointment-status'
import { logAppointmentChange, prepareAppointment } from '@/crm/appointments'
import { queueAppointmentEmails } from '@/crm/appointment-emails'
import { moneyField } from '@/fields/money'
import { crmLabel, crmLabels, supportedLocales, type CrmKey } from '@/i18n'

const isAppointment = (data: unknown) =>
  ((data as { kind?: string } | undefined)?.kind ?? 'appointment') === 'appointment'

/** Amount calculated by the server (price snapshot, ledger): shown in lei, never edited. */
const computedMoney = (name: string, label: CrmKey, sidebar = false): NumberField => {
  const field = moneyField({ name, label, required: false })
  return {
    ...field,
    defaultValue: 0,
    admin: {
      ...field.admin,
      readOnly: true,
      description: undefined,
      ...(sidebar ? { position: 'sidebar' as const } : {}),
    },
  }
}

const dateTime = {
  date: { pickerAppearance: 'dayAndTime' as const, displayFormat: 'dd.MM.yyyy HH:mm' },
}

const readOnlyDate = (name: string, label: CrmKey): Field => ({
  name,
  type: 'date',
  label: crmLabel(label),
  admin: { ...dateTime, readOnly: true, position: 'sidebar' },
})

/**
 * Appointments and time blocks (spec §4.11). Every write goes through `prepareAppointment`
 * (prices, slot under lock, status machine, promo counter) and is logged by `logAppointmentChange`.
 */
export const Appointments: CollectionConfig = {
  slug: 'appointments',
  labels: {
    singular: crmLabel('appointments.singular'),
    plural: crmLabel('appointments.plural'),
  },
  access: {
    read: rowAccessFor('read', 'appointments'),
    create: rowAccessFor('create', 'appointments'),
    update: rowAccessFor('update', 'appointments'),
    delete: accessFor('delete', 'appointments'),
  },
  admin: {
    group: crmLabels('groups.appointments'),
    defaultColumns: ['startAt', 'barber', 'client', 'service', 'status', 'total', 'location'],
  },
  defaultSort: '-startAt',
  indexes: [
    { fields: ['barber', 'startAt'] },
    { fields: ['location', 'startAt'] },
    { fields: ['client', 'startAt'] },
  ],
  hooks: {
    beforeChange: [prepareAppointment],
    afterChange: [logAppointmentChange, queueAppointmentEmails],
  },
  fields: [
    {
      name: 'kind',
      type: 'select',
      required: true,
      defaultValue: 'appointment',
      label: crmLabel('appointments.kind'),
      options: APPOINTMENT_KINDS.map((value) => ({
        value,
        label: crmLabel(`appointments.kinds.${value}`),
      })),
    },
    {
      type: 'row',
      fields: [
        {
          name: 'location',
          type: 'relationship',
          relationTo: 'locations',
          required: true,
          label: crmLabel('appointments.location'),
          admin: { width: '50%' },
        },
        {
          name: 'barber',
          type: 'relationship',
          relationTo: 'barbers',
          required: true,
          label: crmLabel('appointments.barber'),
          admin: { width: '50%' },
        },
      ],
    },
    {
      name: 'client',
      type: 'relationship',
      relationTo: 'clients',
      label: crmLabel('appointments.client'),
      admin: {
        description: crmLabel('appointments.clientDescription'),
        condition: (data) => isAppointment(data),
      },
    },
    {
      type: 'row',
      admin: { condition: (data) => isAppointment(data) },
      fields: [
        {
          name: 'service',
          type: 'relationship',
          relationTo: 'services',
          label: crmLabel('appointments.service'),
          admin: { width: '50%' },
        },
        {
          name: 'extras',
          type: 'relationship',
          relationTo: 'extras',
          hasMany: true,
          label: crmLabel('appointments.extras'),
          admin: { width: '50%' },
        },
      ],
    },
    {
      type: 'row',
      fields: [
        {
          name: 'startAt',
          type: 'date',
          required: true,
          index: true,
          label: crmLabel('appointments.startAt'),
          admin: { ...dateTime, width: '34%' },
        },
        {
          name: 'durationMinutes',
          type: 'number',
          min: 0,
          label: crmLabel('appointments.durationMinutes'),
          admin: { width: '33%', description: crmLabel('appointments.durationDescription') },
        },
        {
          name: 'endAt',
          type: 'date',
          label: crmLabel('appointments.endAt'),
          admin: { ...dateTime, width: '33%', readOnly: true },
        },
      ],
    },
    {
      type: 'collapsible',
      label: crmLabel('appointments.total'),
      admin: { condition: (data) => isAppointment(data) },
      fields: [
        {
          name: 'promoCode',
          type: 'relationship',
          relationTo: 'promo-codes',
          index: true,
          label: crmLabel('appointments.promoCode'),
        },
        {
          type: 'row',
          fields: [
            {
              name: 'manualDiscountType',
              type: 'select',
              label: crmLabel('appointments.manualDiscountType'),
              admin: { width: '33%' },
              options: [
                { value: 'amount', label: crmLabel('appointments.manualDiscountTypes.amount') },
                { value: 'percent', label: crmLabel('appointments.manualDiscountTypes.percent') },
              ],
            },
            {
              name: 'manualDiscountValue',
              type: 'number',
              min: 0,
              label: crmLabel('appointments.manualDiscountValue'),
              admin: {
                width: '33%',
                description: crmLabel('appointments.manualDiscountValueDescription'),
              },
            },
            {
              name: 'manualDiscountReason',
              type: 'text',
              label: crmLabel('appointments.manualDiscountReason'),
              admin: { width: '34%' },
            },
          ],
        },
        {
          name: 'lines',
          type: 'array',
          label: crmLabel('appointments.lines'),
          admin: { readOnly: true, initCollapsed: true },
          fields: [
            {
              type: 'row',
              fields: [
                {
                  name: 'itemType',
                  type: 'select',
                  required: true,
                  label: crmLabel('appointments.lineItemType'),
                  options: [
                    { value: 'service', label: crmLabel('appointments.itemTypes.service') },
                    { value: 'extra', label: crmLabel('appointments.itemTypes.extra') },
                  ],
                },
                {
                  name: 'item',
                  type: 'text',
                  required: true,
                  label: crmLabel('appointments.lineItem'),
                },
                computedMoney('price', 'appointments.linePrice'),
                {
                  name: 'durationMinutes',
                  type: 'number',
                  label: crmLabel('appointments.lineDuration'),
                },
              ],
            },
          ],
        },
        {
          type: 'row',
          fields: [
            computedMoney('subtotal', 'appointments.subtotal'),
            computedMoney('promoDiscount', 'appointments.promoDiscount'),
            computedMoney('manualDiscount', 'appointments.manualDiscount'),
            computedMoney('total', 'appointments.total'),
          ],
        },
      ],
    },
    {
      name: 'clientComment',
      type: 'textarea',
      label: crmLabel('appointments.clientComment'),
    },
    {
      name: 'internalNote',
      type: 'textarea',
      label: crmLabel('appointments.internalNote'),
      admin: { description: crmLabel('appointments.internalNoteDescription') },
    },
    // Sidebar: status and service data.
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'scheduled',
      index: true,
      label: crmLabel('appointments.status'),
      admin: { position: 'sidebar' },
      options: APPOINTMENT_STATUSES.map((value) => ({
        value,
        label: crmLabel(`appointments.statuses.${value}`),
      })),
    },
    {
      name: 'cancelReason',
      type: 'textarea',
      label: crmLabel('appointments.cancelReason'),
      admin: { position: 'sidebar' },
    },
    {
      name: 'paymentStatus',
      type: 'select',
      defaultValue: 'unpaid',
      label: crmLabel('appointments.paymentStatus'),
      admin: { position: 'sidebar', readOnly: true },
      options: PAYMENT_STATUSES.map((value) => ({
        value,
        label: crmLabel(`appointments.paymentStatuses.${value}`),
      })),
    },
    computedMoney('paidAmount', 'appointments.paidAmount', true),
    computedMoney('certificateAmount', 'appointments.certificateAmount', true),
    computedMoney('tipAmount', 'appointments.tipAmount', true),
    {
      name: 'language',
      type: 'select',
      label: crmLabel('appointments.language'),
      admin: { position: 'sidebar' },
      options: supportedLocales.map((locale) => ({
        value: locale,
        label: crmLabel(`languages.${locale}`),
      })),
    },
    {
      name: 'source',
      type: 'select',
      label: crmLabel('appointments.source'),
      admin: { position: 'sidebar', readOnly: true },
      options: APPOINTMENT_SOURCES.map((value) => ({
        value,
        label: crmLabel(`appointments.sources.${value}`),
      })),
    },
    {
      name: 'createdBy',
      type: 'relationship',
      relationTo: 'users',
      label: crmLabel('appointments.createdBy'),
      admin: { position: 'sidebar', readOnly: true },
    },
    readOnlyDate('statusChangedAt', 'appointments.statusChangedAt'),
    readOnlyDate('cancelledAt', 'appointments.cancelledAt'),
    readOnlyDate('confirmationSentAt', 'appointments.confirmationSentAt'),
    readOnlyDate('reminderSentAt', 'appointments.reminderSentAt'),
    {
      name: 'externalId',
      type: 'text',
      index: true,
      label: crmLabel('appointments.externalId'),
      admin: { position: 'sidebar' },
    },
    {
      // sha256 of the client's cancel link token (§5.10); never readable through the API.
      name: 'cancelTokenHash',
      type: 'text',
      index: true,
      hidden: true,
    },
  ],
}
