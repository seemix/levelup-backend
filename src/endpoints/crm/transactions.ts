/**
 * `POST /api/crm/transactions/:id/reverse` {comment?} — reversal of an operation (spec §5.6, §6.2):
 * the mirror operation is created with the user's rights, the original gets `reversed = true`.
 * An operation the user cannot read → 404 (existence is not revealed); the rest of the rules
 * (type, own locations and the current day for a manager, repeated reversal) — the ledger hook.
 * Answer: `{ transaction, original, warnings }` (`NEGATIVE_BALANCE`, A8).
 * An appointment payment is undone by `/refund` (admin, `./payments`).
 */
import { reverseTransaction, runLedgerTransaction } from '@/crm/ledger.service'

import { InputErrors, isId, ok, optionalText, readBody } from '../booking/http'
import { crmEndpoint, crmError, routeParam } from './http'

const COMMENT_MAX = 1000

export const reverseTransactionEndpoint = crmEndpoint(
  'post',
  '/transactions/:id/reverse',
  async (req) => {
    const id = routeParam(req, 'id')
    if (!isId(id)) throw crmError('NOT_FOUND', 404)
    const body = await readBody(req)
    const errors = new InputErrors()
    const comment = optionalText(errors, 'comment', body.comment, COMMENT_MAX)
    errors.throwIfAny()

    const result = await runLedgerTransaction(req, async () => {
      const { docs } = await req.payload.find({
        collection: 'transactions',
        where: { id: { equals: id } },
        limit: 1,
        pagination: false,
        depth: 0,
        select: { type: true },
        overrideAccess: false,
        user: req.user,
        req,
      })
      if (docs.length === 0) throw crmError('NOT_FOUND', 404)
      return reverseTransaction(req, id, { comment })
    })
    return ok({
      transaction: result.doc,
      original: id,
      warnings: result.warnings,
    })
  },
)
