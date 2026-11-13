/**
 * Data of the appointment modal (spec §5.4, §5.11, §3.1, decisions 20, 30):
 * - `GET  /api/crm/appointments/:id` — details, price lines with names, promo code text and the
 *   change history. The row is read with the user's rights (out of scope → 404);
 * - `POST /api/crm/appointments/preview` — price preview for a selection (no write):
 *   `{ location, barber?, service, extras?, promoCode?, manualDiscount?, client? }` →
 *   `{ lines, durationMinutes, subtotal, promoDiscount, manualDiscount, total }`.
 *
 * A barber gets the history of their own appointments only (policy `appointment-logs`) and no user
 * e-mails in it; a manual discount in a preview is for admin/manager only (decision 30).
 */
import type { PayloadRequest } from 'payload'

import { allowed, type StaffContext } from '@/access/policy'
import { loadPriceItems } from '@/crm/appointments'
import { ruleError, toRuleError } from '@/crm/errors'
import { calculatePrice, type ManualDiscountInput, type PromoRule } from '@/crm/pricing'
import { findPromoById, validatePromo } from '@/crm/promo'
import { relationId } from '@/crm/schedule'

import { SYSTEM_READ } from '../booking/context'
import { InputErrors, isId, localeOf, ok, optionalText, readBody } from '../booking/http'
import { inLocationScope } from './access'
import { crmEndpoint, crmError, routeParam } from './http'
import { APPOINTMENT_SELECT, detailView, loadNames, scopeOf, type AppointmentRow } from './view'

const HISTORY_LIMIT = 100

type LogRow = {
  id: string | number
  action: string
  actorType: string
  actor?: string | number | { id: string | number } | null
  changes?: { field: string; from?: unknown; to?: unknown }[] | null
  at: string | Date
}

type LineRow = {
  itemType: 'service' | 'extra'
  item: string
  price: number
  durationMinutes: number
}

const readHistory = async (req: PayloadRequest, staff: StaffContext, id: string) => {
  const { docs } = await req.payload.find({
    collection: 'appointment-logs',
    ...SYSTEM_READ,
    req,
    where: { appointment: { equals: id } },
    sort: '-at',
    limit: HISTORY_LIMIT,
    pagination: true,
    select: { action: true, actorType: true, actor: true, changes: true, at: true },
  })
  const rows = docs as unknown as LogRow[]
  // User e-mails are shown to admin/manager only.
  const showActors = staff.isAdmin || staff.isManager
  const actorIds = showActors
    ? [
        ...new Set(
          rows.map((row) => relationId(row.actor as never)).filter((v): v is string => !!v),
        ),
      ]
    : []
  const emails = new Map<string, string>()
  if (actorIds.length > 0) {
    const { docs: users } = await req.payload.find({
      collection: 'users',
      ...SYSTEM_READ,
      req,
      where: { id: { in: actorIds } },
      select: { email: true },
    })
    for (const user of users) emails.set(String(user.id), user.email)
  }
  return rows.map((row) => {
    const actorId = relationId(row.actor as never)
    return {
      id: String(row.id),
      at: new Date(row.at).toISOString(),
      action: row.action,
      actorType: row.actorType,
      actor: actorId ? (emails.get(actorId) ?? null) : null,
      changes: (row.changes ?? []).map((change) => ({
        field: change.field,
        from: change.from ?? null,
        to: change.to ?? null,
      })),
    }
  })
}

export const appointmentDetailEndpoint = crmEndpoint(
  'get',
  '/appointments/:id',
  async (req, staff) => {
    const id = routeParam(req, 'id')
    if (!isId(id)) throw crmError('NOT_FOUND', 404)
    const row = (await req.payload.findByID({
      collection: 'appointments',
      id,
      depth: 0,
      overrideAccess: false,
      user: req.user,
      req,
      select: { ...APPOINTMENT_SELECT, lines: true },
    })) as unknown as AppointmentRow & { lines?: LineRow[] | null }

    const names = await loadNames(req, [row], localeOf(req))
    const label = (line: LineRow) =>
      (line.itemType === 'service' ? names.services : names.extras).get(String(line.item))?.name ??
      ''
    const promoId = relationId(row.promoCode)
    const promo = promoId ? await findPromoById(req, promoId) : null
    const scope = scopeOf(staff)
    return ok({
      appointment: detailView(row, names),
      lines: (row.lines ?? []).map((line) => ({
        itemType: line.itemType,
        item: String(line.item),
        name: label(line),
        price: line.price,
        durationMinutes: line.durationMinutes,
      })),
      promoCode: promo?.code ?? null,
      history: await readHistory(req, staff, id),
      can: {
        restore: allowed(req.user, 'create', 'appointments.restore'),
        discount: allowed(req.user, 'create', 'appointments.discount'),
        paid: allowed(req.user, 'update', 'appointments.paid'),
        update: allowed(req.user, 'update', 'appointments', row, scope),
      },
    })
  },
)

const parseManualDiscount = (errors: InputErrors, value: unknown): ManualDiscountInput | null => {
  if (value === undefined || value === null) return null
  const discount = value as Record<string, unknown>
  if (
    typeof discount !== 'object' ||
    (discount.type !== 'amount' && discount.type !== 'percent') ||
    typeof discount.value !== 'number' ||
    !Number.isFinite(discount.value) ||
    discount.value < 0
  ) {
    errors.add('manualDiscount')
    return null
  }
  return {
    type: discount.type,
    value: discount.value,
    reason: optionalText(errors, 'manualDiscount', discount.reason, 500),
  }
}

export const previewAppointmentEndpoint = crmEndpoint(
  'post',
  '/appointments/preview',
  async (req, staff) => {
    const body = await readBody(req)
    const errors = new InputErrors()
    const location = body.location
    if (!isId(location)) errors.add('location')
    const service = body.service
    if (!isId(service)) errors.add('service')
    let barber: string | null = null
    if (body.barber !== undefined && body.barber !== null) {
      if (isId(body.barber)) barber = body.barber
      else errors.add('barber')
    }
    const extras = body.extras ?? []
    if (!Array.isArray(extras) || extras.length > 20 || !extras.every(isId)) errors.add('extras')
    const promoText = optionalText(errors, 'promoCode', body.promoCode, 64)
    const client = isId(body.client) ? body.client : null
    const manual = parseManualDiscount(errors, body.manualDiscount)
    errors.throwIfAny()

    // A barber prices their own column only (decision 37).
    if (!staff.isAdmin && !staff.isManager) barber = staff.barberId
    if (!barber) throw crmError('VALIDATION_ERROR', 400, { fields: ['barber'] })
    if (!(await inLocationScope(req, staff, location as string))) throw crmError('FORBIDDEN', 403)
    if (manual && manual.value > 0 && !allowed(req.user, 'create', 'appointments.discount'))
      throw ruleError(req.t, 'DISCOUNT_FORBIDDEN', 403)

    const items = await loadPriceItems(req, {
      mode: 'staff',
      serviceId: service as string,
      extraIds: [...new Set(extras as string[])],
      barberId: barber,
    })
    let rule: PromoRule | null = null
    if (promoText)
      rule = (
        await validatePromo({
          req,
          code: promoText,
          mode: 'staff',
          lines: calculatePrice(items).lines,
          now: new Date(),
          clientId: client,
        })
      ).rule
    try {
      const price = calculatePrice({ ...items, promo: rule, manualDiscount: manual })
      return ok({
        lines: price.lines,
        durationMinutes: price.durationMinutes,
        subtotal: price.subtotal,
        promoDiscount: price.promoDiscount,
        manualDiscount: price.manualDiscount,
        total: price.total,
      })
    } catch (error) {
      throw toRuleError(req.t, error)
    }
  },
)
