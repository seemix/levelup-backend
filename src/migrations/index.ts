import * as migration_20261029_000000_users_roles from './20261029_000000_users_roles'
import * as migration_20261029_000001_media_alt_localized from './20261029_000001_media_alt_localized'
import * as migration_20261029_000002_order_defaults from './20261029_000002_order_defaults'
import * as migration_20261113_000000_default_location from './20261113_000000_default_location'
import * as migration_20261113_000001_barbers_crm from './20261113_000001_barbers_crm'

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
  {
    up: migration_20261113_000000_default_location.up,
    down: migration_20261113_000000_default_location.down,
    name: '20261113_000000_default_location',
  },
  {
    up: migration_20261113_000001_barbers_crm.up,
    down: migration_20261113_000001_barbers_crm.down,
    name: '20261113_000001_barbers_crm',
  },
]
