import type { MigrateDownArgs, MigrateUpArgs } from '@payloadcms/db-mongodb'

// New `order` field: keep the existing creation order for barbers and slides.
export async function up({ payload }: MigrateUpArgs): Promise<void> {
  for (const slug of ['barbers', 'slides']) {
    const model = payload.db.collections[slug]
    const docs = await model
      .find({ order: { $exists: false } })
      .sort({ createdAt: 1 })
      .lean()
    await Promise.all(
      docs.map((doc, index) => model.updateOne({ _id: doc._id }, { $set: { order: index } })),
    )
  }
}

export async function down(_args: MigrateDownArgs): Promise<void> {}
