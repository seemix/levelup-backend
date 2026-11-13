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

## Email (Resend)

Appointment emails (confirmation, reschedule, cancellation, reminder) go through `@payloadcms/email-resend`.

1. Create an account at resend.com and an API key (**Sending access** is enough). Put it only into the server's `.env`: `RESEND_API_KEY=re_...` (never commit it).
2. Verify the sending domain in Resend → Domains (e.g. `levelupbalti.com`) and add the DNS records it shows:
   - **SPF**: `TXT` record on the `send` subdomain (`v=spf1 include:amazonses.com ~all`) plus the `MX` record for bounces;
   - **DKIM**: `TXT` record `resend._domainkey` with the public key;
   - optionally **DMARC**: `TXT` `_dmarc` with `v=DMARC1; p=none; rua=mailto:<your address>`.
   Wait until the domain status is **Verified**.
3. Set the sender: `EMAIL_FROM_ADDRESS=noreply@levelupbalti.com` (must be on the verified domain, otherwise Resend rejects the email) and `EMAIL_FROM_NAME=LevelUp Barbershop`.
4. Set `FRONTEND_URL` correctly: the cancel link in the confirmation is `${FRONTEND_URL}/{lang}/booking/cancel/{token}`.
5. Test: send to `delivered@resend.dev` (Resend's test address) or to your own mailbox — create an appointment for a client with this email and check the Resend dashboard (Emails) and the appointment history (`email` entry).

Without `RESEND_API_KEY` nothing is sent: the email is written to the server log (development and tests).
The email language is `appointments.language` (copied from `clients.language`), then `clients.language`, then `ru`.
Clients without an email get no emails.

## Background jobs

Emails are sent by Payload Jobs, so a Resend failure never breaks a booking and is retried.

- `sendAppointmentEmail` — one email of one appointment, **3 retries**. Queued by the `appointments` afterChange hook in the same transaction as the booking (create → confirmation, time/barber/location change → reschedule, `scheduled` → `cancelled_*` → cancellation). Every sent email is written to `appointment-logs` with `action = email`.
- `queueAppointmentReminders` — scheduled every 5 minutes (`*/5 * * * *`): queues a reminder for `scheduled` appointments starting in `[now + 24h − 5 min, now + 24h]` with `reminderSentAt = null`. `reminderSentAt` is claimed atomically before sending, so a reminder goes out exactly once (released if sending fails); moving an appointment resets it.
- The queue runs **inside the server process** (`jobs.autoRun`, every minute, `default` queue). Requirements: run a single long-lived Node process (Docker `payload` service); this does not work on serverless platforms. With several instances jobs are still safe (Payload locks jobs), but one instance is enough. Set `JOBS_AUTORUN=false` to disable the runner (e.g. for a separate worker started with `pnpm payload jobs:run --queue default`).
- The plain cancel token of a new appointment is stored in the confirmation job's input until it completes (deleted on success). If the job fails after all retries it stays in the `payload-jobs` collection with the error — review failed jobs there (Admin → Payload Jobs) and delete them after fixing the cause.
- Monitoring: `docker compose logs -f payload` shows job errors; the `payload-jobs` collection with `hasError = true` lists the failed ones.

## Public booking API
- `/api/booking/*` (spec §6.1) is public; CORS allows `FRONTEND_URL` (and `BACKEND_URL`) via `config.cors`.
- Rate limits are kept **in process memory** (A11): run one instance, or plug a shared store into `setRateLimitStore` (`src/crm/rate-limit.ts`).
- The limits are per client IP taken from `X-Forwarded-For`: set `TRUSTED_PROXY_HOPS` to the number of reverse proxies in front of the app that append to it (default `1`, e.g. nginx/Caddy with `proxy_add_x_forwarded_for`; `0` = no proxy, the header is ignored and all clients share one bucket). A wrong value lets clients spoof their IP or puts everyone into one bucket.
- Manual check: `docs/api-booking.http`.
