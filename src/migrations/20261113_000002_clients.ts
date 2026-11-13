import type { MigrateDownArgs, MigrateUpArgs } from '@payloadcms/db-mongodb'

export const CLIENT_PHONE_INDEX = 'phone_1'

/**
 * Stage 4 (spec §4.10, §2.4): unique index on `clients.phone` (E.164).
 * Same keys/options as the index Mongoose declares from `unique: true`, so both are one index.
 * Fails loudly if duplicates already exist (clients is a new collection, so normally none).
 */
export async function up({ payload }: MigrateUpArgs): Promise<void> {
  const clients = payload.db.collections['clients']
  await clients.collection.createIndex({ phone: 1 }, { name: CLIENT_PHONE_INDEX, unique: true })
  await clients.collection.createIndex({ externalId: 1 }, { name: 'externalId_1' })
}

export async function down({ payload }: MigrateDownArgs): Promise<void> {
  // Indexes are also declared by the schema; nothing to roll back.
  void payload
}
