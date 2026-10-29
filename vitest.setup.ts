import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { afterAll } from 'vitest'

// Integration tests always run against a throw-away in-memory MongoDB, never the .env database.
const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } })

process.env.DATABASE_URL = replSet.getUri('levelup-test')
process.env.PAYLOAD_SECRET = 'test-secret'

afterAll(async () => {
  await replSet.stop()
})
