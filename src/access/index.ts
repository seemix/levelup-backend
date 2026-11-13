import type { Access, FieldAccess } from 'payload'
import { accessFor, fieldAccessFor } from './policy'

export type { Role } from './policy'
export { can, allowed, getStaffContext } from './policy'

export const anyone: Access = () => true

export const authenticated: Access = ({ req: { user } }) => Boolean(user)

/** Users management (create/delete users): admin only. */
export const adminOnly: Access = accessFor('create', 'users')

/** Site content writes: admin or editor. */
export const adminOrEditor: Access = accessFor('update', 'content')

/** Users read/update: admin — everyone, others — only themselves. */
export const adminOrSelf: Access = accessFor('read', 'users')

/** Privileged user fields (`roles`, `locations`): only admin changes them. */
export const adminOnlyField: FieldAccess = fieldAccessFor('update', 'users.privileged')
