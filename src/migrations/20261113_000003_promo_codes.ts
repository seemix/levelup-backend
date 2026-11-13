import type { MigrateDownArgs, MigrateUpArgs } from '@payloadcms/db-mongodb'

export const PROMO_CODE_INDEX = 'code_1'

/**
 * Stage 6 (spec §4.16, §5.5): unique index on `promo-codes.code` (stored upper-cased without spaces).
 * Same keys/options as the index Mongoose declares from `unique: true`, so both are one index.
 */
export async function up({ payload }: MigrateUpArgs): Promise<void> {
  const promoCodes = payload.db.collections['promo-codes']
  await promoCodes.collection.createIndex({ code: 1 }, { name: PROMO_CODE_INDEX, unique: true })
  await promoCodes.collection.createIndex({ active: 1 }, { name: 'active_1' })
}

export async function down({ payload }: MigrateDownArgs): Promise<void> {
  // Indexes are also declared by the schema; nothing to roll back.
  void payload
}
