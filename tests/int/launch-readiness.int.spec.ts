// @vitest-environment node
import {
  commitTransaction,
  createLocalReq,
  getPayload,
  initTransaction,
  killTransaction,
  type Payload,
} from 'payload'
import { beforeAll, describe, expect, it } from 'vitest'

import { retryDelay } from '@/crm/appointments'
import { migrations } from '@/migrations'
import config from '@/payload.config'

/**
 * `payload migrate` and `prodMigrations` run every migration inside a transaction on the replica set
 * (production). Stage 23 found `count` without a filter failing there (`estimatedDocumentCount` is not
 * allowed in a transaction): run them all like that, on an empty database, twice.
 */
describe('migrations on a replica set, inside transactions', () => {
  let payload: Payload

  beforeAll(async () => {
    payload = await getPayload({ config: await config })
  })

  const runAll = async () => {
    for (const migration of migrations) {
      const req = await createLocalReq({}, payload)
      await initTransaction(req)
      expect(req.transactionID, migration.name).toBeTruthy()
      try {
        await migration.up({ payload, req } as never)
        await commitTransaction(req)
      } catch (error) {
        await killTransaction(req)
        throw new Error(`${migration.name}: ${(error as Error).message}`)
      }
    }
  }

  it('Payload migrate (the CLI and prodMigrations path) applies them all and skips them next time', async () => {
    const list = migrations
    await payload.db.migrate({ migrations: list as never })
    const { totalDocs } = await payload.count({
      collection: 'payload-migrations',
      where: { name: { exists: true } },
      overrideAccess: true,
    })
    expect(totalDocs).toBe(list.length)
    await payload.db.migrate({ migrations: list as never })
  })

  it('apply on an empty database and again (idempotent)', async () => {
    await runAll()
    await runAll()
    const { docs } = await payload.find({
      collection: 'locations',
      locale: 'ro',
      depth: 0,
      overrideAccess: true,
    })
    expect(docs.map((doc) => doc.name)).toEqual(['Bălți, Decebal 142'])
  })
})

describe('booking transaction retries (A42)', () => {
  it('the pause doubles with jitter and outlasts a slow winning transaction', () => {
    expect([0, 1, 2, 3].map((attempt) => retryDelay(attempt, 0))).toEqual([40, 80, 160, 320])
    expect([0, 1, 2, 3].map((attempt) => retryDelay(attempt, 0.999))).toEqual([79, 159, 319, 639])
    // Σ of the shortest pauses: a winner may hold the barber-day lock ~600 ms before the last retry.
    expect([0, 1, 2, 3].reduce((sum, attempt) => sum + retryDelay(attempt, 0), 0)).toBe(600)
  })
})
