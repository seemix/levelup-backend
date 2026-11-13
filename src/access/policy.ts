import type { Access, FieldAccess, PayloadRequest, Where } from 'payload'

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
