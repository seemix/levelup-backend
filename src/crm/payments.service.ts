/**
 * Payment and refund of appointments (spec §5.8, §5.7, §5.1, decisions 17, 28, 31, 32, A34).
 * Everything runs in one DB transaction (retried on write conflicts, then `LEDGER_CONFLICT`):
 *
 * `payAppointment`: the appointment (system read) → certificate check → `planPayment` (overpayment
 * refused) → `appointment_payment` with the user's rights (ledger hook: registers of the
 * appointment's location, policy — barber only own appointments, manager own locations) → atomic
 * conditional certificate charge → `paidAmount` / `certificateAmount` / status of
 * the appointment through the appointments service (row access, log `payment`).
 *
 * `refundPayment` (admin): `refund` with mirror entries (ledger hook; a second refund is refused)
 * → the certificate part goes back to the certificate → appointment totals, `paid → completed`,
 * `paymentStatus = refunded` when nothing is left paid, log `refund`.
 */
import type { PayloadRequest } from 'payload'

import {
  APPOINTMENT_CONTEXT,
  updateAppointment,
  type AppointmentDoc,
  type AppointmentInput,
} from './appointments'
import type { AppointmentStatus } from './appointment-status'
import { certificateChargeError } from './certificates'
import {
  certificateError,
  chargeCertificate,
  findCertificateByCode,
  returnToCertificate,
} from './certificates.service'
import { ruleError } from './errors'
import type { LedgerEntry } from './ledger'
import { sumBani } from './money'
import {
  createTransaction,
  runLedgerTransaction,
  type LedgerWarning,
  type TransactionDoc,
} from './ledger.service'
import {
  afterPayment,
  afterRefund,
  PaymentError,
  planPayment,
  type AppointmentMoney,
  type AppointmentPaymentState,
  type MoneyChange,
} from './payments'
import { relationId, type RelationValue } from './schedule'

type Data = Record<string, unknown>

type AppointmentRow = AppointmentMoney & { id: string; location: string; barber: string }

const num = (value: unknown): number => (typeof value === 'number' ? value : 0)

const loadAppointment = async (req: PayloadRequest, id: string): Promise<AppointmentRow> => {
  const { docs } = await req.payload.find({
    collection: 'appointments',
    where: { id: { equals: id } },
    limit: 1,
    pagination: false,
    depth: 0,
    overrideAccess: true,
    req,
    select: {
      kind: true,
      status: true,
      startAt: true,
      total: true,
      paidAmount: true,
      certificateAmount: true,
      location: true,
      barber: true,
    },
  })
  const doc = docs[0] as Data | undefined
  if (!doc) throw ruleError(req.t, 'APPOINTMENT_NOT_FOUND', 404)
  return {
    id,
    kind: (doc.kind as AppointmentRow['kind']) ?? 'appointment',
    status: doc.status as AppointmentStatus,
    startAt: new Date(doc.startAt as string),
    total: num(doc.total),
    paidAmount: num(doc.paidAmount),
    certificateAmount: num(doc.certificateAmount),
    location: relationId(doc.location as RelationValue) ?? '',
    barber: relationId(doc.barber as RelationValue) ?? '',
  }
}

/** Writes the new totals with the ledger flag (payment fields and `paid` may change). */
const applyToAppointment = async (
  req: PayloadRequest,
  appointment: AppointmentRow,
  state: AppointmentPaymentState,
  logAction: 'payment' | 'refund',
  now: Date,
): Promise<AppointmentDoc> => {
  const data: AppointmentInput & Data = {
    paidAmount: state.paidAmount,
    certificateAmount: state.certificateAmount,
  }
  if (state.status !== appointment.status) data.status = state.status
  req.context[APPOINTMENT_CONTEXT.ledger] = true
  try {
    const { doc } = await updateAppointment(req, appointment.id, data, {
      now,
      logAction,
      skipEmail: true,
    })
    return doc
  } finally {
    req.context[APPOINTMENT_CONTEXT.ledger] = false
  }
}

/** Amounts that conflict with the current state (already paid, certificate spent). */
const CONFLICT_CODES: string[] = ['PAYMENT_EXCEEDS_DUE', 'CERTIFICATE_INSUFFICIENT']

const rethrowPayment = (req: PayloadRequest, error: unknown): never => {
  if (error instanceof PaymentError)
    throw ruleError(req.t, error.code, CONFLICT_CODES.includes(error.code) ? 409 : 400)
  throw error
}

export type PaymentInput = {
  entries: LedgerEntry[]
  certificateCode?: string | null
  /** Explicit certificate amount; by default the certificate covers what the money does not. */
  certificateAmount?: number | null
  comment?: string | null
}

export type PaymentServiceResult = {
  transaction: TransactionDoc
  appointment: AppointmentDoc
  certificate: { id: string; code: string; balance: number } | null
  warnings: LedgerWarning[]
}

export const payAppointment = (
  req: PayloadRequest,
  appointmentId: string,
  input: PaymentInput,
  { now: clock }: { now?: Date } = {},
): Promise<PaymentServiceResult> =>
  runLedgerTransaction(req, async () => {
    const now = clock ?? new Date()
    const appointment = await loadAppointment(req, appointmentId)

    const certificate = input.certificateCode
      ? await findCertificateByCode(req, input.certificateCode)
      : null
    if (input.certificateCode) {
      // Status first (not found / void / expired); the amount is checked by the plan.
      const code = certificateChargeError(certificate, 1, now)
      if (code && code !== 'CERTIFICATE_INSUFFICIENT') certificateError(req, code)
    }

    let plan
    try {
      plan = planPayment(appointment, {
        entries: input.entries,
        certificateAmount: input.certificateAmount,
        certificateBalance: certificate ? certificate.balance : null,
      })
    } catch (error) {
      return rethrowPayment(req, error)
    }
    const usesCertificate = certificate !== null && plan.certificateAmount > 0

    const payment = await createTransaction(
      req,
      {
        type: 'appointment_payment',
        location: appointment.location,
        appointment: appointment.id,
        barber: appointment.barber,
        entries: input.entries,
        certificate: usesCertificate ? certificate.id : null,
        certificateAmount: usesCertificate ? plan.certificateAmount : null,
        comment: input.comment ?? null,
        occurredAt: now,
      },
      { now, allowServiceTypes: true },
    )
    const balance = usesCertificate
      ? await chargeCertificate(req, certificate.id, plan.certificateAmount, now)
      : null

    const doc = await applyToAppointment(
      req,
      appointment,
      afterPayment(appointment, plan, now),
      'payment',
      now,
    )
    return {
      transaction: payment.doc,
      appointment: doc,
      certificate:
        usesCertificate && balance !== null
          ? { id: certificate.id, code: certificate.code, balance }
          : null,
      warnings: payment.warnings,
    }
  })

export type RefundServiceResult = {
  transaction: TransactionDoc
  appointment: AppointmentDoc
  certificate: { id: string; balance: number } | null
  warnings: LedgerWarning[]
}

/** Refund of an `appointment_payment` (admin; the ledger hook enforces the type and the role). */
export const refundPayment = (
  req: PayloadRequest,
  paymentId: string,
  { comment, now: clock }: { comment?: string | null; now?: Date } = {},
): Promise<RefundServiceResult> =>
  runLedgerTransaction(req, async () => {
    const now = clock ?? new Date()
    const refund = await createTransaction(
      req,
      { type: 'refund', reverses: paymentId, comment: comment ?? null },
      { now, allowServiceTypes: true },
    )
    const doc = refund.doc
    const appointmentId = relationId(doc.appointment as RelationValue)
    if (!appointmentId) throw ruleError(req.t, 'APPOINTMENT_REQUIRED')

    const cash = (doc.entries as { amount: number }[] | undefined) ?? []
    const change: MoneyChange = {
      certificateAmount: num(doc.certificateAmount),
      // Mirror entries are negative: the money part returned is −Σentries.
      applied: -sumBani(cash.map((entry) => entry.amount)) + num(doc.certificateAmount),
    }
    const certificateId = relationId(doc.certificate as RelationValue)
    const balance =
      certificateId && change.certificateAmount > 0
        ? await returnToCertificate(req, certificateId, change.certificateAmount)
        : null

    const appointment = await loadAppointment(req, appointmentId)
    const updated = await applyToAppointment(
      req,
      appointment,
      afterRefund(appointment, change),
      'refund',
      now,
    )
    return {
      transaction: doc,
      appointment: updated,
      certificate: certificateId && balance !== null ? { id: certificateId, balance } : null,
      warnings: refund.warnings,
    }
  })
