import { test, expect, Page } from '@playwright/test'
import { login } from '../helpers/login'
import { BACKEND_URL } from './env'
import { seedTestUser, cleanupTestUser, testUser } from '../helpers/seedUser'

test.describe('Admin Panel', () => {
  let page: Page

  test.beforeAll(async ({ browser }) => {
    await seedTestUser()

    const context = await browser.newContext()
    page = await context.newPage()

    await login({ page, user: testUser })
  })

  test.afterAll(async () => {
    // Close the session first: the server writes the user's sessions while the page is open.
    await page.context().close()
    await cleanupTestUser()
  })

  test('can navigate to dashboard', async () => {
    await page.goto('/')
    await expect(page).toHaveURL(`${BACKEND_URL}/`)
    const dashboardArtifact = page.locator('span[title="Dashboard"]').first()
    await expect(dashboardArtifact).toBeVisible()
  })

  test('can navigate to list view', async () => {
    await page.goto('/collections/users')
    // The list view adds its query (`?depth=1&limit=10`).
    await expect(page).toHaveURL((url) => url.href.startsWith(`${BACKEND_URL}/collections/users`))
    const listViewArtifact = page.locator('h1', { hasText: 'Users' }).first()
    await expect(listViewArtifact).toBeVisible()
  })

  test('can navigate to edit view', async () => {
    await page.goto('/collections/users/create')
    await expect(page).toHaveURL(/\/collections\/users\/[a-zA-Z0-9-_]+/)
    const editViewArtifact = page.locator('input[name="email"]')
    await expect(editViewArtifact).toBeVisible()
  })
})
