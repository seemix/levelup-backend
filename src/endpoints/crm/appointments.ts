/**
 * Appointment actions of the CRM calendar (spec §6.2, §5.1, §5.3 p.7, §5.10, decisions 20, 21, 30, 37):
 * - `POST  /api/crm/appointments` — appointment or time block (`kind = block`);
 * - `PATCH /api/crm/appointments/:id` — composition, move (time / barber / location), client,
 *   promo code, manual discount, notes;
 * - `POST  /api/crm/appointments/:id/status` — `{ status, reason? }`.
 *
 * Writes go through the appointments service with the user's `req` (`overrideAccess: false`), so
 * row access and the hook rules apply (scope, prices, slot under lock, status machine, history,
 * emails — a move queues the "moved" email). Warnings must be confirmed: without `confirm: true` the
 * transaction is rolled back and the answer is 409 `CONFIRMATION_REQUIRED` with `details.warnings`.
 */
import type { PayloadRequest } from 'payload'

import { allowed, type StaffContext } from '@/access/policy'
import { APPOINTMENT_KINDS, APPOINTMENT_STATUSES } from '@/crm/appointment-status'
import {
  changeAppointmentStatus,
  createAppointment,
  runBookingTransaction,
  updateAppointment,
  type AppointmentDoc,
  type AppointmentInput,
  type AppointmentServiceResult,
} from '@/crm/appointments'
import { ruleError } from '@/crm/errors'
import { findPromoByCode } from '@/crm/promo'

import { InputErrors, isId, isLocale, localeOf, ok, optionalText, readBody } from '../booking/http'
import {
  confirmationRequired,
  crmEndpoint,
  crmError,
  isConfirmed,
  routeParam,
  type CrmWarning,
} from './http'
import { detailView, loadNames, scopeOf, type AppointmentRow } from './view'

export const NOTE_MAX = 1000
export const REASON_MAX = 500
const MAX_BLOCK_MINUTES = 24 * 60

/** Body fields of create/patch; `undefined` = not sent (patch leaves the stored value). */
type ParsedInput = {
  data: AppointmentInput
  /** Raw promo code text: resolved to the document inside the transaction. */
  promoCode: string | null | undefined
  confirm: boolean
}

const has = (body: Record<string, unknown>, key: string) =>
  Object.prototype.hasOwnProperty.call(body, key) && body[key] !== undefined

const PATCH_FIELDS = [
  'location',
  'barber',
  'client',
  'service',
  'extras',
  'start',
  'durationMinutes',
  'promoCode',
  'manualDiscount',
  'clientComment',
  'internalNote',
  'language',
  'confirm',
] as const

/** Fields whose change is an intended price change (no `PRICE_CHANGED` warning for them). */
const PRICING_FIELDS = ['service', 'extras', 'promoCode', 'manualDiscount'] as const

export const parseAppointmentBody = (
  body: Record<string, unknown>,
  mode: 'create' | 'patch',
): ParsedInput => {
  const errors = new InputErrors()
  const data: AppointmentInput = {}

  if (mode === 'patch') {
    for (const key of Object.keys(body))
      if (!(PATCH_FIELDS as readonly string[]).includes(key)) errors.add(key)
  } else if (has(body, 'kind')) {
    if (!(APPOINTMENT_KINDS as readonly unknown[]).includes(body.kind)) errors.add('kind')
    else data.kind = body.kind as AppointmentInput['kind']
  }

  const id = (key: 'location' | 'barber' | 'service', required: boolean) => {
    if (!has(body, key)) {
      if (required) errors.add(key)
      return
    }
    if (body[key] === null && key === 'service') data.service = null
    else if (isId(body[key])) data[key] = body[key]
    else errors.add(key)
  }
  id('location', mode === 'create')
  id('barber', false)
  id('service', false)

  if (has(body, 'client')) {
    // `null` = "without a name" (decision 20).
    if (body.client === null) data.client = null
    else if (isId(body.client)) data.client = body.client
    else errors.add('client')
  }
  if (has(body, 'extras')) {
    const extras = body.extras
    if (!Array.isArray(extras) || extras.length > 20 || !extras.every(isId)) errors.add('extras')
    else data.extras = [...new Set(extras)]
  }
  if (has(body, 'start')) {
    const start = typeof body.start === 'string' ? new Date(body.start) : null
    if (!start || Number.isNaN(start.getTime())) errors.add('start')
    else data.startAt = start
  } else if (mode === 'create') errors.add('start')
  if (has(body, 'durationMinutes')) {
    const value = body.durationMinutes
    if (
      typeof value !== 'number' ||
      !Number.isInteger(value) ||
      value <= 0 ||
      value > MAX_BLOCK_MINUTES
    )
      errors.add('durationMinutes')
    else data.durationMinutes = value
  }

  let promoCode: string | null | undefined
  if (has(body, 'promoCode')) promoCode = optionalText(errors, 'promoCode', body.promoCode, 64)

  if (has(body, 'manualDiscount')) {
    const discount = body.manualDiscount as Record<string, unknown> | null
    if (discount === null) {
      data.manualDiscountType = null
      data.manualDiscountValue = null
      data.manualDiscountReason = null
    } else if (
      typeof discount !== 'object' ||
      (discount.type !== 'amount' && discount.type !== 'percent') ||
      typeof discount.value !== 'number' ||
      !Number.isFinite(discount.value) ||
      discount.value < 0
    ) {
      errors.add('manualDiscount')
    } else {
      data.manualDiscountType = discount.type
      data.manualDiscountValue = discount.value
      data.manualDiscountReason = optionalText(
        errors,
        'manualDiscount',
        discount.reason,
        REASON_MAX,
      )
    }
  }

  for (const key of ['clientComment', 'internalNote'] as const)
    if (has(body, key)) data[key] = optionalText(errors, key, body[key], NOTE_MAX)
  if (has(body, 'language')) {
    if (body.language === null) data.language = null
    else if (isLocale(body.language)) data.language = body.language
    else errors.add('language')
  }
  errors.throwIfAny()
  return { data, promoCode, confirm: isConfirmed(body.confirm) }
}

/** Promo code text → document id (`PROMO_NOT_FOUND`); full validation happens in the service. */
const resolvePromo = async (
  req: PayloadRequest,
  code: string | null | undefined,
): Promise<string | null | undefined> => {
  if (code === undefined || code === null) return code
  const promo = await findPromoByCode(req, code)
  if (!promo) throw ruleError(req.t, 'PROMO_NOT_FOUND', 404)
  return String(promo.id)
}

/** Service warnings that need a confirmation (all of them at the moment). */
const confirmable = (result: AppointmentServiceResult): CrmWarning[] => [...result.warnings]

/** The saved appointment as the user sees it, plus the confirmed warnings. */
const respond = async (req: PayloadRequest, doc: AppointmentDoc, warnings: CrmWarning[]) => {
  const row = doc as unknown as AppointmentRow
  const names = await loadNames(req, [row], localeOf(req))
  return ok({ appointment: detailView(row, names), warnings })
}

const readOwnAppointment = (req: PayloadRequest, id: string) =>
  req.payload.findByID({
    collection: 'appointments',
    id,
    depth: 0,
    overrideAccess: false,
    user: req.user,
    req,
    select: { total: true, paidAmount: true },
  })

export const createAppointmentEndpoint = crmEndpoint(
  'post',
  '/appointments',
  async (req, staff: StaffContext) => {
    const { data, promoCode, confirm } = parseAppointmentBody(await readBody(req), 'create')
    // A barber creates only in their own column (decision 37): the barber defaults to them.
    if (!data.barber && staff.barberId && !staff.isAdmin && !staff.isManager)
      data.barber = staff.barberId
    if (!data.barber) throw crmError('VALIDATION_ERROR', 400, { fields: ['barber'] })
    if (!allowed(req.user, 'create', 'appointments', data, scopeOf(staff)))
      throw crmError('FORBIDDEN', 403)

    const { doc, warnings } = await runBookingTransaction(req, async () => {
      const promo = await resolvePromo(req, promoCode)
      const result = await createAppointment(req, {
        ...data,
        ...(promo === undefined ? {} : { promoCode: promo }),
      })
      const warnings = confirmable(result)
      if (warnings.length > 0 && !confirm) throw confirmationRequired(warnings)
      return { doc: result.doc, warnings }
    })
    return respond(req, doc, warnings)
  },
)

export const patchAppointmentEndpoint = crmEndpoint('patch', '/appointments/:id', async (req) => {
  const id = routeParam(req, 'id')
  if (!isId(id)) throw crmError('NOT_FOUND', 404)
  const body = await readBody(req)
  const { data, promoCode, confirm } = parseAppointmentBody(body, 'patch')
  const pricingTouched = PRICING_FIELDS.some((key) => has(body, key))

  const { doc, warnings } = await runBookingTransaction(req, async () => {
    const before = await readOwnAppointment(req, id)
    const promo = await resolvePromo(req, promoCode)
    const result = await updateAppointment(req, id, {
      ...data,
      ...(promo === undefined ? {} : { promoCode: promo }),
    })
    const warnings = confirmable(result)
    const from = before.total ?? 0
    const to = (result.doc.total as number | null | undefined) ?? 0
    // §5.10: a move to another barber recalculates the price; payments make any change notable.
    if (from !== to && !pricingTouched) warnings.push('PRICE_CHANGED')
    if (from !== to && (before.paidAmount ?? 0) > 0) warnings.push('HAS_PAYMENTS')
    if (warnings.length > 0 && !confirm)
      throw confirmationRequired(warnings, { total: { from, to } })
    return { doc: result.doc, warnings }
  })
  return respond(req, doc, warnings)
})

export const appointmentStatusEndpoint = crmEndpoint(
  'post',
  '/appointments/:id/status',
  async (req) => {
    const id = routeParam(req, 'id')
    if (!isId(id)) throw crmError('NOT_FOUND', 404)
    const body = await readBody(req)
    const errors = new InputErrors()
    const status = body.status
    if (!(APPOINTMENT_STATUSES as readonly unknown[]).includes(status)) errors.add('status')
    const reason = optionalText(errors, 'reason', body.reason, REASON_MAX)
    errors.throwIfAny()

    const { doc, warnings } = await runBookingTransaction(req, async () => {
      // Out of scope → 404, like PATCH (existence is not revealed).
      await readOwnAppointment(req, id)
      const result = await changeAppointmentStatus(
        req,
        id,
        status as (typeof APPOINTMENT_STATUSES)[number],
        reason === null ? {} : { cancelReason: reason },
      )
      const warnings = confirmable(result)
      if (warnings.length > 0 && !isConfirmed(body.confirm)) throw confirmationRequired(warnings)
      return { doc: result.doc, warnings }
    })
    return respond(req, doc, warnings)
  },
)
