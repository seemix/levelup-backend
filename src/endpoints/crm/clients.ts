/**
 * `GET /api/crm/clients/lookup?phone=` (spec §6.2): the client card by phone, admin and manager only
 * (a barber has no access to clients, decision 36). The phone is normalized to E.164 first.
 * → `{ client: { id, firstName, lastName, phone, email, language, blocked, notes } | null }`.
 */
import { allowed } from '@/access/policy'
import { tryNormalizePhone } from '@/crm/phone'

import { ok } from '../booking/http'
import { crmEndpoint, crmError } from './http'

export const clientLookupEndpoint = crmEndpoint('get', '/clients/lookup', async (req) => {
  if (!allowed(req.user, 'read', 'clients')) throw crmError('FORBIDDEN', 403)
  const raw = req.searchParams.get('phone') ?? ''
  const phone = raw.length <= 32 ? tryNormalizePhone(raw) : null
  if (!phone) throw crmError('PHONE_INVALID', 400)

  const { docs } = await req.payload.find({
    collection: 'clients',
    where: { phone: { equals: phone } },
    depth: 0,
    limit: 1,
    pagination: false,
    overrideAccess: false,
    user: req.user,
    req,
    select: {
      firstName: true,
      lastName: true,
      phone: true,
      email: true,
      language: true,
      blocked: true,
      notes: true,
    },
  })
  const doc = docs[0]
  return ok({
    client: doc
      ? {
          id: String(doc.id),
          firstName: doc.firstName,
          lastName: doc.lastName ?? null,
          phone: doc.phone,
          // Field access decides (admin, manager); never another role.
          email: doc.email ?? null,
          language: doc.language ?? 'ru',
          blocked: doc.blocked === true,
          notes: doc.notes ?? null,
        }
      : null,
  })
})
