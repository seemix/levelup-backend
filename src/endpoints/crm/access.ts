/**
 * Location scope of a staff user for the CRM endpoints (spec §3.1):
 * admin — every location, manager — `users.locations`, barber — the locations of their barber.
 * Roles are combined with OR (A15).
 */
import type { PayloadRequest } from 'payload'

import type { StaffContext } from '@/access/policy'
import { relationId, type RelationValue } from '@/crm/schedule'

import { SYSTEM_READ } from '../booking/context'

/** `'all'` for admin, otherwise the explicit set of location ids (one query for a barber). */
export const locationScope = async (
  req: PayloadRequest,
  staff: StaffContext,
): Promise<'all' | Set<string>> => {
  if (staff.isAdmin) return 'all'
  const ids = new Set(staff.isManager ? staff.locationIds : [])
  if (staff.isBarber && staff.barberId) {
    const { docs } = await req.payload.find({
      collection: 'barbers',
      ...SYSTEM_READ,
      req,
      where: { id: { equals: staff.barberId } },
      limit: 1,
      select: { locations: true },
    })
    for (const id of ((docs[0]?.locations ?? []) as RelationValue[]).map(relationId))
      if (id) ids.add(id)
  }
  return ids
}

/** Does the user's location scope include `locationId`? */
export const inLocationScope = async (
  req: PayloadRequest,
  staff: StaffContext,
  locationId: string,
): Promise<boolean> => {
  const scope = await locationScope(req, staff)
  return scope === 'all' || scope.has(locationId)
}
