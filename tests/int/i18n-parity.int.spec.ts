import { describe, expect, it } from 'vitest'
import { crmLabel, crmLabels, crmTranslations, supportedLocales } from '@/i18n'

type Tree = { [key: string]: Tree | string }

const flatten = (obj: Tree, prefix = ''): [string, string][] =>
  Object.entries(obj).flatMap(([key, value]) =>
    typeof value === 'string'
      ? [[`${prefix}${key}`, value] as [string, string]]
      : flatten(value, `${prefix}${key}.`),
  )

describe('i18n parity', () => {
  const entries = Object.fromEntries(
    supportedLocales.map((l) => [l, flatten(crmTranslations[l].crm as Tree)]),
  ) as Record<(typeof supportedLocales)[number], [string, string][]>
  const keys = (l: keyof typeof entries) => entries[l].map(([k]) => k).sort()

  it.each(['ro', 'en'] as const)('%s has the same keys as ru', (locale) => {
    expect(keys(locale)).toEqual(keys('ru'))
  })

  it.each(supportedLocales)('%s has no empty values', (locale) => {
    for (const [key, value] of entries[locale]) {
      expect(value.trim(), `${locale}:${key}`).not.toBe('')
    }
  })
})

describe('typed keys', () => {
  it('rejects unknown keys at compile time (checked by tsc)', () => {
    crmLabel('groups.content')
    // @ts-expect-error unknown key must be a type error
    crmLabel('groups.doesNotExist')
    expect(crmLabels('groups.content')).toEqual({ ru: 'Контент', ro: 'Conținut', en: 'Content' })
  })
})
