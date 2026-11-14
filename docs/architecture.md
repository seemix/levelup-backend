# Architecture

```
Visitor ── levelupbalti.com (levelup-front, Next.js + next-intl)
              │  landing content: REST /api/* (barbers, slides, about-us, services)
              │  online booking:  /api/booking/* (public, rate limited)
              ▼
Staff ───── Payload admin (served at /) + CRM views (/calendar, /cash, /reports/*)
              │  staff API: /api/crm/* (policy-checked)
              ▼
           Payload 3 (Next.js route handlers) ──► MongoDB replica set (transactions)
              │                                └─► media: ./media volume or S3
              └─ Payload Jobs (in process) ──► Resend (emails)
```

Source of truth for entities, statuses and roles: [spec.md](spec.md). Decisions: spec §1 (`A..`).

## Backend layout

- `src/payload.config.ts` — collections, i18n (ru/ro/en), localization, DB adapter (`ensureIndexes`, `prodMigrations`), CORS/CSRF, jobs.
- `src/env.ts` — every environment variable is read here only.
- `src/access/policy.ts` — **all** permission rules (`can`, `accessFor`, `rowAccessFor`, `fieldAccessFor`, `getStaffContext`). Collections and endpoints ask the policy; UI only hides buttons.
- `src/collections`, `src/globals` — schema, one entity per file.
- `src/crm/` — pure business logic without the database (slots, pricing, promo, appointment status, ledger rules, payments, certificates, reports, salary, money, time, phone) and their DB services (`*.service.ts`, `appointments.ts`, `slots.loader.ts`).
- `src/endpoints/booking/*` — public booking API (spec §6.1); `src/endpoints/crm/*` — staff API (§6.2). Examples: `docs/api-booking.http`, `docs/api-crm.http`.
- `src/emails/` — HTML templates + ru/ro/en dictionaries; `src/jobs/` — Payload Jobs tasks.
- `src/components/` — admin views: calendar, finance (cash registers), reports (clients, finance, salary).
- `src/migrations/` — data migrations and indexes (`src/migrations/index.ts`).
- `src/seed/` — development data (`pnpm seed`, refused in production).

## Key mechanisms

- **Money**: integer bani (MDL), only through `src/crm/money.ts`. **Time**: UTC instants, local dates/times of `Europe/Chisinau` through `src/crm/time.ts` (DST-safe).
- **Double booking** (§5.9): appointment writes run in a DB transaction holding a `booking-locks {barber, date}` document; WriteConflict → up to 3 retries → `SLOT_TAKEN`.
- **Ledger** (§5.6): `transactions` are immutable; balances change only via `$inc` in the same transaction; corrections are reversals / refunds; `pnpm crm:recalc-balances` recomputes balances.
- **Emails**: queued as jobs in the same transaction as the appointment; retries; reminders by a 5-minute schedule.
- **Access**: collection access, row-level `Where` and field-level read come from the policy; raw aggregations (reports) narrow the data explicitly in the endpoint.
- **Indexes and migrations**: indexes are built on connect and awaited (`ensureIndexes: true`, `autoIndex: false`, A39); migrations run in transactions — automatically at production start (`prodMigrations`) or with `pnpm migrate`.

## Frontend API tips

- Use `?locale=ru|ro|en` (`fallback-locale` is not set: request a locale explicitly).
- Default `depth` is 1. Request `depth=0` and `select` where possible.
- Media objects expose `sizes.thumbnail|card|hero` and `blurHash` (base64 placeholder).
- Lists of `barbers` and `slides` are sorted by `order`.
- Online booking switch: `NEXT_PUBLIC_BOOKING_PROVIDER=easyweek|native` (build-time variable of `levelup-front`).

## Tests

- `pnpm test:int` — vitest on an in-memory MongoDB replica set: pure logic, access matrix (`security.int.spec.ts`, `policy`, per-collection specs), services, endpoints, migrations in transactions.
- `pnpm test:e2e` — Playwright (`scripts/e2e.ts`): throw-away MongoDB + `payload migrate`, backend on :3100, `../levelup-front` on :3101 with `NEXT_PUBLIC_BOOKING_PROVIDER=native`; scenario «online booking → calendar → payment → register balance». Stop `pnpm dev` in both repositories first.
