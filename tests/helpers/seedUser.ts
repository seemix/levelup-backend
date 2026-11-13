import { getPayload } from 'payload'
import config from '../../src/payload.config'

export const testUser = {
  email: 'dev@payloadcms.com',
  password: 'test',
  roles: ['admin'] as ('admin' | 'manager' | 'barber' | 'editor')[],
}

/**
 * Seeds a test admin user for e2e admin tests.
 */
export async function seedTestUser(): Promise<void> {
  const payload = await getPayload({ config })

  await payload.delete({
    collection: 'users',
    where: { email: { equals: testUser.email } },
  })

  await payload.create({
    collection: 'users',
    data: testUser,
  })
}

/**
 * Cleans up test user after tests
 */
export async function cleanupTestUser(): Promise<void> {
  const payload = await getPayload({ config })

  await payload.delete({
    collection: 'users',
    where: { email: { equals: testUser.email } },
  })
}
