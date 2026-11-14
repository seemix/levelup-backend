/**
 * Certificate code format (A6, A34): client-safe (no Node imports), shared by the generator in
 * `./certificates` and the admin UI.
 */

/** Alphabet without look-alike characters (no 0/O, 1/I): 32 symbols, so `byte & 31` is unbiased. */
export const CERTIFICATE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export const CERTIFICATE_CODE_RE = new RegExp(
  `^LU-[${CERTIFICATE_ALPHABET}]{4}-[${CERTIFICATE_ALPHABET}]{4}$`,
)

/** `lu-abcd efgh` in any case and spacing → `LU-ABCD-EFGH` (dashes are restored when missing). */
export const normalizeCertificateCode = (raw: string): string => {
  const compact = raw.replace(/[\s-]+/g, '').toUpperCase()
  return /^LU[A-Z0-9]{8}$/.test(compact)
    ? `LU-${compact.slice(2, 6)}-${compact.slice(6)}`
    : raw.replace(/\s+/g, '').toUpperCase()
}

export const isCertificateCode = (value: string): boolean => CERTIFICATE_CODE_RE.test(value)
