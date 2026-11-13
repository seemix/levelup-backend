/**
 * Gift certificates (spec §4.17, §5.7, decisions 28–29, A6): pure rules, no database.
 * The database side (sale, lookup, atomic charge / return, collection hooks) lives in
 * `./certificates.service`.
 */
import { randomBytes } from 'node:crypto'

import { isBani } from './money'
import { addLocalMonths } from './time'

/**
 * Code alphabet without look-alike characters (A6: no 0/O, 1/I). 32 symbols, so one random byte
 * gives one symbol without bias (`byte & 31`).
 */
export const CERTIFICATE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export const CERTIFICATE_CODE_RE = new RegExp(
  `^LU-[${CERTIFICATE_ALPHABET}]{4}-[${CERTIFICATE_ALPHABET}]{4}$`,
)

/** Default validity of a sold certificate (§5.7). */
export const CERTIFICATE_VALIDITY_MONTHS = 12

/** Derived status (§4.17); `void` is set by an admin, the rest follows from balance and date. */
export const CERTIFICATE_STATUSES = ['active', 'depleted', 'expired', 'void'] as const
export type CertificateStatus = (typeof CERTIFICATE_STATUSES)[number]

export type CertificateErrorCode =
  'CERTIFICATE_NOT_FOUND' | 'CERTIFICATE_EXPIRED' | 'CERTIFICATE_VOID' | 'CERTIFICATE_INSUFFICIENT'

/** `LU-XXXX-XXXX` from 8 random bytes (`random` is injectable for tests). */
export const generateCertificateCode = (
  random: (size: number) => Uint8Array = randomBytes,
): string => {
  const bytes = random(8)
  const chars = Array.from(bytes.slice(0, 8), (byte) => CERTIFICATE_ALPHABET[byte & 31])
  return `LU-${chars.slice(0, 4).join('')}-${chars.slice(4).join('')}`
}

/** `lu-abcd efgh` in any case and spacing → `LU-ABCD-EFGH` (dashes are restored when missing). */
export const normalizeCertificateCode = (raw: string): string => {
  const compact = raw.replace(/[\s-]+/g, '').toUpperCase()
  return /^LU[A-Z0-9]{8}$/.test(compact)
    ? `LU-${compact.slice(2, 6)}-${compact.slice(6)}`
    : raw.replace(/\s+/g, '').toUpperCase()
}

export const isCertificateCode = (value: string): boolean => CERTIFICATE_CODE_RE.test(value)

/** Default expiry: the same local moment 12 months after the sale. */
export const defaultExpiry = (issuedAt: Date): Date =>
  addLocalMonths(issuedAt, CERTIFICATE_VALIDITY_MONTHS)

export type CertificateState = {
  balance?: number | null
  expiresAt?: string | Date | null
  voided?: boolean | null
}

export const certificateStatus = (certificate: CertificateState, now: Date): CertificateStatus => {
  if (certificate.voided) return 'void'
  const expiresAt = certificate.expiresAt ? new Date(certificate.expiresAt) : null
  if (!expiresAt || expiresAt <= now) return 'expired'
  return (certificate.balance ?? 0) > 0 ? 'active' : 'depleted'
}

/**
 * Can `amount` be charged now (§5.7)? A depleted certificate is "insufficient", the other
 * non-active states have their own codes. Returns `null` when the charge is allowed.
 */
export const certificateChargeError = (
  certificate: CertificateState | null,
  amount: number,
  now: Date,
): CertificateErrorCode | null => {
  if (!certificate) return 'CERTIFICATE_NOT_FOUND'
  const status = certificateStatus(certificate, now)
  if (status === 'void') return 'CERTIFICATE_VOID'
  if (status === 'expired') return 'CERTIFICATE_EXPIRED'
  if (!isBani(amount) || amount <= 0 || amount > (certificate.balance ?? 0))
    return 'CERTIFICATE_INSUFFICIENT'
  return null
}
