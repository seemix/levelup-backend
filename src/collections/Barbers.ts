import {
  ValidationError,
  type CollectionBeforeChangeHook,
  type CollectionConfig,
  type FieldAccess,
  type NumberField,
  type RelationshipFieldSingleValidation,
  type TextFieldSingleValidation,
} from 'payload'
import { accessFor, fieldAccessFor, type Resource } from '@/access/policy'
import { outsideTransaction } from '@/crm/read-req'
import { isHexColor, nextBarberColor } from '@/crm/colors'
import { relationId, validateWeeklySchedule, WEEKDAYS, type RelationValue } from '@/crm/schedule'
import { orderDescription } from '@/fields'
import { moneyField } from '@/fields/money'
import { breaksField, scheduleErrorKey, timeField } from '@/fields/schedule'
import { crmLabel, crmLabels, crmT, type CrmKey } from '@/i18n'

const fieldAccess = (
  resource: Resource,
  actions: readonly ('read' | 'create' | 'update')[] = ['read', 'create', 'update'],
) =>
  Object.fromEntries(actions.map((action) => [action, fieldAccessFor(action, resource)])) as {
    read?: FieldAccess
    create?: FieldAccess
    update?: FieldAccess
  }

/** Public profile (landing): everyone reads, admin/editor write. */
const contentAccess = fieldAccess('content', ['create', 'update'])
/** CRM fields: staff read, admin writes. */
const crmAccess = fieldAccess('barbers.crm')

const WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const

const percentField = (name: string, label: CrmKey): NumberField => ({
  name,
  type: 'number',
  min: 0,
  max: 100,
  label: crmLabel(label),
  access: fieldAccess('barbers.commission'),
  admin: { width: '50%' },
  validate: (value: number | null | undefined, { req: { t } }) =>
    value === null || value === undefined || (Number.isFinite(value) && value >= 0 && value <= 100)
      ? true
      : crmT(t, 'errors.percentInvalid'),
})

/** Lexical state without any text or non-text node (e.g. an empty paragraph). */
const isRichTextEmpty = (value: unknown): boolean => {
  const hasContent = (node: unknown): boolean => {
    if (!node || typeof node !== 'object') return false
    const { type, text, children } = node as { type?: string; text?: string; children?: unknown[] }
    if (typeof text === 'string' && text.trim() !== '') return true
    if (type && !['root', 'paragraph', 'text', 'linebreak'].includes(type)) return true
    return Array.isArray(children) && children.some(hasContent)
  }
  return !hasContent((value as { root?: unknown } | null | undefined)?.root)
}

/** A12: `description`/`about` are required only for barbers shown on the site. */
const requirePublicProfile: CollectionBeforeChangeHook = ({ data, originalDoc, req }) => {
  const merged = { ...originalDoc, ...data }
  if (merged.showOnSite === false) return data
  const errors: { path: string; message: string }[] = []
  const message = crmT(req.t, 'barbers.publicRequired')
  if (typeof merged.description !== 'string' || merged.description.trim() === '') {
    errors.push({ path: 'description', message })
  }
  if (isRichTextEmpty(merged.about)) errors.push({ path: 'about', message })
  if (errors.length > 0) throw new ValidationError({ collection: 'barbers', errors }, req.t)
  return data
}

export const Barbers: CollectionConfig = {
  slug: 'barbers',
  labels: {
    singular: crmLabel('barbers.singular'),
    plural: crmLabel('barbers.plural'),
  },
  access: {
    read: accessFor('read', 'barbers'),
    create: accessFor('create', 'barbers'),
    update: accessFor('update', 'barbers'),
    delete: accessFor('delete', 'barbers'),
    readVersions: accessFor('create', 'barbers'),
  },
  admin: {
    useAsTitle: 'name',
    group: crmLabels('groups.barbers'),
    defaultColumns: ['name', 'position', 'active', 'showOnSite', 'onlineBooking', 'order'],
  },
  defaultSort: 'order',
  versions: { maxPerDoc: 20 },
  hooks: {
    beforeChange: [requirePublicProfile],
  },
  fields: [
    {
      name: 'order',
      type: 'number',
      defaultValue: 0,
      index: true,
      label: crmLabel('fields.order'),
      access: contentAccess,
      admin: { position: 'sidebar', description: orderDescription },
    },
    {
      name: 'active',
      type: 'checkbox',
      required: true,
      defaultValue: true,
      index: true,
      label: crmLabel('barbers.active'),
      access: crmAccess,
      admin: { position: 'sidebar' },
    },
    {
      name: 'showOnSite',
      type: 'checkbox',
      required: true,
      defaultValue: true,
      index: true,
      label: crmLabel('barbers.showOnSite'),
      access: contentAccess,
      admin: { position: 'sidebar' },
    },
    {
      name: 'onlineBooking',
      type: 'checkbox',
      required: true,
      defaultValue: true,
      label: crmLabel('barbers.onlineBooking'),
      access: crmAccess,
      admin: { position: 'sidebar' },
    },
    {
      type: 'tabs',
      tabs: [
        {
          label: crmLabel('barbers.tabProfile'),
          fields: [
            {
              name: 'name',
              type: 'text',
              required: true,
              index: true,
              label: crmLabel('barbers.name'),
              access: contentAccess,
            },
            {
              name: 'position',
              type: 'text',
              localized: true,
              label: crmLabel('barbers.position'),
              access: contentAccess,
            },
            {
              name: 'description',
              type: 'text',
              localized: true,
              label: crmLabel('barbers.description'),
              access: contentAccess,
              admin: { description: crmLabel('barbers.publicRequired') },
            },
            {
              name: 'image',
              type: 'upload',
              relationTo: 'media',
              label: crmLabel('barbers.image'),
              access: contentAccess,
            },
            {
              name: 'about',
              type: 'richText',
              localized: true,
              label: crmLabel('barbers.about'),
              access: contentAccess,
              admin: { description: crmLabel('barbers.publicRequired') },
            },
          ],
        },
        {
          label: crmLabel('barbers.tabCrm'),
          fields: [
            {
              name: 'color',
              type: 'text',
              required: true,
              label: crmLabel('barbers.color'),
              access: crmAccess,
              // First palette color not used yet (A1: calendar block color).
              defaultValue: async ({ req }) => {
                const { docs } = await req.payload.find({
                  collection: 'barbers',
                  depth: 0,
                  pagination: false,
                  select: { color: true },
                  req: outsideTransaction(req),
                })
                return nextBarberColor(docs.map((doc) => doc.color))
              },
              admin: { description: crmLabel('barbers.colorDescription'), placeholder: '#3B82F6' },
              validate: ((value, { req: { t } }) =>
                isHexColor(value)
                  ? true
                  : crmT(t, 'errors.colorInvalid')) satisfies TextFieldSingleValidation,
            },
            {
              name: 'user',
              type: 'relationship',
              relationTo: 'users',
              // Indexed by the partial unique index `barbers_user_unique` (migration).
              label: crmLabel('barbers.user'),
              access: fieldAccess('barbers.user'),
              filterOptions: { roles: { in: ['barber'] } },
              admin: { description: crmLabel('barbers.userDescription') },
              // Unique (spec §4.4) and a user with the `barber` role; a partial unique index backs it up.
              validate: (async (value, { id, req }) => {
                const userId = relationId(value as RelationValue)
                if (!userId) return true
                const linked = await req.payload.find({
                  collection: 'barbers',
                  where: {
                    and: [
                      { user: { equals: userId } },
                      ...(id === undefined ? [] : [{ id: { not_equals: id } }]),
                    ],
                  },
                  depth: 0,
                  limit: 1,
                  pagination: false,
                  select: {},
                  req: outsideTransaction(req),
                })
                if (linked.docs.length > 0) return crmT(req.t, 'errors.barberUserTaken')
                const user = await req.payload
                  .findByID({
                    collection: 'users',
                    id: userId,
                    depth: 0,
                    select: { roles: true },
                    req: outsideTransaction(req),
                  })
                  .catch(() => null)
                return user?.roles?.includes('barber') ? true : req.t('validation:invalidSelection')
              }) satisfies RelationshipFieldSingleValidation,
            },
            {
              name: 'locations',
              type: 'relationship',
              relationTo: 'locations',
              hasMany: true,
              required: true,
              index: true,
              label: crmLabel('barbers.locations'),
              access: crmAccess,
              // With a single active location it is chosen automatically (spec §4.2).
              defaultValue: async ({ req }) => {
                const { docs } = await req.payload.find({
                  collection: 'locations',
                  where: { active: { equals: true } },
                  depth: 0,
                  limit: 2,
                  pagination: false,
                  select: {},
                  req: outsideTransaction(req),
                })
                return docs.length === 1 ? [docs[0].id] : undefined
              },
            },
            {
              name: 'services',
              type: 'relationship',
              relationTo: 'services',
              hasMany: true,
              label: crmLabel('barbers.services'),
              access: crmAccess,
              admin: { description: crmLabel('barbers.servicesDescription') },
            },
            {
              name: 'prices',
              type: 'join',
              collection: 'barber-prices',
              on: 'barber',
              label: crmLabel('barbers.prices'),
              access: { read: fieldAccessFor('read', 'barbers.crm') },
              admin: { defaultColumns: ['item', 'price', 'durationMinutes'] },
            },
          ],
        },
        {
          label: crmLabel('barbers.tabSchedule'),
          fields: [
            {
              name: 'weeklySchedule',
              type: 'array',
              maxRows: 7,
              label: crmLabel('barbers.weeklySchedule'),
              access: fieldAccess('barbers.schedule'),
              admin: { description: crmLabel('barbers.weeklyScheduleDescription') },
              validate: (value: unknown, { data, req: { t } }) => {
                const rows = Array.isArray(value) ? value : []
                const locations = (data as { locations?: RelationValue[] }).locations
                const error = validateWeeklySchedule(rows, locations)
                return error ? crmT(t, scheduleErrorKey[error]) : true
              },
              fields: [
                {
                  type: 'row',
                  fields: [
                    {
                      name: 'weekday',
                      type: 'select',
                      required: true,
                      label: crmLabel('barbers.weekday'),
                      options: WEEKDAYS.map((day) => ({
                        value: String(day),
                        label: crmLabel(`weekdays.${WEEKDAY_KEYS[day - 1]}`),
                      })),
                      admin: { width: '50%' },
                    },
                    {
                      name: 'location',
                      type: 'relationship',
                      relationTo: 'locations',
                      required: true,
                      label: crmLabel('schedule.location'),
                      admin: { width: '50%' },
                    },
                  ],
                },
                { type: 'row', fields: [timeField('start'), timeField('end')] },
                breaksField(),
              ],
            },
            {
              name: 'exceptions',
              type: 'join',
              collection: 'schedule-exceptions',
              on: 'barber',
              label: crmLabel('barbers.exceptions'),
              access: { read: fieldAccessFor('read', 'barbers.schedule') },
              defaultSort: '-dateFrom',
              admin: { defaultColumns: ['kind', 'dateFrom', 'dateTo', 'comment'] },
            },
          ],
        },
        {
          label: crmLabel('barbers.tabSalary'),
          fields: [
            {
              type: 'row',
              fields: [
                percentField('commissionServicesPercent', 'barbers.commissionServicesPercent'),
                percentField('commissionExtrasPercent', 'barbers.commissionExtrasPercent'),
              ],
            },
            {
              // Optional fixed monthly salary (A45): prorated by days in the salary report.
              ...moneyField({
                name: 'fixedSalary',
                label: 'barbers.fixedSalary',
                required: false,
                description: 'barbers.fixedSalaryDescription',
              }),
              access: fieldAccess('barbers.commission'),
            },
          ],
        },
      ],
    },
  ],
}
