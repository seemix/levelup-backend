import { getPayload, Payload } from 'payload'
import config from '@/payload.config'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

let payload: Payload
const created: { collection: 'users'; id: string | number }[] = []

const makeUser = async (roles: ('admin' | 'editor')[]) => {
  const user = await payload.create({
    collection: 'users',
    data: { email: `${roles.join('-')}-${Date.now()}@test.local`, password: 'test', roles },
  })
  created.push({ collection: 'users', id: user.id })
  return user
}

describe('access control', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
  })

  afterAll(async () => {
    for (const { collection, id } of created) await payload.delete({ collection, id })
  })

  it('denies anonymous user operations', async () => {
    const data = { email: 'anon@test.local', password: 'test', roles: ['admin' as const] }
    await expect(
      payload.create({ collection: 'users', data, overrideAccess: false }),
    ).rejects.toThrow()

    const { docs } = await payload.find({ collection: 'users', overrideAccess: false })
    expect(docs).toHaveLength(0)
  })

  it('denies anonymous writes to content', async () => {
    await expect(
      payload.create({
        collection: 'barbers',
        data: { name: 'x', description: 'x', about: undefined as never },
        overrideAccess: false,
      }),
    ).rejects.toThrow()
  })

  it('allows anonymous reads of public content', async () => {
    await expect(
      payload.find({ collection: 'barbers', overrideAccess: false }),
    ).resolves.toBeDefined()
  })

  it('lets an editor read only themselves and forbids user management', async () => {
    const admin = await makeUser(['admin'])
    const editor = await makeUser(['editor'])

    const { docs } = await payload.find({
      collection: 'users',
      user: { ...editor, collection: 'users' },
      overrideAccess: false,
    })
    expect(docs.map((d) => d.id)).toEqual([editor.id])

    await expect(
      payload.delete({
        collection: 'users',
        id: admin.id,
        user: { ...editor, collection: 'users' },
        overrideAccess: false,
      }),
    ).rejects.toThrow()
  })

  it('lets an admin read all users', async () => {
    const admin = await makeUser(['admin'])
    const { totalDocs } = await payload.find({
      collection: 'users',
      user: { ...admin, collection: 'users' },
      overrideAccess: false,
    })
    expect(totalDocs).toBeGreaterThanOrEqual(1)
  })
})
