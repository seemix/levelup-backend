import type { MigrateDownArgs, MigrateUpArgs } from '@payloadcms/db-mongodb'

/** The salon that existed before CRM. Existing users' roles are intentionally left untouched. */
export const DEFAULT_LOCATION = {
  phone: undefined,
  name: { ru: 'Бельцы, Дечебал 142', ro: 'Bălți, Decebal 142', en: 'Bălți, Decebal 142' },
  address: {
    ru: 'ул. Дечебал 142, Бельцы',
    ro: 'str. Decebal 142, Bălți',
    en: '142 Decebal St, Bălți',
  },
} as const

export async function up({ payload, req }: MigrateUpArgs): Promise<void> {
  // Not `count`: without a filter it is `estimatedDocumentCount`, which MongoDB refuses inside the
  // migration transaction on a replica set (production). A one-document find needs no count.
  const { docs: existing } = await payload.find({
    collection: 'locations',
    limit: 1,
    pagination: false,
    depth: 0,
    select: {},
    req,
  })
  if (existing.length === 0) {
    const { name, address } = DEFAULT_LOCATION
    const location = await payload.create({
      collection: 'locations',
      locale: 'ru',
      data: { name: name.ru, address: address.ru, active: true, order: 0 },
      req,
    })
    for (const locale of ['ro', 'en'] as const) {
      await payload.update({
        collection: 'locations',
        id: location.id,
        locale,
        data: { name: name[locale], address: address[locale] },
        req,
      })
    }
  }

  // Persist booking-settings defaults (spec §4.3) so they are stored, not only implied by the schema.
  const settings = await payload.db.findGlobal({ slug: 'booking-settings', req })
  if (!settings) await payload.updateGlobal({ slug: 'booking-settings', data: {}, req })
}

export async function down(_args: MigrateDownArgs): Promise<void> {
  // The location may already be referenced by users/records: it is not removed on rollback.
}
