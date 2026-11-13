import type { MigrateDownArgs, MigrateUpArgs } from '@payloadcms/db-mongodb'

/**
 * Stage 18 (spec §4.17, §5.7): indexes of `gift-certificates` (unique code — the final guard against
 * a duplicate generated code) and the certificate link of `transactions`. Same keys/names as
 * Mongoose declares from the schema. No data changes: the collection is new.
 */
export async function up({ payload }: MigrateUpArgs): Promise<void> {
  const certificates = payload.db.collections['gift-certificates'].collection
  await certificates.createIndex({ code: 1 }, { name: 'code_1', unique: true, sparse: true })
  await certificates.createIndex({ issuedAt: 1 }, { name: 'issuedAt_1' })
  await certificates.createIndex({ expiresAt: 1 }, { name: 'expiresAt_1' })

  const transactions = payload.db.collections['transactions'].collection
  await transactions.createIndex({ certificate: 1 }, { name: 'certificate_1' })
}

export async function down({ payload }: MigrateDownArgs): Promise<void> {
  await payload.db.collections['transactions'].collection
    .dropIndex('certificate_1')
    .catch(() => undefined)
}
