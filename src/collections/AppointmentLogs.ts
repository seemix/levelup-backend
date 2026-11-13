import type { CollectionConfig } from 'payload'
import { accessFor, rowAccessFor } from '@/access/policy'
import { crmLabel, crmLabels } from '@/i18n'

/** Logs are written only by the server, so values are stored as they are. */
const anyJson = () => true as const

const ACTOR_TYPES = ['user', 'client', 'system'] as const
const ACTIONS = ['create', 'update', 'move', 'status', 'payment', 'refund', 'email'] as const

/**
 * Appointment history (spec §4.12, §5.11). Written only by the `appointments` afterChange hook;
 * update and delete are forbidden to everyone. `location`/`barber` are copied from the appointment
 * so that row-level read access works without a join.
 */
export const AppointmentLogs: CollectionConfig = {
  slug: 'appointment-logs',
  labels: {
    singular: crmLabel('appointmentLogs.singular'),
    plural: crmLabel('appointmentLogs.plural'),
  },
  access: {
    read: rowAccessFor('read', 'appointment-logs'),
    create: accessFor('create', 'appointment-logs'),
    update: accessFor('update', 'appointment-logs'),
    delete: accessFor('delete', 'appointment-logs'),
  },
  admin: {
    group: crmLabels('groups.appointments'),
    defaultColumns: ['at', 'appointment', 'action', 'actorType', 'actor'],
  },
  defaultSort: '-at',
  timestamps: true,
  fields: [
    {
      name: 'appointment',
      type: 'relationship',
      relationTo: 'appointments',
      required: true,
      index: true,
      label: crmLabel('appointmentLogs.appointment'),
    },
    {
      name: 'location',
      type: 'relationship',
      relationTo: 'locations',
      index: true,
      admin: { hidden: true },
    },
    {
      name: 'barber',
      type: 'relationship',
      relationTo: 'barbers',
      index: true,
      admin: { hidden: true },
    },
    {
      type: 'row',
      fields: [
        {
          name: 'actorType',
          type: 'select',
          required: true,
          label: crmLabel('appointmentLogs.actorType'),
          options: ACTOR_TYPES.map((value) => ({
            value,
            label: crmLabel(`appointmentLogs.actorTypes.${value}`),
          })),
        },
        {
          name: 'actor',
          type: 'relationship',
          relationTo: 'users',
          label: crmLabel('appointmentLogs.actor'),
        },
        {
          name: 'action',
          type: 'select',
          required: true,
          label: crmLabel('appointmentLogs.action'),
          options: ACTIONS.map((value) => ({
            value,
            label: crmLabel(`appointmentLogs.actions.${value}`),
          })),
        },
        {
          name: 'at',
          type: 'date',
          required: true,
          index: true,
          label: crmLabel('appointmentLogs.at'),
          admin: { date: { pickerAppearance: 'dayAndTime', displayFormat: 'dd.MM.yyyy HH:mm:ss' } },
        },
      ],
    },
    {
      name: 'changes',
      type: 'array',
      label: crmLabel('appointmentLogs.changes'),
      fields: [
        {
          type: 'row',
          fields: [
            {
              name: 'field',
              type: 'text',
              required: true,
              label: crmLabel('appointmentLogs.field'),
            },
            // Any JSON value, plain strings included (Payload would require a string to be JSON text).
            { name: 'from', type: 'json', label: crmLabel('appointmentLogs.from'), validate: anyJson },
            { name: 'to', type: 'json', label: crmLabel('appointmentLogs.to'), validate: anyJson },
          ],
        },
      ],
    },
  ],
}
