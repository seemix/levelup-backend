import type { LabelFunction } from 'payload'

import { en } from './en'
import { ro } from './ro'
import { ru } from './ru'
import type { CrmKey, CrmTranslations } from './types'

export const supportedLocales = ['ru', 'ro', 'en'] as const
export type AdminLocale = (typeof supportedLocales)[number]

type Tree = { [key: string]: Tree | string }

/**
 * Payload's `t` splits keys only by `:` (namespace) and does not walk nested objects,
 * so `crm:users.plural` is looked up as `crm['users.plural']`. Sources stay nested for
 * readability; the config receives them flattened to dotted keys.
 */
const flatten = (tree: Tree, prefix = ''): Record<string, string> =>
  Object.entries(tree).reduce<Record<string, string>>((acc, [key, value]) => {
    const path = `${prefix}${key}`
    return typeof value === 'string'
      ? { ...acc, [path]: value }
      : { ...acc, ...flatten(value, `${path}.`) }
  }, {})

/** Passed to `i18n.translations` in the Payload config: `{ ru: { crm: { 'users.plural': '…' } } }`. */
export const crmTranslations: Record<AdminLocale, { crm: Record<CrmKey, string> }> = {
  ru: { crm: flatten(ru) as Record<CrmKey, string> },
  ro: { crm: flatten(ro) as Record<CrmKey, string> },
  en: { crm: flatten(en) as Record<CrmKey, string> },
}

export type { CrmKey, CrmTranslations }

/** Typed `t` for the `crm` namespace: `t('crm:groups.content')`. */
type CrmT = (key: `crm:${CrmKey}`, options?: Record<string, unknown>) => string

/** Label/description function: `label: crmLabel('fields.orderDescription')`. Unknown key = TS error. */
export const crmLabel =
  (key: CrmKey): LabelFunction =>
  ({ t }) =>
    (t as unknown as CrmT)(`crm:${key}`)

/** Translate a `crm` key with a request `t` (e.g. in `validate`): `crmT(req.t, 'errors.phoneInvalid')`. */
export const crmT = (t: unknown, key: CrmKey, options?: Record<string, unknown>): string =>
  (t as CrmT)(`crm:${key}`, options)

/** Static per-language record for options that do not accept functions (e.g. `admin.group`). */
export const crmLabels = (key: CrmKey): Record<AdminLocale, string> => {
  const read = (tr: CrmTranslations) =>
    key
      .split('.')
      .reduce<unknown>((acc, part) => (acc as Record<string, unknown>)[part], tr) as string
  return { ru: read(ru), ro: read(ro), en: read(en) }
}
