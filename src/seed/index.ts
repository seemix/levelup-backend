/**
 * `pnpm seed` / `pnpm seed:reset` — run through `payload run` (env is loaded by Payload).
 * Refuses to run in production. `payload run` consumes CLI flags, so the reset is requested with
 * `SEED_RESET=true` (what `seed:reset` sets); `--reset` is read as a fallback.
 */
import { getPayload } from 'payload'

import { env } from '@/env'
import config from '@/payload.config'

import { runSeed } from './run'

const main = async () => {
  if (env.isProduction) throw new Error('Seed is disabled when NODE_ENV=production')
  if (!env.seedPassword) throw new Error('SEED_PASSWORD is not set (see .env.example)')

  const payload = await getPayload({ config: await config })
  const reset = process.argv.includes('--reset') || process.env.SEED_RESET === 'true'
  const summary = await runSeed(payload, {
    password: env.seedPassword,
    reset,
    log: (message) => payload.logger.info(`[seed] ${message}`),
  })
  payload.logger.info(`[seed] created: ${JSON.stringify(summary)}`)
}

// `payload run` exits as soon as this module has been imported, so the seed must be awaited here.
try {
  await main()
  process.exit(0)
} catch (error) {
  console.error(error)
  process.exit(1)
}
