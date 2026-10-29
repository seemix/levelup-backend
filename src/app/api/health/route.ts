import configPromise from '@payload-config'
import { getPayload } from 'payload'

export const dynamic = 'force-dynamic'

export const GET = async () => {
  try {
    const payload = await getPayload({ config: configPromise })
    await payload.db.connection.db?.admin().ping()
    return Response.json({ status: 'ok' })
  } catch {
    return Response.json({ status: 'error' }, { status: 503 })
  }
}
