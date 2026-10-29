import type { Access, FieldAccess } from 'payload';

export type Role = 'admin' | 'editor';

type UserWithRoles = { id?: number | string; roles?: Role[] | null } | null | undefined;

const hasRole = (user: UserWithRoles, role: Role) => Boolean(user?.roles?.includes(role));

export const anyone: Access = () => true;

export const authenticated: Access = ({ req: { user } }) => Boolean(user);

export const adminOnly: Access = ({ req: { user } }) => hasRole(user, 'admin');

export const adminOrEditor: Access = ({ req: { user } }) =>
    hasRole(user, 'admin') || hasRole(user, 'editor');

export const adminOrSelf: Access = ({ req: { user } }) => {
    if (!user) return false;
    if (hasRole(user, 'admin')) return true;
    return { id: { equals: user.id } };
};

export const adminOnlyField: FieldAccess = ({ req: { user } }) => hasRole(user, 'admin');
