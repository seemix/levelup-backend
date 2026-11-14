/** Addresses of the e2e servers (see playwright.config.ts) and the database guard. */
export const BACKEND_URL = 'http://localhost:3100'
export const FRONTEND_URL = 'http://localhost:3101'

/**
 * The e2e tests write to the database: they run only against the throw-away one created by
 * `scripts/e2e.ts`, never against the `.env` database.
 */
export const assertE2EDatabase = (): void => {
  const url = process.env.E2E_DATABASE_URL
  if (!url || process.env.DATABASE_URL !== url)
    throw new Error('E2E tests must be started with `pnpm test:e2e` (throw-away database).')
}
