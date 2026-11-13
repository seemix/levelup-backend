import type { Endpoint } from 'payload'

import { cancelEndpoint, cancelInfoEndpoint } from './cancel'
import { configEndpoint } from './config'
import { createEndpoint } from './create'
import { quoteEndpoint } from './quote'
import { daysEndpoint, slotsEndpoint } from './slots'

/** Public booking API `/api/booking/*` (spec §6.1). CORS comes from `config.cors` (`FRONTEND_URL`). */
export const bookingEndpoints: Endpoint[] = [
  configEndpoint,
  daysEndpoint,
  slotsEndpoint,
  quoteEndpoint,
  createEndpoint,
  cancelInfoEndpoint,
  cancelEndpoint,
]
