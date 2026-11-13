import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { afterAll } from 'vitest'

// Integration tests always run against a throw-away in-memory MongoDB, never the .env database.
const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } })

process.env.DATABASE_URL = replSet.getUri('levelup-test')
process.env.PAYLOAD_SECRET = 'test-secret'
// CORS origin of the public booking API (same as the `env.frontendUrl` default).
process.env.FRONTEND_URL = 'http://localhost:3001'

afterAll(async () => {
  await replSet.stop()
})
