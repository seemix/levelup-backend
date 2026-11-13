/**
 * Gift certificate lookup for the online booking (spec §5.7 "online": the code is only checked and
 * the amount to pay is shown after the certificate; it is charged at payment in the salon).
 *
 * The `gift-certificates` collection arrives in stage 18; until then the lookup is a stub that finds
 * nothing (`CERTIFICATE_NOT_FOUND`). Stage 18 replaces it with `setCertificateLookup`.
 */
import type { PayloadRequest } from 'payload'

/** A usable certificate (active, not expired, balance > 0); anything else is "not found". */
export type CertificateInfo = { code: string; balance: number }

export type CertificateLookup = (
  req: PayloadRequest,
  code: string,
) => Promise<CertificateInfo | null>

/** `LU-XXXX-XXXX` in any case and spacing → upper case without spaces. */
export const normalizeCertificateCode = (raw: string): string =>
  raw.replace(/\s+/g, '').toUpperCase()

// TODO(stage 18): look the code up in `gift-certificates`.
const noCertificates: CertificateLookup = async () => null

let lookup: CertificateLookup = noCertificates

export const findCertificate: CertificateLookup = (req, code) =>
  lookup(req, normalizeCertificateCode(code))

/** Replaces the lookup (stage 18, tests); without an argument restores the stub. */
export const setCertificateLookup = (next: CertificateLookup = noCertificates): void => {
  lookup = next
}
