/**
 * Money helpers. Amounts are integers in bani (1 MDL = 100 bani).
 * No float arithmetic on money outside this module.
 */

export const CURRENCY = 'MDL'
export const BANI_PER_LEU = 100

export const isBani = (value: unknown): value is number => Number.isSafeInteger(value)

export const assertBani = (value: number, name = 'amount'): number => {
  if (!isBani(value))
    throw new RangeError(`${name} must be an integer number of bani, got ${value}`)
  return value
}

/** Lei amount (e.g. 12.5 or "12,50") -> bani. Rounds half-up to the nearest ban (by magnitude). */
export const leiToBani = (lei: number | string): number => {
  const text =
    typeof lei === 'number' ? String(lei) : lei.trim().replace(/\s/g, '').replace(',', '.')
  if (!/^-?\d+(\.\d+)?$/.test(text)) throw new RangeError(`Invalid amount: ${lei}`)
  const negative = text.startsWith('-')
  const [intPart, frac = ''] = text.replace('-', '').split('.')
  const padded = (frac + '00').slice(0, 2)
  let bani = Number(intPart) * BANI_PER_LEU + Number(padded)
  if (frac.length > 2 && Number(frac[2]) >= 5) bani += 1
  return negative ? -bani : bani
}

/** Bani -> lei as a number (for display/inputs only, never for further calculations). */
export const baniToLei = (bani: number): number => assertBani(bani) / BANI_PER_LEU

/** Integer division rounded half-up (towards +infinity on ties). */
const divRoundHalfUp = (numerator: number, denominator: number): number =>
  Math.floor((2 * numerator + denominator) / (2 * denominator))

/**
 * `percent`% of `bani`, rounded half-up to a whole ban. `percent` may be fractional
 * (e.g. 12.5): it is converted to hundredths of a percent and computed with integer math.
 */
export const percentOf = (bani: number, percent: number): number => {
  assertBani(bani, 'bani')
  const basisPoints = Math.round(percent * 100)
  return divRoundHalfUp(bani * basisPoints, 10_000)
}

export const sumBani = (values: readonly number[]): number =>
  values.reduce((sum, value) => sum + assertBani(value), 0)

/** Formats bani as currency in the given locale. */
export const formatMoney = (bani: number, locale: string = 'ru'): string =>
  new Intl.NumberFormat(locale, { style: 'currency', currency: CURRENCY }).format(baniToLei(bani))

/** Bani -> plain decimal string for inputs ("1250" -> "12.50"), integer math only. */
export const baniToLeiText = (bani: number): string => {
  assertBani(bani)
  const abs = Math.abs(bani)
  const text = `${Math.floor(abs / BANI_PER_LEU)}.${String(abs % BANI_PER_LEU).padStart(2, '0')}`
  return bani < 0 ? `-${text}` : text
}

/**
 * Strict parse of user input in lei ("12", "12.5", "12,50") -> bani.
 * Returns `null` for anything else (more than two decimals, letters, empty).
 */
export const parseLeiInput = (text: string): number | null => {
  const normalized = text.trim().replace(/\s/g, '').replace(',', '.')
  return /^\d+(\.\d{1,2})?$/.test(normalized) ? leiToBani(normalized) : null
}

/** `parseLeiInput` that also accepts a leading minus ("-12.50"), for signed ledger amounts. */
export const parseSignedLeiInput = (text: string): number | null => {
  const normalized = text.trim().replace(/^[−–]/, '-')
  if (!normalized.startsWith('-')) return parseLeiInput(normalized)
  const bani = parseLeiInput(normalized.slice(1))
  return bani === null ? null : -bani
}
