/**
 * E2E launcher (`pnpm test:e2e`): a throw-away in-memory MongoDB replica set, `payload migrate` on it,
 * then Playwright, which starts the backend (port 3100) and the frontend `../levelup-front` (port 3101)
 * with this database. The developer's `.env` database is never touched: the URL is set here and every
 * process inherits it (Next does not override variables that already exist).
 *
 * Stop `pnpm dev` of both repositories first: two `next dev` in one project share `.next`.
 * Arguments are passed to Playwright: `pnpm test:e2e -- booking --headed`.
 */
import { spawn } from 'node:child_process'
import path from 'node:path'

import { MongoMemoryReplSet } from 'mongodb-memory-server'

const run = (command: string, args: string[], env: NodeJS.ProcessEnv): Promise<number> =>
  new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      env,
      shell: process.platform === 'win32',
    })
    child.on('exit', (code) => resolve(code ?? 1))
  })

const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } })
const databaseUrl = replSet.getUri('levelup-e2e')

const env: NodeJS.ProcessEnv = {
  ...process.env,
  DATABASE_URL: databaseUrl,
  // The tests refuse to run unless DATABASE_URL equals this one (see tests/e2e/env.ts).
  E2E_DATABASE_URL: databaseUrl,
  PAYLOAD_SECRET: 'e2e-secret',
  BACKEND_URL: 'http://localhost:3100',
  FRONTEND_URL: 'http://localhost:3101',
  COOKIE_DOMAIN: '',
  // No real emails and no background jobs during e2e.
  RESEND_API_KEY: '',
  JOBS_AUTORUN: 'false',
  TRUSTED_PROXY_HOPS: '0',
  E2E_FRONT_DIR: process.env.E2E_FRONT_DIR ?? path.resolve('..', 'levelup-front'),
}

let code = 1
try {
  code = await run('npx', ['payload', 'migrate'], {
    ...env,
    NODE_OPTIONS: '--no-deprecation',
  })
  if (code === 0)
    code = await run(
      'npx',
      ['playwright', 'test', '--config=playwright.config.ts', ...process.argv.slice(2)],
      { ...env, NODE_OPTIONS: '--no-deprecation --import=tsx/esm' },
    )
} finally {
  await replSet.stop()
}
process.exit(code)
