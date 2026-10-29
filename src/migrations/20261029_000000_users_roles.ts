import type { MigrateDownArgs, MigrateUpArgs } from '@payloadcms/db-mongodb';

// Users created before RBAC was introduced have no roles: keep their access by making them admins.
export async function up({ payload }: MigrateUpArgs): Promise<void> {
    await payload.db.collections['users'].updateMany(
        { $or: [{ roles: { $exists: false } }, { roles: { $size: 0 } }] },
        { $set: { roles: ['admin'] } },
    );
}

export async function down(_args: MigrateDownArgs): Promise<void> {
    // Roles are not removed on rollback: the field is simply ignored by the previous schema.
}
