import type { Access, FieldAccess, PayloadRequest, Where } from 'payload'

import { toLocalDate } from '@/crm/time'

/**
 * Single source of access rules (spec §3, matrix §3.1).
 * Collection/field access functions and custom endpoints must ask `can()` instead of checking roles directly.
 */

export const ROLES = ['admin', 'manager', 'barber', 'editor'] as const
export type Role = (typeof ROLES)[number]

export type Action = 'read' | 'create' | 'update' | 'delete'

export type Resource =
  /** Site content: slides, about-us, media, public fields of barbers. */
  | 'content'
  | 'users'
  /** Privileged user fields (`roles`, `locations`): only admin assigns them. */
  | 'users.privileged'
  | 'locations'
  | 'booking-settings'
  /** Non-public booking-settings fields (`senderName`, `replyTo`). */
  | 'booking-settings.private'
  /** Service catalog: service-categories, services, extras (spec §3.1). */
  | 'catalog'
  /** Barbers collection (documents); public profile fields use `content` at field level. */
  | 'barbers'
  /** Barber CRM fields: active, onlineBooking, color, locations, services. */
  | 'barbers.crm'
  /** `barbers.weeklySchedule` (decision 11: admin and the manager of the barber's location edit it). */
  | 'barbers.schedule'
  /** `barbers.commission*`: admin and the barber themselves read, admin writes. */
  | 'barbers.commission'
  /** `barbers.user`: admin only. */
  | 'barbers.user'
  | 'barber-prices'
  /** Clients: admin/manager CRU, admin deletes; barber has no direct access (spec §3.1, decision 36). */
  | 'clients'
  /** `clients.email`: admin and manager read. */
  | 'clients.email'
  /** Needs a `PolicyScope` (barber link / managed barbers). */
  | 'schedule-exceptions'
  /** Promo codes: admin CRUD; manager and barber read; anonymous checks codes only via the booking endpoint. */
  | 'promo-codes'
  /** `promo-codes.usedCount`: staff reads; nobody writes it through the API (the appointments service uses `$inc`). */
  | 'promo-codes.usage'
  /** Needs a `PolicyScope` (barber link): manager — own locations, barber — own appointments. */
  | 'appointments'
  /** Restore cancelled / no-show / completed appointments to `scheduled`. */
  | 'appointments.restore'
  /** Manual discount fields. */
  | 'appointments.discount'
  /** Change composition, prices or discounts of a paid appointment. */
  | 'appointments.paid'
  | 'appointment-logs'
  | 'booking-locks'
  /** Warning list of scheduled appointments on a schedule exception (§4.5): admin and manager. */
  | 'schedule-exceptions.appointments'
  /** CRM calendar (§3.1): admin — all locations, manager — own, barber — own column + busy time of the location. */
  | 'calendar'
  /** Cash registers (§4.13): admin CRUD; manager reads own locations; barber reads all (no balance). */
  | 'cash-registers'
  /** `cash-registers.balance`: admin and manager read; nobody writes it (ledger hook, `$inc`). */
  | 'cash-registers.balance'
  /** Expense categories (§4.14): admin CRUD, manager reads. */
  | 'expense-categories'
  /**
   * Ledger (§4.15, §3.1). Needs a `PolicyScope` (barber link) for reads; `create` with a
   * `TransactionPolicyDoc` checks the type, the location and the day; update — admin (comment and
   * expense category only), delete — nobody.
   */
  | 'transactions'
  /**
   * Gift certificates (§4.17, §3.1): staff reads (a barber checks a code at payment); admin and
   * manager create — only through the sale service (§5.7); admin updates (void, expiry, buyer,
   * comment); nobody deletes (the sale stays in the ledger).
   */
  | 'gift-certificates'
  /** `gift-certificates.buyerName` / `buyerPhone`: admin and manager read. */
  | 'gift-certificates.buyer'

/** `true`/`false` or a row-level `Where` constraint (only for collection-level `read`/`update`/`delete`). */
export type Decision = boolean | Where

type Id = string | number

/** Minimal user shape the policy relies on (what is stored in the JWT). */
export type PolicyUser =
  | {
      id?: Id
      collection?: string
      roles?: readonly (Role | string)[] | null
      locations?: readonly (Id | { id: Id } | null)[] | null
    }
  | null
  | undefined

export const hasRole = (user: PolicyUser, role: Role): boolean =>
  Boolean(user?.roles?.includes(role))

export const isAdmin = (user: PolicyUser): boolean => hasRole(user, 'admin')

/** Staff = CRM personnel (editor is content-only and is not staff). */
export const isStaff = (user: PolicyUser): boolean =>
  hasRole(user, 'admin') || hasRole(user, 'manager') || hasRole(user, 'barber')

/** Location ids of the user (from the JWT ids or a populated relationship). */
export const userLocationIds = (user: PolicyUser): string[] =>
  (user?.locations ?? [])
    .map((loc) => (loc && typeof loc === 'object' ? loc.id : loc))
    .filter((id): id is Id => id !== null && id !== undefined && id !== '')
    .map(String)

const docId = (doc: unknown): string | undefined => {
  const id = (doc as { id?: Id } | null | undefined)?.id
  return id === undefined || id === null ? undefined : String(id)
}

const isSelf = (user: PolicyUser, doc: unknown): boolean =>
  user?.id !== undefined && docId(doc) === String(user.id)

const relId = (value: unknown): string | undefined => {
  const id = value && typeof value === 'object' ? (value as { id?: Id }).id : value
  return id === undefined || id === null || id === '' ? undefined : String(id as Id)
}

/** Is `doc` (a barbers document) linked to `user` through `barbers.user`? */
const ownsBarber = (user: PolicyUser, doc: unknown): boolean =>
  user?.id !== undefined &&
  relId((doc as { user?: unknown } | null | undefined)?.user) === String(user.id)

/** Does a barbers document work in one of the manager's locations? */
const barberInManagerLocations = (user: PolicyUser, doc: unknown): boolean => {
  if (!hasRole(user, 'manager')) return false
  const own = new Set(userLocationIds(user))
  const locations = (doc as { locations?: unknown[] | null } | null | undefined)?.locations ?? []
  return locations.some((loc) => {
    const id = relId(loc)
    return id !== undefined && own.has(id)
  })
}

/**
 * Request-derived facts that rules cannot read from the JWT (resolved by `getStaffContext`).
 * Only needed for resources documented as scoped.
 */
export type PolicyScope = {
  /** `barbers` document of the current barber user. */
  barberId?: string | null
  /** Barbers working in the manager's locations. */
  managedBarberIds?: readonly string[]
}

/** What the `transactions` create rule needs to know about a new operation. */
export type TransactionPolicyDoc = {
  type: string
  location?: unknown
  barber?: unknown
  occurredAt?: Date | string | null
  /** Current time (the manager works within the current local day). */
  now?: Date
  /** `refund` / `reversal`: the operation being undone. */
  target?: { type: string; location?: unknown; occurredAt?: Date | string | null } | null
}

/** Operation types a manager creates (§3.1); payments and certificate sales — through their services. */
const MANAGER_TRANSACTION_TYPES = [
  'expense',
  'transfer',
  'reversal',
  'appointment_payment',
  'certificate_sale',
]
/** Operations a manager may reverse (own locations, the current day). */
const MANAGER_REVERSIBLE_TYPES = ['expense', 'transfer']

const sameLocalDay = (a: Date | string | null | undefined, b: Date | undefined): boolean =>
  Boolean(a && b) && toLocalDate(new Date(a as Date | string)) === toLocalDate(b as Date)

const managerMayCreate = (user: PolicyUser, doc: TransactionPolicyDoc): boolean => {
  if (!hasRole(user, 'manager') || !MANAGER_TRANSACTION_TYPES.includes(doc.type)) return false
  const own = userLocationIds(user)
  const location = relId(doc.location)
  if (location === undefined || !own.includes(location)) return false
  if (doc.type === 'appointment_payment' || doc.type === 'certificate_sale') return true
  // Expenses, transfers and reversals: only on the current local day (no back-dating).
  if (!sameLocalDay(doc.occurredAt, doc.now)) return false
  if (doc.type !== 'reversal') return true
  const target = doc.target
  if (!target || !MANAGER_REVERSIBLE_TYPES.includes(target.type)) return false
  const targetLocation = relId(target.location)
  return (
    targetLocation !== undefined &&
    own.includes(targetLocation) &&
    sameLocalDay(target.occurredAt, doc.now)
  )
}

/** OR-combination: roles add permissions, they never take them away. */
const anyOf = (...decisions: Decision[]): Decision => {
  if (decisions.includes(true)) return true
  const wheres = decisions.filter((d): d is Where => typeof d === 'object')
  if (wheres.length === 0) return false
  return wheres.length === 1 ? wheres[0] : { or: wheres }
}

type Rule = (user: PolicyUser, action: Action, doc?: unknown, scope?: PolicyScope) => Decision

const rules: Record<Resource, Rule> = {
  content: (user, action) =>
    action === 'read' ? true : hasRole(user, 'admin') || hasRole(user, 'editor'),

  users: (user, action, doc) => {
    if (!user) return false
    if (isAdmin(user)) return true
    // Everyone else: read/update only themselves (password, language); privileged fields are guarded separately.
    if (action !== 'read' && action !== 'update') return false
    if (doc !== undefined) return isSelf(user, doc)
    return user.id === undefined ? false : { id: { equals: user.id } }
  },

  'users.privileged': (user, action) => (action === 'read' ? Boolean(user) : isAdmin(user)),

  locations: (user, action) => {
    if (action !== 'read') return isAdmin(user)
    if (!user) return { active: { equals: true } }
    const ids = userLocationIds(user)
    return anyOf(
      hasRole(user, 'admin') || hasRole(user, 'barber') || hasRole(user, 'editor'),
      // A manager sees only their own locations.
      hasRole(user, 'manager') && ids.length > 0 ? { id: { in: ids } } : false,
    )
  },

  'booking-settings': (user, action) => (action === 'read' ? true : isAdmin(user)),

  'booking-settings.private': (user, action) => (action === 'read' ? Boolean(user) : isAdmin(user)),

  // Anonymous sees active items only; any CRM/content role reads everything; admin alone writes.
  catalog: (user, action) => {
    if (action !== 'read') return isAdmin(user)
    const privileged =
      hasRole(user, 'admin') ||
      hasRole(user, 'manager') ||
      hasRole(user, 'barber') ||
      hasRole(user, 'editor')
    return privileged ? true : { active: { equals: true } }
  },

  barbers: (user, action) => {
    if (action === 'read') {
      // The landing shows only public, working barbers; any logged-in role reads all of them.
      if (!user) return { and: [{ showOnSite: { equals: true } }, { active: { equals: true } }] }
      return true
    }
    const contentRole = hasRole(user, 'admin') || hasRole(user, 'editor')
    if (action !== 'update') return contentRole
    // A manager may update barbers of their locations (only `weeklySchedule`, see field rules).
    const ids = userLocationIds(user)
    return anyOf(
      contentRole,
      hasRole(user, 'manager') && ids.length > 0 ? { locations: { in: ids } } : false,
    )
  },

  'barbers.crm': (user, action) => (action === 'read' ? isStaff(user) : isAdmin(user)),

  'barbers.schedule': (user, action, doc) => {
    if (isAdmin(user)) return true
    if (action === 'delete') return false
    if (barberInManagerLocations(user, doc)) return true
    return action === 'read' && hasRole(user, 'barber') && ownsBarber(user, doc)
  },

  'barbers.commission': (user, action, doc) =>
    isAdmin(user) || (action === 'read' && hasRole(user, 'barber') && ownsBarber(user, doc)),

  'barbers.user': (user) => isAdmin(user),

  // Price overrides are public prices (shown in online booking); only admin edits them.
  'barber-prices': (user, action) => (action === 'read' ? true : isAdmin(user)),

  clients: (user, action) =>
    action === 'delete' ? isAdmin(user) : isAdmin(user) || hasRole(user, 'manager'),

  'clients.email': (user, action) =>
    action === 'read' && (isAdmin(user) || hasRole(user, 'manager')),

  'promo-codes': (user, action) => (action === 'read' ? isStaff(user) : isAdmin(user)),

  'promo-codes.usage': (user, action) => action === 'read' && isStaff(user),

  'schedule-exceptions': (user, action, doc, scope) => {
    if (isAdmin(user)) return true
    const managed = hasRole(user, 'manager') ? [...(scope?.managedBarberIds ?? [])] : []
    const own = hasRole(user, 'barber') ? (scope?.barberId ?? null) : null
    if (doc !== undefined) {
      const barber = relId((doc as { barber?: unknown } | null)?.barber)
      if (barber === undefined) return false
      if (managed.includes(barber)) return true
      return action === 'read' && own === barber
    }
    return anyOf(
      managed.length > 0 ? { barber: { in: managed } } : false,
      action === 'read' && own ? { barber: { equals: own } } : false,
    )
  },

  // Manager: appointments of their locations; barber: their own appointments (§3.1, decision 37).
  // Delete is admin-only (others cancel). With `doc` both the location and the barber are checked.
  appointments: (user, action, doc, scope) => {
    if (isAdmin(user)) return true
    if (action === 'delete') return false
    const locations = hasRole(user, 'manager') ? userLocationIds(user) : []
    const own = hasRole(user, 'barber') ? (scope?.barberId ?? null) : null
    if (doc !== undefined) {
      const row = doc as { location?: unknown; barber?: unknown } | null
      const location = relId(row?.location)
      const barber = relId(row?.barber)
      return (
        (location !== undefined && locations.includes(location)) || (own !== null && barber === own)
      )
    }
    return anyOf(
      locations.length > 0 ? { location: { in: locations } } : false,
      own ? { barber: { equals: own } } : false,
    )
  },

  // Restoring cancelled / no-show / completed appointments (§5.1).
  'appointments.restore': (user) => isAdmin(user) || hasRole(user, 'manager'),

  // Manual discount (decision 30).
  'appointments.discount': (user) => isAdmin(user) || hasRole(user, 'manager'),

  // Composition, prices and discounts of a paid appointment (§5.1).
  'appointments.paid': (user) => isAdmin(user),

  // Logs are written by the server only; reading follows the appointment (denormalized location/barber).
  'appointment-logs': (user, action, doc, scope) =>
    action === 'read' ? rules.appointments(user, action, doc, scope) : false,

  // Service documents of the double-booking guard (§5.9): no API access at all.
  'booking-locks': () => false,

  'schedule-exceptions.appointments': (user, action) =>
    action === 'read' && (isAdmin(user) || hasRole(user, 'manager')),

  // Reading the calendar; which locations and which details are visible is decided per row (§3.1).
  calendar: (user, action) => action === 'read' && isStaff(user),

  'cash-registers': (user, action, doc) => {
    if (action !== 'read') return isAdmin(user)
    // A barber picks registers when taking a payment; the balance is hidden by field access.
    if (isAdmin(user) || hasRole(user, 'barber')) return true
    const own = hasRole(user, 'manager') ? userLocationIds(user) : []
    if (doc !== undefined)
      return own.includes(relId((doc as { location?: unknown } | null)?.location) ?? '')
    return own.length > 0 ? { location: { in: own } } : false
  },

  'cash-registers.balance': (user, action) =>
    action === 'read' && (isAdmin(user) || hasRole(user, 'manager')),

  'expense-categories': (user, action) =>
    action === 'read' ? isAdmin(user) || hasRole(user, 'manager') : isAdmin(user),

  'gift-certificates': (user, action) => {
    if (action === 'read') return isStaff(user)
    if (action === 'create') return isAdmin(user) || hasRole(user, 'manager')
    return action === 'update' && isAdmin(user)
  },

  'gift-certificates.buyer': (user, action) =>
    action === 'read' && (isAdmin(user) || hasRole(user, 'manager')),

  transactions: (user, action, doc, scope) => {
    if (action === 'delete') return false
    if (action === 'update') return isAdmin(user)
    if (isAdmin(user)) return true
    const locations = hasRole(user, 'manager') ? userLocationIds(user) : []
    const own = hasRole(user, 'barber') ? (scope?.barberId ?? null) : null
    if (action === 'read') {
      // Barber: payments (and their refunds) of own appointments only.
      const barberTypes = ['appointment_payment', 'refund']
      if (doc !== undefined) {
        const row = doc as { location?: unknown; barber?: unknown; type?: string } | null
        const location = relId(row?.location)
        return (
          (location !== undefined && locations.includes(location)) ||
          (own !== null && relId(row?.barber) === own && barberTypes.includes(row?.type ?? ''))
        )
      }
      return anyOf(
        locations.length > 0 ? { location: { in: locations } } : false,
        own ? { and: [{ type: { in: barberTypes } }, { barber: { equals: own } }] } : false,
      )
    }
    // create without a document: "may create anything at all"; the hook checks the full operation.
    if (doc === undefined) return hasRole(user, 'manager') || hasRole(user, 'barber')
    const operation = doc as TransactionPolicyDoc
    if (managerMayCreate(user, operation)) return true
    // Barber: payments of own appointments.
    return (
      own !== null && operation.type === 'appointment_payment' && relId(operation.barber) === own
    )
  },
}

/**
 * Can `user` perform `action` on `resource`?
 * Without `doc` the result may be a `Where` (row-level filter); with `doc` row rules are evaluated to a boolean.
 */
export const can = (
  user: PolicyUser,
  action: Action,
  resource: Resource,
  doc?: unknown,
  scope?: PolicyScope,
): Decision => rules[resource](user, action, doc, scope)

/** Strict boolean form, for endpoints and UI decisions about a concrete document (or none). */
export const allowed = (
  user: PolicyUser,
  action: Action,
  resource: Resource,
  doc?: unknown,
  scope?: PolicyScope,
) => can(user, action, resource, doc, scope) === true

/** Collection/global access function backed by the policy. */
export const accessFor =
  (action: Action, resource: Resource): Access =>
  ({ req }) =>
    can(req.user, action, resource)

/**
 * Collection access for scoped resources (`schedule-exceptions`): resolves the staff context first.
 * `create` checks the incoming `data` as the document; `update` additionally checks a new `barber`.
 */
export const scopedAccessFor =
  (action: Action, resource: Resource): Access =>
  async ({ req, data }) => {
    const user = req.user as PolicyUser
    if (!user) return can(user, action, resource)
    const { barberId, managedBarberIds } = await getStaffContext(req)
    const scope: PolicyScope = { barberId, managedBarberIds }
    if (action === 'create') return can(user, action, resource, data ?? {}, scope)
    const decision = can(user, action, resource, undefined, scope)
    // Moving a document to a barber outside the user's scope is not allowed.
    const target = action === 'update' ? (data as { barber?: unknown } | undefined)?.barber : null
    if (target && decision !== true && !allowed(user, action, resource, data, scope)) return false
    return decision
  }

/**
 * Row-level access for scoped resources whose target is re-checked on write by a hook
 * (`appointments`): `create` checks the incoming `data`; other actions return the row filter.
 */
export const rowAccessFor =
  (action: Action, resource: Resource): Access =>
  async ({ req, data }) => {
    const user = req.user as PolicyUser
    if (!user) return can(user, action, resource)
    const { barberId, managedBarberIds } = await getStaffContext(req)
    const scope: PolicyScope = { barberId, managedBarberIds }
    if (action === 'create') return can(user, action, resource, data ?? {}, scope)
    return can(user, action, resource, undefined, scope)
  }

/** Field access function backed by the policy (field access must be boolean). */
export const fieldAccessFor =
  (action: Exclude<Action, 'delete'>, resource: Resource): FieldAccess =>
  ({ req, doc }) =>
    can(req.user, action, resource, doc) === true

// ---------------------------------------------------------------------------
// Staff context
// ---------------------------------------------------------------------------

export type StaffContext = {
  userId: string | null
  roles: Role[]
  isAdmin: boolean
  isManager: boolean
  isBarber: boolean
  isEditor: boolean
  isStaff: boolean
  /** Locations assigned to the user (manager scope). */
  locationIds: string[]
  /** `barbers` document linked through `barbers.user`; `null` if none or not exactly one. */
  barberId: string | null
  /** Barbers working in the manager's locations (empty unless the user is a manager). */
  managedBarberIds: string[]
}

const CONTEXT_KEY = 'staffContext'

type CachedContext = { userId: string | null; value: StaffContext }

const findBarberId = async (req: PayloadRequest, userId: string): Promise<string | null> => {
  // System lookup (no `user` is passed); `barbers.user` is unique (validated on write + partial index).
  const { docs } = await req.payload.find({
    collection: 'barbers',
    where: { user: { equals: userId } },
    depth: 0,
    limit: 2,
    pagination: false,
    select: {},
    req,
  })
  return docs.length === 1 ? String(docs[0].id) : null
}

const findManagedBarberIds = async (
  req: PayloadRequest,
  locationIds: string[],
): Promise<string[]> => {
  if (locationIds.length === 0) return []
  const { docs } = await req.payload.find({
    collection: 'barbers',
    where: { locations: { in: locationIds } },
    depth: 0,
    pagination: false,
    select: {},
    req,
  })
  return docs.map((doc) => String(doc.id))
}

/**
 * Who is making the request, resolved once per request and cached in `req.context`.
 * Use it in endpoints and access functions that need the barber link (async).
 */
export const getStaffContext = async (req: PayloadRequest): Promise<StaffContext> => {
  const user = req.user as PolicyUser
  const userId = user?.id === undefined ? null : String(user.id)
  const cached = req.context[CONTEXT_KEY] as CachedContext | undefined
  if (cached && cached.userId === userId) return cached.value

  const roles = (user?.roles ?? []).filter((r): r is Role =>
    (ROLES as readonly string[]).includes(r),
  )
  const isBarber = roles.includes('barber')
  const locationIds = userLocationIds(user)
  const value: StaffContext = {
    userId,
    roles,
    isAdmin: roles.includes('admin'),
    isManager: roles.includes('manager'),
    isBarber,
    isEditor: roles.includes('editor'),
    isStaff: isStaff(user),
    locationIds,
    barberId: isBarber && userId ? await findBarberId(req, userId) : null,
    managedBarberIds: roles.includes('manager') ? await findManagedBarberIds(req, locationIds) : [],
  }
  req.context[CONTEXT_KEY] = { userId, value } satisfies CachedContext
  return value
}
