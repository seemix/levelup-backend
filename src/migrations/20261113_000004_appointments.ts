import type { MigrateDownArgs, MigrateUpArgs } from '@payloadcms/db-mongodb'

/**
 * Stage 7 (spec §4.11, §4.12, §5.9): indexes of `appointments`, `appointment-logs` and the unique
 * `booking-locks {barber, date}`. Same keys/names as Mongoose declares from the schema.
 */
export async function up({ payload }: MigrateUpArgs): Promise<void> {
  const appointments = payload.db.collections['appointments'].collection
  await appointments.createIndex({ barber: 1, startAt: 1 }, { name: 'barber_1_startAt_1' })
  await appointments.createIndex({ location: 1, startAt: 1 }, { name: 'location_1_startAt_1' })
  await appointments.createIndex({ client: 1, startAt: 1 }, { name: 'client_1_startAt_1' })
  await appointments.createIndex({ startAt: 1 }, { name: 'startAt_1' })
  await appointments.createIndex({ status: 1 }, { name: 'status_1' })
  await appointments.createIndex({ promoCode: 1 }, { name: 'promoCode_1' })
  await appointments.createIndex({ cancelTokenHash: 1 }, { name: 'cancelTokenHash_1' })
  await appointments.createIndex({ externalId: 1 }, { name: 'externalId_1' })

  const logs = payload.db.collections['appointment-logs'].collection
  await logs.createIndex({ appointment: 1 }, { name: 'appointment_1' })
  await logs.createIndex({ location: 1 }, { name: 'location_1' })
  await logs.createIndex({ barber: 1 }, { name: 'barber_1' })
  await logs.createIndex({ at: 1 }, { name: 'at_1' })

  const locks = payload.db.collections['booking-locks'].collection
  await locks.createIndex({ barber: 1, date: 1 }, { name: 'barber_1_date_1', unique: true })
}

export async function down({ payload }: MigrateDownArgs): Promise<void> {
  // Indexes are also declared by the schema; nothing to roll back.
  void payload
}
