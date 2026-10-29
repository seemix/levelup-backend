import * as migration_20261029_000000_users_roles from './20261029_000000_users_roles'
import * as migration_20261029_000001_media_alt_localized from './20261029_000001_media_alt_localized'
import * as migration_20261029_000002_order_defaults from './20261029_000002_order_defaults'

export const migrations = [
  {
    up: migration_20261029_000000_users_roles.up,
    down: migration_20261029_000000_users_roles.down,
    name: '20261029_000000_users_roles',
  },
  {
    up: migration_20261029_000001_media_alt_localized.up,
    down: migration_20261029_000001_media_alt_localized.down,
    name: '20261029_000001_media_alt_localized',
  },
  {
    up: migration_20261029_000002_order_defaults.up,
    down: migration_20261029_000002_order_defaults.down,
    name: '20261029_000002_order_defaults',
  },
]
