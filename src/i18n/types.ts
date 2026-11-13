import type { en } from './en'

type Widen<T> = { [K in keyof T]: T[K] extends string ? string : Widen<T[K]> }

/** Shape of the `crm` namespace. `en.ts` is the source of truth; ru/ro must match it exactly. */
export type CrmTranslations = Widen<typeof en>

type Join<P extends string, K extends string> = `${P}${P extends '' ? '' : '.'}${K}`

type Paths<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? Join<P, K> : Paths<T[K], Join<P, K>>
}[keyof T & string]

/** Dotted key inside the `crm` namespace, e.g. `groups.content`. A non-existent key is a TS error. */
export type CrmKey = Paths<CrmTranslations>
