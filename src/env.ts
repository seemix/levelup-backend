const isBuildPhase = process.env.NEXT_PHASE === 'phase-production-build'

const getRequired = (name: 'PAYLOAD_SECRET' | 'DATABASE_URL'): string => {
  const value = process.env[name]
  if (value) return value
  // `next build` does not need real credentials (e.g. in a Docker build stage).
  if (isBuildPhase) return ''
  throw new Error(`Missing required environment variable: ${name}`)
}

const origins = [process.env.FRONTEND_URL, process.env.BACKEND_URL].filter(
  (origin): origin is string => Boolean(origin),
)

const s3 = process.env.S3_BUCKET
  ? {
      bucket: process.env.S3_BUCKET,
      region: process.env.S3_REGION || 'auto',
      endpoint: process.env.S3_ENDPOINT || undefined,
      accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
    }
  : undefined

export const env = {
  s3,
  isProduction: process.env.NODE_ENV === 'production',
  secret: getRequired('PAYLOAD_SECRET'),
  databaseUrl: getRequired('DATABASE_URL'),
  /** `undefined` keeps Payload's defaults when no origins are configured. */
  allowedOrigins: origins.length > 0 ? origins : undefined,
  cookieDomain: process.env.COOKIE_DOMAIN || undefined,
  /** Password of the users created by `pnpm seed` (development only). */
  seedPassword: process.env.SEED_PASSWORD || undefined,
}
