/**
 * `GET /api/crm/new-appointments?since=<ISO>` — appointments created after `since`, for the
 * notifications of an open admin panel (polling).
 *
 * Without a valid `since` only `{ now }` comes back (the client starts listening from it). Only rows
 * the user may read are returned (a barber — their own); appointments created by the user themselves
 * are skipped. At most `LIMIT` newest items, ascending by creation time.
 */
import { ACTIVE_STATUSES } from '@/crm/appointment-status'
import { relationId } from '@/crm/schedule'

import { SYSTEM_READ } from '../booking/context'
import { localeOf, ok } from '../booking/http'
import { crmEndpoint } from './http'
import { canSeeDetails, loadNames, type AppointmentRow } from './view'

const LIMIT = 20

type CreatedRow = AppointmentRow & { createdAt: string | Date; createdBy?: unknown }

export const newAppointmentsEndpoint = crmEndpoint('get', '/new-appointments', async (req, staff) => {
  const now = new Date()
  const sinceText = new URL(req.url ?? 'http://localhost').searchParams.get('since')
  const since = sinceText ? new Date(sinceText) : null
  if (!since || Number.isNaN(since.getTime())) return ok({ now: now.toISOString(), items: [] })

  const locale = localeOf(req)
  const { docs } = await req.payload.find({
    collection: 'appointments',
    ...SYSTEM_READ,
    req,
    where: {
      and: [
        { createdAt: { greater_than: since.toISOString() } },
        { kind: { not_equals: 'block' } },
        { status: { in: [...ACTIVE_STATUSES] } },
      ],
    },
    sort: '-createdAt',
    limit: LIMIT * 3,
    select: {
      kind: true,
      status: true,
      location: true,
      barber: true,
      client: true,
      service: true,
      startAt: true,
      endAt: true,
      source: true,
      createdAt: true,
      createdBy: true,
    },
  })
  const own = String(req.user?.id ?? '')
  const rows = (docs as unknown as CreatedRow[])
    .filter((row) => relationId(row.createdBy as never) !== own && canSeeDetails(req, staff, row))
    .slice(0, LIMIT)
    .reverse()

  const names = await loadNames(req, rows, locale)
  const barberIds = [...new Set(rows.map((row) => relationId(row.barber)).filter(Boolean))] as string[]
  const barbers = new Map<string, string>()
  if (barberIds.length > 0) {
    const found = await req.payload.find({
      collection: 'barbers',
      ...SYSTEM_READ,
      req,
      where: { id: { in: barberIds } },
      select: { name: true },
    })
    for (const doc of found.docs) barbers.set(String(doc.id), doc.name ?? '')
  }

  return ok({
    now: now.toISOString(),
    items: rows.map((row) => {
      const client = names.clients.get(relationId(row.client) ?? '')
      return {
        id: String(row.id),
        start: new Date(row.startAt).toISOString(),
        client: client ? [client.firstName, client.lastName].filter(Boolean).join(' ') : '',
        barber: barbers.get(relationId(row.barber) ?? '') ?? '',
        source: row.source ?? null,
      }
    }),
  })
})
