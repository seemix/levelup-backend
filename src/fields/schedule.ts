import type { ArrayField, TextField } from 'payload'
import { isLocalDate, isLocalTime, timeToMinutes } from '@/crm/time'
import { validateBreaks, type ScheduleError, type TimeRange } from '@/crm/schedule'
import { crmLabel, crmT, type CrmKey } from '@/i18n'

/** Machine codes of `src/crm/schedule.ts` → admin messages. */
export const scheduleErrorKey: Record<ScheduleError, CrmKey> = {
  TIME_INVALID: 'errors.timeInvalid',
  END_BEFORE_START: 'errors.endBeforeStart',
  BREAK_INVALID: 'errors.breakInvalid',
  BREAK_OUTSIDE: 'errors.breakOutside',
  BREAKS_OVERLAP: 'errors.breaksOverlap',
  WEEKDAY_INVALID: 'errors.weekdayInvalid',
  WEEKDAY_DUPLICATE: 'errors.weekdayDuplicate',
  LOCATION_NOT_ALLOWED: 'errors.locationNotAllowed',
  DATE_INVALID: 'errors.dateInvalid',
  DATE_RANGE_INVALID: 'errors.dateRangeInvalid',
}

type Sibling = Record<string, unknown>

/**
 * Local time `HH:mm` (spec §2.2). `isRequired` decides per row (e.g. only for `custom_hours`);
 * `end` also checks that it is later than the sibling `start`.
 */
export const timeField = (
  name: 'start' | 'end',
  isRequired: (siblingData: Sibling) => boolean = () => true,
): TextField => ({
  name,
  type: 'text',
  label: crmLabel(`schedule.${name}`),
  admin: {
    placeholder: name === 'start' ? '09:00' : '18:00',
    description: crmLabel('schedule.timeDescription'),
    width: '50%',
  },
  validate: (value: string | null | undefined, { siblingData, req: { t } }) => {
    const sibling = (siblingData ?? {}) as Sibling
    if (!value) return isRequired(sibling) ? crmT(t, 'errors.required') : true
    if (!isLocalTime(value)) return crmT(t, 'errors.timeInvalid')
    const start = sibling.start
    if (name === 'end' && typeof start === 'string' && isLocalTime(start)) {
      if (timeToMinutes(value) <= timeToMinutes(start)) return crmT(t, 'errors.endBeforeStart')
    }
    return true
  },
})

/** Breaks inside a working interval (the sibling `start`/`end`), without overlaps. */
export const breaksField = (): ArrayField => ({
  name: 'breaks',
  type: 'array',
  label: crmLabel('schedule.breaks'),
  admin: { description: crmLabel('schedule.breaksDescription'), initCollapsed: false },
  fields: [{ type: 'row', fields: [timeField('start'), timeField('end')] }],
  validate: (value: unknown, { siblingData, req: { t } }) => {
    const day = (siblingData ?? {}) as TimeRange
    const error = validateBreaks(day, Array.isArray(value) ? (value as TimeRange[]) : [])
    return error ? crmT(t, scheduleErrorKey[error]) : true
  },
})

type TextValidateOptions = Parameters<Extract<TextField['validate'], (...args: never[]) => unknown>>[1]

/**
 * Local date `YYYY-MM-DD` (spec §2.2). `check` runs after the format check
 * (e.g. range or overlap rules) and returns an error message or `true`.
 */
export const dateField = (
  name: string,
  label: CrmKey,
  check?: (value: string, options: TextValidateOptions) => Promise<string | true> | string | true,
): TextField => ({
  name,
  type: 'text',
  required: true,
  index: true,
  label: crmLabel(label),
  admin: {
    placeholder: '2026-12-31',
    description: crmLabel('scheduleExceptions.dateDescription'),
    width: '50%',
  },
  validate: async (value: string | null | undefined, options) => {
    const { t } = options.req
    if (!value) return crmT(t, 'errors.required')
    if (!isLocalDate(value)) return crmT(t, 'errors.dateInvalid')
    return check ? check(value, options) : true
  },
})
