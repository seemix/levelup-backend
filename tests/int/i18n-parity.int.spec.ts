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

describe('payload t() resolves crm keys', () => {
  it.each(supportedLocales)('%s: every key is translated, not echoed back', async (language) => {
    const { initI18n } = await import('@payloadcms/translations')
    const languages = {
      ru: (await import('@payloadcms/translations/languages/ru')).ru,
      ro: (await import('@payloadcms/translations/languages/ro')).ro,
      en: (await import('@payloadcms/translations/languages/en')).en,
    }
    const i18n = await initI18n({
      config: {
        fallbackLanguage: 'ru',
        supportedLanguages: languages,
        translations: crmTranslations,
      },
      context: 'client',
      language,
    })
    const t = i18n.t as (key: string) => string
    for (const key of Object.keys(crmTranslations[language].crm)) {
      expect(t(`crm:${key}`), key).toBe(
        (crmTranslations[language].crm as Record<string, string>)[key],
      )
    }
    expect(t('crm:users.plural')).not.toBe('crm:users.plural')
  })
})
