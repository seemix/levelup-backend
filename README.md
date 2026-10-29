# LevelUp Backend

Headless CMS (admin panel + REST/GraphQL API) for levelupbalti.com, built with
[Payload CMS 3](https://payloadcms.com), Next.js 16 and MongoDB. Content is localized (`ru` default, `ro`, `en`).

## Content model

| Slug | Type | Notes |
|---|---|---|
| `users` | auth collection | roles `admin` / `editor`; the first created user becomes `admin` |
| `media` | upload | images only, resized to `thumbnail`/`card`/`hero` (webp), `blurHash` generated on upload, localized `alt` |
| `barbers` | collection | sorted by `order`, localized `description` / `about` |
| `slides` | collection | sorted by `order`, `image` (1920x1080) and `verticalImage` (1080x2400) |
| `about-us` | global | localized rich text |

Access: public read for content; create/update/delete for `admin` and `editor`; user management for `admin` only.

## Requirements

- Node.js 22 (`.nvmrc`), pnpm 10 (`corepack enable`)
- MongoDB **replica set** (transactions are used; a single-node replica set is enough, see `docker-compose.yml`)

## Getting started

```bash
cp .env.example .env     # fill DATABASE_URL and PAYLOAD_SECRET
pnpm install
pnpm dev                 # admin panel at http://localhost:3000
```

### Environment variables

See `.env.example`. `PAYLOAD_SECRET` and `DATABASE_URL` are mandatory (the app refuses to start without them).
`FRONTEND_URL` / `BACKEND_URL` configure CORS and CSRF; `COOKIE_DOMAIN` (e.g. `.levelupbalti.com`) is required in
production so the auth cookie is shared with the frontend. Set `S3_*` variables to store media in S3-compatible storage.

## Scripts

| Command | Description |
|---|---|
| `pnpm dev` / `build` / `start` | Next.js dev server, production build, production server |
| `pnpm typecheck` / `lint` | TypeScript and ESLint checks |
| `pnpm test:int` | Integration tests (throw-away in-memory MongoDB, first run downloads `mongod`) |
| `pnpm test:e2e` | Playwright admin tests (need a running database from `.env`) |
| `pnpm generate:types` / `generate:importmap` | Run after changing the schema / custom components |
| `pnpm migrate` | Apply data migrations from `src/migrations` (run once per deploy) |
| `pnpm deps:check` | List outdated dependencies |

## Docker

```bash
docker compose up --build
```

Runs the app (standalone Next.js build) and a single-node MongoDB replica set. Health check: `GET /api/health`.

## More

- [Refactoring plan and progress](docs/refactoring-plan.md)
- [Architecture](docs/architecture.md)
- [Deployment](docs/deployment.md)
