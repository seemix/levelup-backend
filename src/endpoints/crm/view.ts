/**
 * Appointment views of the CRM API with role-based field filtering (spec §3.1, decision 36):
 * - a row the user may read (`appointments` policy) → full details, the client's name and phone;
 * - any other row (a barber looking at a colleague's column) → only `{ start, end, busy }`.
 * The client's email is never part of a view.
 */
import type { PayloadRequest } from 'payload'

import { allowed, type PolicyScope, type StaffContext } from '@/access/policy'
import { relationId, type RelationValue } from '@/crm/schedule'

import { SYSTEM_READ } from '../booking/context'
import type { Locale } from '../booking/http'

export type AppointmentRow = {
  id: string | number
  kind?: 'appointment' | 'block' | null
  status?: string | null
  paymentStatus?: string | null
  location?: RelationValue
  barber?: RelationValue
  client?: RelationValue
  service?: RelationValue
  extras?: RelationValue[] | null
  startAt: string | Date
  endAt: string | Date
  durationMinutes?: number | null
  subtotal?: number | null
  promoCode?: RelationValue
  promoDiscount?: number | null
  manualDiscountType?: string | null
  manualDiscountValue?: number | null
  manualDiscount?: number | null
  manualDiscountReason?: string | null
  total?: number | null
  paidAmount?: number | null
  certificateAmount?: number | null
  source?: string | null
  language?: string | null
  clientComment?: string | null
  internalNote?: string | null
  cancelReason?: string | null
}

/** Stored fields a detailed view needs (never `cancelTokenHash`). */
export const APPOINTMENT_SELECT = {
  kind: true,
  status: true,
  paymentStatus: true,
  location: true,
  barber: true,
  client: true,
  service: true,
  extras: true,
  startAt: true,
  endAt: true,
  durationMinutes: true,
  subtotal: true,
  promoCode: true,
  promoDiscount: true,
  manualDiscountType: true,
  manualDiscountValue: true,
  manualDiscount: true,
  manualDiscountReason: true,
  total: true,
  paidAmount: true,
  certificateAmount: true,
  source: true,
  language: true,
  clientComment: true,
  internalNote: true,
  cancelReason: true,
} as const

export const scopeOf = (staff: StaffContext): PolicyScope => ({
  barberId: staff.barberId,
  managedBarberIds: staff.managedBarberIds,
})

/** May the user see the details of this appointment (same rule as the collection's row access)? */
export const canSeeDetails = (req: PayloadRequest, staff: StaffContext, row: AppointmentRow) =>
  allowed(req.user, 'read', 'appointments', row, scopeOf(staff))

type Named = { id: string; name: string }
type ClientView = { id: string; firstName: string; lastName: string | null; phone: string }

export type Names = {
  clients: Map<string, ClientView>
  services: Map<string, Named>
  extras: Map<string, Named>
}

const unique = (values: (string | null)[]) => [
  ...new Set(values.filter((value): value is string => Boolean(value))),
]

/**
 * Client names/phones and localized service/extra names of the given (detailed) rows:
 * at most three queries, whatever the number of rows. Clients are read on behalf of the system —
 * a barber has no access to the collection but sees the name and phone of their own clients (§3.1).
 */
export const loadNames = async (
  req: PayloadRequest,
  rows: readonly AppointmentRow[],
  locale: Locale,
): Promise<Names> => {
  const clientIds = unique(rows.map((row) => relationId(row.client)))
  const serviceIds = unique(rows.map((row) => relationId(row.service)))
  const extraIds = unique(rows.flatMap((row) => (row.extras ?? []).map(relationId)))
  const names: Names = { clients: new Map(), services: new Map(), extras: new Map() }
  // One after another: the request may carry a transaction session.
  if (clientIds.length > 0) {
    const { docs } = await req.payload.find({
      collection: 'clients',
      ...SYSTEM_READ,
      req,
      where: { id: { in: clientIds } },
      select: { firstName: true, lastName: true, phone: true },
    })
    for (const doc of docs)
      names.clients.set(String(doc.id), {
        id: String(doc.id),
        firstName: doc.firstName,
        lastName: doc.lastName ?? null,
        phone: doc.phone,
      })
  }
  for (const [collection, list, target] of [
    ['services', serviceIds, names.services],
    ['extras', extraIds, names.extras],
  ] as const) {
    if (list.length === 0) continue
    const { docs } = await req.payload.find({
      collection,
      ...SYSTEM_READ,
      req,
      locale,
      where: { id: { in: list } },
      select: { name: true },
    })
    for (const doc of docs) target.set(String(doc.id), { id: String(doc.id), name: doc.name ?? '' })
  }
  return names
}

const iso = (value: string | Date) => new Date(value).toISOString()

/** Busy-only view of an appointment the user may not see (decision 36). */
export const busyView = (row: AppointmentRow) => ({
  start: iso(row.startAt),
  end: iso(row.endAt),
  busy: true as const,
})

export const detailView = (row: AppointmentRow, names: Names) => {
  const clientId = relationId(row.client)
  const serviceId = relationId(row.service)
  return {
    id: String(row.id),
    kind: row.kind ?? 'appointment',
    status: row.status ?? 'scheduled',
    paymentStatus: row.paymentStatus ?? 'unpaid',
    start: iso(row.startAt),
    end: iso(row.endAt),
    durationMinutes: row.durationMinutes ?? 0,
    location: relationId(row.location),
    barber: relationId(row.barber),
    client: clientId
      ? (names.clients.get(clientId) ?? {
          id: clientId,
          firstName: '',
          lastName: null,
          phone: '',
        })
      : null,
    service: serviceId ? (names.services.get(serviceId) ?? { id: serviceId, name: '' }) : null,
    extras: (row.extras ?? [])
      .map(relationId)
      .filter((id): id is string => Boolean(id))
      .map((id) => names.extras.get(id) ?? { id, name: '' }),
    subtotal: row.subtotal ?? 0,
    promoCode: relationId(row.promoCode),
    promoDiscount: row.promoDiscount ?? 0,
    manualDiscountType: row.manualDiscountType ?? null,
    manualDiscountValue: row.manualDiscountValue ?? null,
    manualDiscount: row.manualDiscount ?? 0,
    manualDiscountReason: row.manualDiscountReason ?? null,
    total: row.total ?? 0,
    paidAmount: row.paidAmount ?? 0,
    certificateAmount: row.certificateAmount ?? 0,
    source: row.source ?? null,
    language: row.language ?? null,
    clientComment: row.clientComment ?? null,
    internalNote: row.internalNote ?? null,
    cancelReason: row.cancelReason ?? null,
  }
}

export type AppointmentView = ReturnType<typeof detailView>
export type BusyView = ReturnType<typeof busyView>
