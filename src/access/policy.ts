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

/** OR-combination: roles add permissions, they never take them away. */
const anyOf = (...decisions: Decision[]): Decision => {
  if (decisions.includes(true)) return true
  const wheres = decisions.filter((d): d is Where => typeof d === 'object')
  if (wheres.length === 0) return false
  return wheres.length === 1 ? wheres[0] : { or: wheres }
}

type Rule = (user: PolicyUser, action: Action, doc?: unknown) => Decision

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
): Decision => rules[resource](user, action, doc)

/** Strict boolean form, for endpoints and UI decisions about a concrete document (or none). */
export const allowed = (user: PolicyUser, action: Action, resource: Resource, doc?: unknown) =>
  can(user, action, resource, doc) === true

/** Collection/global access function backed by the policy. */
export const accessFor =
  (action: Action, resource: Resource): Access =>
  ({ req }) =>
    can(req.user, action, resource)

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
}

const CONTEXT_KEY = 'staffContext'

type CachedContext = { userId: string | null; value: StaffContext }

/** Is `barbers.user` defined in the schema? (The field is added in stage 3.) */
const barbersHaveUserField = (req: PayloadRequest): boolean =>
  Boolean(
    req.payload.collections.barbers?.config.flattenedFields.some((field) => field.name === 'user'),
  )

const findBarberId = async (req: PayloadRequest, userId: string): Promise<string | null> => {
  if (!barbersHaveUserField(req)) return null
  // System lookup (no `user` is passed): the rule "barber user ↔ exactly one barbers.user" is enforced on write.
  const { docs } = await req.payload.find({
    collection: 'barbers',
    where: { user: { equals: userId } } as Where,
    depth: 0,
    limit: 2,
    pagination: false,
    select: {},
    req,
  })
  return docs.length === 1 ? String(docs[0].id) : null
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
  const value: StaffContext = {
    userId,
    roles,
    isAdmin: roles.includes('admin'),
    isManager: roles.includes('manager'),
    isBarber,
    isEditor: roles.includes('editor'),
    isStaff: isStaff(user),
    locationIds: userLocationIds(user),
    barberId: isBarber && userId ? await findBarberId(req, userId) : null,
  }
  req.context[CONTEXT_KEY] = { userId, value } satisfies CachedContext
  return value
}
