# Deployment

1. Provide env vars (see `.env.example`); in production set `COOKIE_DOMAIN`, `FRONTEND_URL`, `BACKEND_URL`.
2. MongoDB must run as a replica set.
3. Build and run: `docker compose up --build` (or `pnpm build && pnpm start`).
4. Apply data migrations once per release: `pnpm migrate`
   (first release after the refactoring: roles for existing users, localized `media.alt`, `order` for barbers/slides).
5. Verify `GET /api/health` returns `{"status":"ok"}`.

## Backups

- MongoDB: `mongodump --uri "$DATABASE_URL" --gzip --archive=backup-$(date +%F).gz` (restore with `mongorestore --gzip --archive=...`).
- Media: back up the `media` volume, or rely on bucket versioning when S3 is used.
- Take both before every migration.

## Moving media to S3

1. Set the `S3_*` variables.
2. Upload the contents of `./media` to `<bucket>/media/` (e.g. `aws s3 sync media s3://<bucket>/media`).
3. Restart the app; new uploads go to the bucket.
