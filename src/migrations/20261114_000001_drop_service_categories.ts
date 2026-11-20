import type { MigrateDownArgs, MigrateUpArgs } from '@payloadcms/db-mongodb'

/**
 * Service categories removed (A47): the `service-categories` collection is gone and services no
 * longer reference a category. Unsets `services.category` and drops its index, drops the
 * collection and its admin traces (list preferences, document locks).
 * Irreversible: `down` does not restore the categories.
 */
export async function up({ payload }: MigrateUpArgs): Promise<void> {
  const services = payload.db.collections['services'].collection
  await services.updateMany({ category: { $exists: true } }, { $unset: { category: '' } })
  await services.dropIndex('category_1').catch(() => undefined)

  const db = payload.db.connection.db
  if (!db) return
  if ((await db.listCollections({ name: 'service-categories' }).toArray()).length > 0) {
    await db.dropCollection('service-categories')
  }
  await db
    .collection('payload-preferences')
    .deleteMany({ key: { $regex: '^collection-service-categories' } })
  await db
    .collection('payload-locked-documents')
    .deleteMany({ 'document.relationTo': 'service-categories' })
}

export async function down(_args: MigrateDownArgs): Promise<void> {}
