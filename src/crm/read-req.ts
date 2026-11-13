import type { PayloadRequest } from 'payload'

/**
 * Request copy without the DB transaction, for read-only queries inside field `validate` functions.
 * Payload runs field validators concurrently; a failing sibling validator rolls the transaction back
 * while another validator's query is still using its session (MongoDB "transaction number" error).
 * The unique indexes remain the final guard, so reading committed data is enough here.
 */
export const outsideTransaction = (req: PayloadRequest): PayloadRequest =>
  ({ ...req, transactionID: undefined }) as PayloadRequest
