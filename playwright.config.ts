import { defineConfig, devices } from '@playwright/test'

import { BACKEND_URL, FRONTEND_URL, assertE2EDatabase } from './tests/e2e/env'

/**
 * E2E: run through `pnpm test:e2e` (scripts/e2e.ts), which creates a throw-away MongoDB and passes it
 * to the servers below and to the tests. Ports 3100 (backend) / 3101 (frontend) do not clash with the
 * usual dev servers; existing servers are never reused — they would point to another database.
 */
assertE2EDatabase()

const frontDir = process.env.E2E_FRONT_DIR as string

export default defineConfig({
  testDir: './tests/e2e',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // One shared database: the scenarios run one after another.
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? 'html' : 'list',
  use: {
    baseURL: BACKEND_URL,
    locale: 'en-US',
    timezoneId: 'Europe/Chisinau',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], channel: 'chromium' },
    },
  ],
  webServer: [
    {
      command: 'npx next dev -p 3100',
      url: `${BACKEND_URL}/api/booking/config`,
      reuseExistingServer: false,
      timeout: 300_000,
      env: { NODE_OPTIONS: '--no-deprecation' },
    },
    {
      command: 'npx next dev -p 3101',
      cwd: frontDir,
      url: `${FRONTEND_URL}/en`,
      reuseExistingServer: false,
      timeout: 300_000,
      env: {
        NEXT_PUBLIC_BOOKING_PROVIDER: 'native',
        NEXT_PUBLIC_API_URL: `${BACKEND_URL}/api`,
        NEXT_PUBLIC_BACKEND_URL: BACKEND_URL,
      },
    },
  ],
})
