import type { GlobalConfig, NumberField } from 'payload'
import { accessFor, fieldAccessFor } from '@/access/policy'
import { settingsGroup } from '@/fields'
import { crmLabel, crmT, type CrmKey } from '@/i18n'

const integerField = (
  name: string,
  label: CrmKey,
  defaultValue: number,
  min: number,
  max?: number,
): NumberField => ({
  name,
  type: 'number',
  required: true,
  defaultValue,
  min,
  max,
  label: crmLabel(label),
  validate: (value: number | null | undefined, { req: { t } }) => {
    if (typeof value !== 'number' || !Number.isInteger(value))
      return crmT(t, 'errors.integerRequired')
    if (value < min || (max !== undefined && value > max))
      return crmT(t, 'errors.outOfRange', { min, max: max ?? '∞' })
    return true
  },
})

/** Non-public fields: hidden from anonymous readers (spec §3.1 — "public fields"). */
const privateAccess = {
  read: fieldAccessFor('read', 'booking-settings.private'),
  update: fieldAccessFor('update', 'booking-settings.private'),
}

export const BookingSettings: GlobalConfig = {
  slug: 'booking-settings',
  label: crmLabel('bookingSettings.label'),
  access: {
    read: accessFor('read', 'booking-settings'),
    update: accessFor('update', 'booking-settings'),
  },
  admin: {
    group: settingsGroup,
  },
  fields: [
    {
      name: 'onlineBookingEnabled',
      type: 'checkbox',
      required: true,
      defaultValue: true,
      label: crmLabel('bookingSettings.onlineBookingEnabled'),
    },
    {
      type: 'row',
      fields: [
        integerField('slotStepMinutes', 'bookingSettings.slotStepMinutes', 15, 5, 120),
        integerField('minLeadMinutes', 'bookingSettings.minLeadMinutes', 120, 0),
        integerField('horizonDays', 'bookingSettings.horizonDays', 30, 1, 365),
      ],
    },
    {
      type: 'row',
      fields: [
        integerField('clientCancelMinHours', 'bookingSettings.clientCancelMinHours', 3, 0),
        integerField('reminderHoursBefore', 'bookingSettings.reminderHoursBefore', 24, 0),
        integerField('bufferMinutes', 'bookingSettings.bufferMinutes', 0, 0, 120),
      ],
    },
    {
      type: 'row',
      fields: [
        {
          name: 'senderName',
          type: 'text',
          label: crmLabel('bookingSettings.senderName'),
          access: privateAccess,
        },
        {
          name: 'replyTo',
          type: 'email',
          label: crmLabel('bookingSettings.replyTo'),
          access: privateAccess,
        },
      ],
    },
  ],
}
