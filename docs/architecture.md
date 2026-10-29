# Architecture

```
Frontend (levelupbalti.com) --REST/GraphQL--> Payload API (Next.js route handlers, /api/*)
Editors ---------------------> Admin panel (served at /)  ----> Payload ----> MongoDB (replica set)
                                                                      \----> media: ./media or S3 (optional)
```

- `src/payload.config.ts` — central config (localization, plugins, db, CORS/CSRF from env)
- `src/env.ts` — environment validation; fails fast when secrets are missing
- `src/access/` — reusable access functions (`anyone`, `adminOnly`, `adminOrEditor`, `adminOrSelf`)
- `src/collections`, `src/globals` — content schema; shared bits in `src/fields`
- `src/hooks` — lifecycle hooks (`generateBlurHash`)
- `src/migrations` — data migrations (registered in `src/migrations/index.ts`, run with `pnpm migrate`)
- `src/app/api/health` — health check used by Docker

## Frontend API tips

- Use `?locale=ru|ro|en` (`fallback-locale` is not set: request a locale explicitly).
- Default `depth` is 1. Request `depth=0` and `select` where possible.
- Media objects expose `sizes.thumbnail|card|hero` and `blurHash` (base64 placeholder).
- Lists of `barbers` and `slides` are sorted by `order`.
