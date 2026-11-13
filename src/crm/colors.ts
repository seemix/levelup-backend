/** Calendar colors of barbers (spec §4.4 `color`, A1). */

export const BARBER_COLORS = [
  '#3B82F6',
  '#10B981',
  '#F59E0B',
  '#EF4444',
  '#8B5CF6',
  '#EC4899',
  '#14B8A6',
  '#F97316',
  '#6366F1',
  '#84CC16',
] as const

export const isHexColor = (value: unknown): value is string =>
  typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)

/** First palette color not in `used` (case-insensitive); cycles when all are taken. */
export const nextBarberColor = (used: readonly (string | null | undefined)[]): string => {
  const taken = new Set(used.filter(Boolean).map((color) => color!.toUpperCase()))
  return BARBER_COLORS.find((color) => !taken.has(color)) ?? barberColorAt(taken.size)
}

/** Palette color for the n-th barber (cycles). */
export const barberColorAt = (index: number): string =>
  BARBER_COLORS[((index % BARBER_COLORS.length) + BARBER_COLORS.length) % BARBER_COLORS.length]
