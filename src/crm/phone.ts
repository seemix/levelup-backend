import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js'

export const DEFAULT_REGION: CountryCode = 'MD'

export class PhoneError extends Error {
  readonly code = 'PHONE_INVALID'
  constructor(input: string) {
    super(`PHONE_INVALID: ${input}`)
    this.name = 'PhoneError'
  }
}

/** Returns the E.164 form (`+37369123456`) or `null` if the number is invalid. */
export const tryNormalizePhone = (
  input: string,
  region: CountryCode = DEFAULT_REGION,
): string | null => {
  const raw = input.trim()
  if (!raw) return null
  // "00373..." is the international prefix used in Moldova; libphonenumber expects "+".
  const text = raw.startsWith('00') ? `+${raw.slice(2)}` : raw
  const parsed = parsePhoneNumberFromString(text, region)
  return parsed?.isValid() ? parsed.number : null
}

/** E.164 or throws `PhoneError` (code `PHONE_INVALID`). */
export const normalizePhone = (input: string, region: CountryCode = DEFAULT_REGION): string => {
  const normalized = tryNormalizePhone(input, region)
  if (!normalized) throw new PhoneError(input)
  return normalized
}

/** Human-readable international format, e.g. `+373 69 123 456`. */
export const formatPhone = (e164: string): string =>
  parsePhoneNumberFromString(e164)?.formatInternational() ?? e164
