/**
 * `pnpm crm:recalc-balances` — recomputes every cash register balance from all ledger entries
 * (spec §5.6) and fixes the registers whose stored balance differs. `RECALC_DRY_RUN=true` only
 * reports the differences (`payload run` consumes CLI flags, so the mode is an env variable).
 */
import { getPayload } from 'payload'

import { recalculateBalances } from '@/crm/ledger.service'
import config from '@/payload.config'

const main = async () => {
  const payload = await getPayload({ config: await config })
  const apply = process.env.RECALC_DRY_RUN !== 'true'
  const { registers, diffs } = await recalculateBalances(payload, { apply })
  for (const diff of diffs)
    payload.logger.warn(
      `[recalc-balances] ${diff.cashRegister}: stored ${diff.stored}, computed ${diff.computed} (bani)`,
    )
  payload.logger.info(
    `[recalc-balances] registers: ${registers}, mismatched: ${diffs.length}` +
      (diffs.length > 0 ? (apply ? ', fixed' : ', not changed (dry run)') : ''),
  )
}

// `payload run` exits as soon as this module has been imported, so the work must be awaited here.
try {
  await main()
  process.exit(0)
} catch (error) {
  console.error(error)
  process.exit(1)
}
