/**
 * `GET /api/crm/schedule-exceptions/preview?barber&dateFrom&dateTo` (spec §4.5, stage 20):
 * scheduled appointments of the barber in the range — the warning shown before a schedule exception
 * (day off, vacation, custom hours) is created from the calendar. Nothing is cancelled automatically.
 * Only for users who may create an exception for this barber (admin, manager of the barber).
 * → `{ count, appointments: [{ id, start }] }` (times only: no personal data).
 */
import type { Where } from 'payload'

import { allowed } from '@/access/policy'
import { validateDateRange } from '@/crm/schedule'
import { localDayRange } from '@/crm/time'

import { InputErrors, isId, ok } from '../booking/http'
import { crmEndpoint, crmError } from './http'

const LIST_LIMIT = 50

export const scheduleExceptionPreviewEndpoint = crmEndpoint(
  'get',
  '/schedule-exceptions/preview',
  async (req, staff) => {
    const errors = new InputErrors()
    const barber = req.searchParams.get('barber') ?? ''
    const dateFrom = req.searchParams.get('dateFrom') ?? ''
    const dateTo = req.searchParams.get('dateTo') ?? ''
    if (!isId(barber)) errors.add('barber')
    if (validateDateRange(dateFrom, dateTo)) errors.add('dateFrom')
    errors.throwIfAny()
    if (!allowed(req.user, 'create', 'schedule-exceptions', { barber }, staff))
      throw crmError('FORBIDDEN', 403)

    const where: Where = {
      and: [
        { barber: { equals: barber } },
        { kind: { equals: 'appointment' } },
        { status: { equals: 'scheduled' } },
        { startAt: { greater_than_equal: localDayRange(dateFrom).start.toISOString() } },
        { startAt: { less_than: localDayRange(dateTo).end.toISOString() } },
      ],
    }
    const { docs, totalDocs } = await req.payload.find({
      collection: 'appointments',
      where,
      depth: 0,
      limit: LIST_LIMIT,
      sort: 'startAt',
      overrideAccess: true, // access is decided above (policy), the response has no personal data
      select: { startAt: true },
      req,
    })
    return ok({
      count: totalDocs,
      appointments: docs.map((doc) => ({ id: String(doc.id), start: doc.startAt })),
    })
  },
)
