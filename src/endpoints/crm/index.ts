import type { Endpoint } from 'payload'

import {
  appointmentStatusEndpoint,
  createAppointmentEndpoint,
  patchAppointmentEndpoint,
} from './appointments'
import { appointmentDetailEndpoint, previewAppointmentEndpoint } from './appointment-detail'
import { calendarEndpoint } from './calendar'
import { clientLookupEndpoint } from './clients'
import {
  appointmentPaymentEndpoint,
  refundTransactionEndpoint,
  sellCertificateEndpoint,
} from './payments'
import { financeReportEndpoint, salaryReportEndpoint } from './finance-reports'
import { clientCardReportEndpoint, clientsReportEndpoint } from './reports'
import { scheduleExceptionPreviewEndpoint } from './schedule-exceptions'
import { staffSlotsEndpoint } from './slots'
import { reverseTransactionEndpoint } from './transactions'

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
  reverseTransactionEndpoint,
  appointmentPaymentEndpoint,
  refundTransactionEndpoint,
  sellCertificateEndpoint,
  scheduleExceptionPreviewEndpoint,
  clientsReportEndpoint,
  clientCardReportEndpoint,
  financeReportEndpoint,
  salaryReportEndpoint,
]
