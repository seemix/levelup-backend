const isBuildPhase = process.env.NEXT_PHASE === 'phase-production-build';

const getRequired = (name: 'PAYLOAD_SECRET' | 'DATABASE_URL'): string => {
    const value = process.env[name];
    if (value) return value;
    // `next build` does not need real credentials (e.g. in a Docker build stage).
    if (isBuildPhase) return '';
    throw new Error(`Missing required environment variable: ${name}`);
};

const origins = [process.env.FRONTEND_URL, process.env.BACKEND_URL].filter(
    (origin): origin is string => Boolean(origin),
);

export const env = {
    isProduction: process.env.NODE_ENV === 'production',
    secret: getRequired('PAYLOAD_SECRET'),
    databaseUrl: getRequired('DATABASE_URL'),
    /** `undefined` keeps Payload's defaults when no origins are configured. */
    allowedOrigins: origins.length > 0 ? origins : undefined,
    cookieDomain: process.env.COOKIE_DOMAIN || undefined,
};
