import type { MigrateDownArgs, MigrateUpArgs } from '@payloadcms/db-mongodb'

/** One refund / reversal per operation: unique `reverses` among documents that have it. */
export const REVERSES_INDEX = 'reverses_unique'

/**
 * Stage 17 (spec §4.13–§4.15, §5.6): indexes of `cash-registers` and `transactions`. Same keys/names
 * as Mongoose declares from the schema, plus the partial unique index on `reverses` — the last guard
 * against a second reversal of one operation (the ledger hook also flips `reversed` conditionally).
 */
export async function up({ payload }: MigrateUpArgs): Promise<void> {
  const registers = payload.db.collections['cash-registers'].collection
  await registers.createIndex({ location: 1 }, { name: 'location_1' })

  const transactions = payload.db.collections['transactions'].collection
  await transactions.createIndex({ occurredAt: 1 }, { name: 'occurredAt_1' })
  await transactions.createIndex({ location: 1 }, { name: 'location_1' })
  await transactions.createIndex({ type: 1 }, { name: 'type_1' })
  await transactions.createIndex({ appointment: 1 }, { name: 'appointment_1' })
  await transactions.createIndex({ barber: 1 }, { name: 'barber_1' })
  await transactions.createIndex({ expenseCategory: 1 }, { name: 'expenseCategory_1' })
  await transactions.createIndex({ reversed: 1 }, { name: 'reversed_1' })
  await transactions.createIndex({ 'entries.cashRegister': 1 }, { name: 'entries.cashRegister_1' })
  await transactions.createIndex(
    { reverses: 1 },
    {
      name: REVERSES_INDEX,
      unique: true,
      partialFilterExpression: { reverses: { $type: 'objectId' } },
    },
  )
}

export async function down({ payload }: MigrateDownArgs): Promise<void> {
  await payload.db.collections['transactions'].collection
    .dropIndex(REVERSES_INDEX)
    .catch(() => undefined)
}
