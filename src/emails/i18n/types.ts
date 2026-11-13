import type { en } from './en'

type Widen<T> = { [K in keyof T]: T[K] extends string ? string : Widen<T[K]> }

/** Shape of an email dictionary; `en.ts` is the source of truth. */
export type EmailTranslations = Widen<typeof en>
