/**
 * Aggregation of the client report (spec §8 «Клієнти», A37): one MongoDB pipeline over `appointments`
 * grouped by client, joined with `clients`, searched, sorted and paged in the database.
 * Raw aggregation bypasses Payload access control: the caller passes the allowed locations explicitly.
 */
import type { PayloadRequest } from 'payload'

import { mongo, sessionOf } from './appointments'
import {
  CLIENT_REPORT_CSV_LIMIT,
  emptyStats,
  searchPatterns,
  toReportRow,
  toStats,
  VISIT_STATUSES,
  type ClientReportRow,
  type ClientReportSort,
  type ClientStats,
  type RawReportRow,
} from './client-report'

export type ClientReportFilter = {
  /** Half-open range of `startAt` (local days converted by the caller). */
  from?: Date | null
  to?: Date | null
  /** `null` = every location (admin); otherwise the allowed ids (may be empty → no rows). */
  locations: readonly string[] | null
  barber?: string | null
  client?: string | null
  q?: string | null
}

export type ClientReportPage = {
  sort: ClientReportSort
  order: 'asc' | 'desc'
  /** 1-based; ignored (all rows, capped) when `all`. */
  page: number
  limit: number
  all?: boolean
}

type Doc = Record<string, unknown>

/** Builds ObjectIds with the mongoose instance of the Payload adapter (it is not a direct dependency). */
type ToId = (id: string) => unknown
const idFactory = (req: PayloadRequest): ToId => {
  const { Types } = mongo(req).collections['appointments'].base
  return (id) => new Types.ObjectId(id)
}

const countIf = (statuses: readonly string[]): Doc => ({
  $sum: { $cond: [{ $in: ['$status', statuses] }, 1, 0] },
})

const visit: Doc = { $in: ['$status', [...VISIT_STATUSES]] }

const matchStage = (filter: ClientReportFilter, oid: ToId): Doc => {
  const match: Doc = { kind: { $ne: 'block' }, client: { $ne: null } }
  if (filter.client) match.client = oid(filter.client)
  if (filter.from || filter.to)
    match.startAt = {
      ...(filter.from ? { $gte: filter.from } : {}),
      ...(filter.to ? { $lt: filter.to } : {}),
    }
  if (filter.locations) match.location = { $in: filter.locations.map(oid) }
  if (filter.barber) match.barber = oid(filter.barber)
  return match
}

const SORT_FIELD: Record<ClientReportSort, string> = {
  name: 'nameKey',
  visits: 'visits',
  lastVisit: 'lastVisit',
  avgCheck: 'avgCheck',
  cancelledByClient: 'cancelledByClient',
  cancelledBySalon: 'cancelledBySalon',
  noShows: 'noShows',
}

/** Group by client: the counters of §8 over the matched appointments. */
const groupStage = (): Doc => ({
  $group: {
    _id: '$client',
    visits: { $sum: { $cond: [visit, 1, 0] } },
    lastVisit: { $max: { $cond: [visit, '$startAt', null] } },
    paidVisits: { $sum: { $cond: [{ $eq: ['$status', 'paid'] }, 1, 0] } },
    paidTotal: { $sum: { $cond: [{ $eq: ['$status', 'paid'] }, { $ifNull: ['$total', 0] }, 0] } },
    cancelledByClient: countIf(['cancelled_by_client']),
    cancelledBySalon: countIf(['cancelled_by_salon']),
    noShows: countIf(['no_show']),
  },
})

const avgStage = (): Doc => ({
  $addFields: {
    avgCheck: {
      $cond: [
        { $gt: ['$paidVisits', 0] },
        // Rounded half up in `toStats` (Mongo's `$round` rounds half to even).
        { $divide: ['$paidTotal', '$paidVisits'] },
        null,
      ],
    },
  },
})

export const buildClientReportPipeline = (
  oid: ToId,
  filter: ClientReportFilter,
  paging: ClientReportPage,
  clientsCollection: string,
): Doc[] => {
  const pipeline: Doc[] = [
    { $match: matchStage(filter, oid) },
    groupStage(),
    avgStage(),
    { $lookup: { from: clientsCollection, localField: '_id', foreignField: '_id', as: 'client' } },
    { $unwind: '$client' },
    {
      $addFields: {
        firstName: '$client.firstName',
        lastName: '$client.lastName',
        phone: '$client.phone',
        blocked: '$client.blocked',
        nameKey: {
          $toLower: {
            $trim: {
              input: {
                $concat: [
                  { $ifNull: ['$client.firstName', ''] },
                  ' ',
                  { $ifNull: ['$client.lastName', ''] },
                ],
              },
            },
          },
        },
      },
    },
  ]
  const search = filter.q ? searchPatterns(filter.q) : null
  if (search)
    pipeline.push({
      $match: {
        $or: [
          { nameKey: { $regex: search.name, $options: 'i' } },
          ...(search.phone ? [{ phone: { $regex: search.phone } }] : []),
        ],
      },
    })
  const direction = paging.order === 'asc' ? 1 : -1
  // Ties by name then id; when sorting by name the key must not be repeated (it would override the direction).
  pipeline.push({
    $sort: {
      [SORT_FIELD[paging.sort]]: direction,
      ...(paging.sort === 'name' ? {} : { nameKey: 1 }),
      _id: 1,
    },
  })
  const rows: Doc[] = paging.all
    ? [{ $limit: CLIENT_REPORT_CSV_LIMIT }]
    : [{ $skip: (paging.page - 1) * paging.limit }, { $limit: paging.limit }]
  pipeline.push({
    $facet: { rows, total: [{ $count: 'count' }] },
  })
  return pipeline
}

/** Rows of the page and the total number of matching clients. */
export const runClientReport = async (
  req: PayloadRequest,
  filter: ClientReportFilter,
  paging: ClientReportPage,
): Promise<{ rows: ClientReportRow[]; total: number }> => {
  if (filter.locations && filter.locations.length === 0) return { rows: [], total: 0 }
  const db = mongo(req).collections
  const [result] = (await db['appointments']
    .aggregate(
      buildClientReportPipeline(
        idFactory(req),
        filter,
        paging,
        db['clients'].collection.name,
      ) as never[],
    )
    .session((await sessionOf(req)) ?? null)) as {
    rows: RawReportRow[]
    total: { count: number }[]
  }[]
  return { rows: (result?.rows ?? []).map(toReportRow), total: result?.total[0]?.count ?? 0 }
}

/** Statistics of one client over the allowed locations (zeros when nothing matches). */
export const clientStats = async (
  req: PayloadRequest,
  clientId: string,
  locations: readonly string[] | null,
): Promise<ClientStats> => {
  if (locations && locations.length === 0) return emptyStats()
  const db = mongo(req).collections
  const [raw] = (await db['appointments']
    .aggregate([
      { $match: matchStage({ client: clientId, locations }, idFactory(req)) },
      groupStage(),
      avgStage(),
    ] as never[])
    .session((await sessionOf(req)) ?? null)) as RawReportRow[]
  return raw ? toStats(raw) : emptyStats()
}
