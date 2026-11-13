import type { Endpoint } from 'payload'

import {
  appointmentStatusEndpoint,
  createAppointmentEndpoint,
  patchAppointmentEndpoint,
} from './appointments'
import { appointmentDetailEndpoint, previewAppointmentEndpoint } from './appointment-detail'
import { calendarEndpoint } from './calendar'
import { clientLookupEndpoint } from './clients'
import { staffSlotsEndpoint } from './slots'

/** Staff API of the calendar `/api/crm/*` (spec §6.2); examples — `docs/api-crm.http`. */
export const crmEndpoints: Endpoint[] = [
  calendarEndpoint,
  staffSlotsEndpoint,
  createAppointmentEndpoint,
  patchAppointmentEndpoint,
  appointmentStatusEndpoint,
  clientLookupEndpoint,
  appointmentDetailEndpoint,
  previewAppointmentEndpoint,
]
