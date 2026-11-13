import type { MigrateDownArgs, MigrateUpArgs } from '@payloadcms/db-mongodb'
import { barberColorAt, isHexColor } from '@/crm/colors'

export const BARBER_USER_INDEX = 'barbers_user_unique'
export const BARBER_PRICE_INDEX = 'barber_prices_barber_item_unique'

/**
 * Stage 3 (spec §4.4): CRM defaults for barbers created before the CRM, and uniqueness indexes.
 * - `active`, `showOnSite`, `onlineBooking` = true; a distinct palette `color` by `order`;
 *   `locations` = the first active location (the pre-CRM salon). Existing values are kept.
 * - `barbers.user` unique among linked barbers (partial index: many barbers may have no user).
 * - `barber-prices` (barber, item) unique (spec §4.9).
 */
export async function up({ payload }: MigrateUpArgs): Promise<void> {
  const barbers = payload.db.collections['barbers']
  const locations = payload.db.collections['locations']

  for (const field of ['active', 'showOnSite', 'onlineBooking']) {
    await barbers.updateMany({ [field]: { $exists: false } }, { $set: { [field]: true } })
  }

  const docs = await barbers.find({}).sort({ order: 1, createdAt: 1 }).lean()
  const location = (await locations
    .findOne({ active: true })
    .sort({ order: 1, createdAt: 1 })
    .lean()) as { _id: unknown } | null

  for (const [index, doc] of docs.entries()) {
    const set: Record<string, unknown> = {}
    if (!isHexColor(doc.color)) set.color = barberColorAt(index)
    if (location && (!Array.isArray(doc.locations) || doc.locations.length === 0)) {
      set.locations = [location._id]
    }
    if (Object.keys(set).length > 0) await barbers.updateOne({ _id: doc._id }, { $set: set })
  }

  await barbers.collection.createIndex(
    { user: 1 },
    { name: BARBER_USER_INDEX, unique: true, partialFilterExpression: { user: { $type: 'objectId' } } },
  )
  await payload.db.collections['barber-prices'].collection.createIndex(
    { barber: 1, 'item.relationTo': 1, 'item.value': 1 },
    { name: BARBER_PRICE_INDEX, unique: true },
  )
}

export async function down({ payload }: MigrateDownArgs): Promise<void> {
  // Field defaults are kept (ignored by the previous schema); only the indexes are dropped.
  await payload.db.collections['barbers'].collection.dropIndex(BARBER_USER_INDEX).catch(() => {})
  await payload.db.collections['barber-prices'].collection
    .dropIndex(BARBER_PRICE_INDEX)
    .catch(() => {})
}
