import type { CollectionConfig } from 'payload'
import { accessFor } from '@/access/policy'

/**
 * Service documents of the double-booking guard (spec §5.9): one per barber and local day.
 * Booking transactions upsert it with `$inc version`, so concurrent bookings of the same barber
 * and day conflict. Written with the raw model only; hidden in the admin, no API access.
 */
export const BookingLocks: CollectionConfig = {
  slug: 'booking-locks',
  admin: { hidden: true },
  access: {
    read: accessFor('read', 'booking-locks'),
    create: accessFor('create', 'booking-locks'),
    update: accessFor('update', 'booking-locks'),
    delete: accessFor('delete', 'booking-locks'),
  },
  indexes: [{ fields: ['barber', 'date'], unique: true }],
  fields: [
    // Plain strings: the raw driver upserts them without casting.
    { name: 'barber', type: 'text', required: true },
    { name: 'date', type: 'text', required: true },
    { name: 'version', type: 'number', defaultValue: 0 },
  ],
}
