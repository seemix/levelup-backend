import { APIError } from 'payload'

/**
 * Business-rule error: machine `code` in `data.code` (the client translates it),
 * `message` is the already translated text for the admin UI.
 */
export const businessError = (code: string, message: string, status = 400): APIError =>
  new APIError(message, status, { code }, true)
