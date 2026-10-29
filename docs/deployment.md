# Deployment

1. Provide env vars (see `.env.example`); in production set `COOKIE_DOMAIN`, `FRONTEND_URL`, `BACKEND_URL`.
2. MongoDB must run as a replica set.
3. Build and run: `docker compose up --build` (or `pnpm build && pnpm start`).
4. Apply data migrations once per release: `pnpm migrate`
   (first release after the refactoring: roles for existing users, localized `media.alt`, `order` for barbers/slides).
5. Verify `GET /api/health` returns `{"status":"ok"}`.

## Backups

Decision: media stay on local disk (Docker volume `media`), protected by scheduled backups. S3 support remains available (see below) if this changes.

- Automated: `scripts/backup.sh [dir] [keep_days]` dumps MongoDB and archives `media`, pruning old copies; schedule with cron (example in the script).
- Store backups on a different machine/disk than the app, and test a restore periodically.

- MongoDB: `mongodump --uri "$DATABASE_URL" --gzip --archive=backup-$(date +%F).gz` (restore with `mongorestore --gzip --archive=...`).
- Media: back up the `media` volume, or rely on bucket versioning when S3 is used.
- Take both before every migration.

## Moving media to S3

1. Set the `S3_*` variables.
2. Upload the contents of `./media` to `<bucket>/media/` (e.g. `aws s3 sync media s3://<bucket>/media`).
3. Restart the app; new uploads go to the bucket.

## Monitoring

Decision: health check + external uptime monitor (no Sentry).

- Point UptimeRobot / Better Stack at `GET https://<backend-domain>/api/health` (expects HTTP 200 and `{"status":"ok"}`; 503 when MongoDB is unreachable), 1–5 min interval, alerts to email/Telegram.
- Docker already uses the same endpoint for its `HEALTHCHECK`.
- Errors: `docker compose logs -f payload` (Payload logs through pino to stdout).
