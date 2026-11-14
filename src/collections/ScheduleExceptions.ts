import type {
  CollectionBeforeChangeHook,
  CollectionBeforeValidateHook,
  CollectionConfig,
  RelationshipFieldSingleValidation,
} from 'payload'
import { fieldAccessFor, scopedAccessFor } from '@/access/policy'
import { scheduledAppointmentIds } from '@/crm/appointments'
import { SCHEDULE_EDIT_CONTEXT } from '@/crm/schedule-edit'
import { EXCEPTION_KINDS, relationId, validateDateRange, type RelationValue } from '@/crm/schedule'
import { breaksField, dateField, scheduleErrorKey, timeField } from '@/fields/schedule'
import { outsideTransaction } from '@/crm/read-req'
import { crmLabel, crmLabels, crmT } from '@/i18n'

type ExceptionData = {
  barber?: RelationValue
  kind?: string
  dateFrom?: string
  dateTo?: string
  location?: RelationValue
  start?: string | null
  end?: string | null
  breaks?: unknown[] | null
}

const isCustomHours = (data: unknown): boolean =>
  (data as ExceptionData | undefined)?.kind === 'custom_hours'

const barberLocationIds = async (
  req: Parameters<CollectionBeforeValidateHook>[0]['req'],
  barber: RelationValue,
): Promise<string[]> => {
  const id = relationId(barber)
  if (!id) return []
  const doc = await req.payload
    .findByID({ collection: 'barbers', id, depth: 0, select: { locations: true }, req })
    .catch(() => null)
  return (doc?.locations ?? [])
    .map((loc) => relationId(loc as RelationValue))
    .filter(Boolean) as string[]
}

/** `custom_hours` without a location gets the barber's only location (spec §5.2 p.3). */
const defaultLocation: CollectionBeforeValidateHook = async ({ data, originalDoc, req }) => {
  if (!data) return data
  const merged = { ...originalDoc, ...data } as ExceptionData
  if (isCustomHours(merged) && !relationId(merged.location)) {
    const locations = await barberLocationIds(req, merged.barber)
    if (locations.length === 1) data.location = locations[0]
  }
  return data
}

/** Hours, breaks and location only make sense for `custom_hours`. */
const clearUnusedFields: CollectionBeforeChangeHook = ({ data }) => {
  if (!isCustomHours(data)) {
    data.location = null
    data.start = null
    data.end = null
    data.breaks = []
  }
  return data
}

export const ScheduleExceptions: CollectionConfig = {
  slug: 'schedule-exceptions',
  labels: {
    singular: crmLabel('scheduleExceptions.singular'),
    plural: crmLabel('scheduleExceptions.plural'),
  },
  access: {
    read: scopedAccessFor('read', 'schedule-exceptions'),
    create: scopedAccessFor('create', 'schedule-exceptions'),
    update: scopedAccessFor('update', 'schedule-exceptions'),
    delete: scopedAccessFor('delete', 'schedule-exceptions'),
  },
  admin: {
    group: crmLabels('groups.barbers'),
    defaultColumns: ['barber', 'kind', 'dateFrom', 'dateTo', 'comment'],
  },
  defaultSort: '-dateFrom',
  indexes: [{ fields: ['barber', 'dateFrom'] }],
  hooks: {
    beforeValidate: [defaultLocation],
    beforeChange: [clearUnusedFields],
  },
  fields: [
    {
      name: 'barber',
      type: 'relationship',
      relationTo: 'barbers',
      required: true,
      index: true,
      label: crmLabel('scheduleExceptions.barber'),
    },
    {
      name: 'kind',
      type: 'select',
      required: true,
      defaultValue: 'day_off',
      label: crmLabel('scheduleExceptions.kind'),
      options: EXCEPTION_KINDS.map((kind) => ({
        value: kind,
        label: crmLabel(`scheduleExceptions.kinds.${kind}`),
      })),
    },
    {
      type: 'row',
      fields: [
        // Exceptions of one barber must not overlap (spec §4.5).
        dateField(
          'dateFrom',
          'scheduleExceptions.dateFrom',
          async (dateFrom, { data, id, req }) => {
            const { dateTo, barber } = data as ExceptionData
            const barberId = relationId(barber)
            // An invalid range is reported on `dateTo`.
            if (!barberId || validateDateRange(dateFrom, dateTo)) return true
            // Roster edits keep exceptions disjoint themselves (A44, `src/crm/schedule-edit.ts`).
            if (req.context?.[SCHEDULE_EDIT_CONTEXT]) return true
            const { docs } = await req.payload.find({
              collection: 'schedule-exceptions',
              where: {
                and: [
                  { barber: { equals: barberId } },
                  { dateFrom: { less_than_equal: dateTo } },
                  { dateTo: { greater_than_equal: dateFrom } },
                  ...(id === undefined ? [] : [{ id: { not_equals: id } }]),
                ],
              },
              depth: 0,
              limit: 1,
              pagination: false,
              select: {},
              req: outsideTransaction(req),
            })
            return docs.length > 0 ? crmT(req.t, 'errors.exceptionOverlap') : true
          },
        ),
        dateField('dateTo', 'scheduleExceptions.dateTo', (dateTo, { data, req }) => {
          const error = validateDateRange((data as ExceptionData).dateFrom, dateTo)
          // An invalid `dateFrom` is reported on its own field.
          return error === 'DATE_RANGE_INVALID' ? crmT(req.t, scheduleErrorKey[error]) : true
        }),
      ],
    },
    {
      name: 'location',
      type: 'relationship',
      relationTo: 'locations',
      label: crmLabel('scheduleExceptions.location'),
      admin: {
        description: crmLabel('scheduleExceptions.locationDescription'),
        condition: (_, siblingData) => isCustomHours(siblingData),
      },
      validate: (async (value, { data, req }) => {
        if (!isCustomHours(data)) return true
        const locationId = relationId(value as RelationValue)
        if (!locationId) return crmT(req.t, 'errors.required')
        const allowed = await barberLocationIds(
          outsideTransaction(req),
          (data as ExceptionData).barber,
        )
        return allowed.includes(locationId) ? true : crmT(req.t, 'errors.locationNotAllowed')
      }) satisfies RelationshipFieldSingleValidation,
    },
    {
      type: 'row',
      admin: { condition: (_, siblingData) => isCustomHours(siblingData) },
      fields: [timeField('start', isCustomHours), timeField('end', isCustomHours)],
    },
    {
      ...breaksField(),
      admin: {
        ...breaksField().admin,
        condition: (_, siblingData) => isCustomHours(siblingData),
      },
    },
    {
      name: 'comment',
      type: 'textarea',
      label: crmLabel('scheduleExceptions.comment'),
    },
    {
      // Warning for admin/manager (spec §4.5): scheduled appointments of the barber on these dates.
      // Computed on read of a single document; nothing is cancelled automatically.
      name: 'appointmentsInRange',
      type: 'relationship',
      relationTo: 'appointments',
      hasMany: true,
      virtual: true,
      label: crmLabel('scheduleExceptions.appointmentsInRange'),
      access: { read: fieldAccessFor('read', 'schedule-exceptions.appointments') },
      admin: {
        readOnly: true,
        description: crmLabel('scheduleExceptions.appointmentsInRangeDescription'),
        condition: (data) =>
          ((data as { appointmentsInRange?: unknown[] }).appointmentsInRange ?? []).length > 0,
      },
      hooks: {
        afterRead: [
          async ({ siblingData, findMany, req }) => {
            if (findMany || req.context?.[SCHEDULE_EDIT_CONTEXT]) return undefined
            const { barber, dateFrom, dateTo } = siblingData as ExceptionData
            const barberId = relationId(barber)
            if (!barberId || validateDateRange(dateFrom, dateTo)) return []
            return scheduledAppointmentIds(req, barberId, dateFrom!, dateTo!)
          },
        ],
      },
    },
  ],
}
