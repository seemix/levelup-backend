/**
 * `GET /api/crm/clients/lookup?phone=` (spec §6.2): the client card by phone, admin and manager only
 * (a barber has no access to clients, decision 36). The phone is normalized to E.164 first.
 * → `{ client: { id, firstName, lastName, phone, email, language, blocked, notes } | null }`.
 */
import type { Where } from 'payload'

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

const SEARCH_MIN = 2
const SEARCH_LIMIT = 8
const SEARCH_MAX_TOKENS = 3
const SEARCH_MAX_LENGTH = 40

/**
 * `GET /api/crm/clients/search?q=` — clients by first name, last name or phone for the appointment
 * form (admin and manager only, like the lookup). The query is split into words; every word must
 * match the first name, the last name or the phone ("ivan petr" finds Ivan Petrenko), case-insensitive.
 * → `{ clients: [{ id, firstName, lastName, phone, blocked }] }`, at most 8, sorted by name.
 */
export const clientSearchEndpoint = crmEndpoint('get', '/clients/search', async (req) => {
  if (!allowed(req.user, 'read', 'clients')) throw crmError('FORBIDDEN', 403)
  const raw = (req.searchParams.get('q') ?? '').trim()
  const tokens = raw
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, SEARCH_MAX_TOKENS)
    .map((token) => token.slice(0, SEARCH_MAX_LENGTH))
  if (raw.length < SEARCH_MIN || tokens.length === 0) return ok({ clients: [] })

  const { docs } = await req.payload.find({
    collection: 'clients',
    where: {
      and: tokens.map((token): Where => ({
        or: [
          { firstName: { like: token } },
          { lastName: { like: token } },
          { phone: { like: token } },
        ],
      })),
    },
    sort: 'firstName',
    depth: 0,
    limit: SEARCH_LIMIT,
    pagination: false,
    overrideAccess: false,
    user: req.user,
    req,
    select: { firstName: true, lastName: true, phone: true, blocked: true },
  })
  return ok({
    clients: docs.slice(0, SEARCH_LIMIT).map((doc) => ({
      id: String(doc.id),
      firstName: doc.firstName,
      lastName: doc.lastName ?? null,
      phone: doc.phone,
      blocked: doc.blocked === true,
    })),
  })
})
