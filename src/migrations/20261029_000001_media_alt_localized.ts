import type { MigrateDownArgs, MigrateUpArgs } from '@payloadcms/db-mongodb'

// `media.alt` became localized: wrap existing plain strings into the default locale.
export async function up({ payload }: MigrateUpArgs): Promise<void> {
  await payload.db.collections['media'].updateMany({ alt: { $type: 'string' } }, [
    { $set: { alt: { ru: '$alt' } } },
  ])
}

export async function down({ payload }: MigrateDownArgs): Promise<void> {
  await payload.db.collections['media'].updateMany({ 'alt.ru': { $exists: true } }, [
    { $set: { alt: '$alt.ru' } },
  ])
}
