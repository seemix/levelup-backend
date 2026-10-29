#!/usr/bin/env sh
# Backs up MongoDB and the local media folder. Usage: DATABASE_URL=... ./scripts/backup.sh [backup_dir] [keep_days]
# Cron example (daily at 03:00): 0 3 * * * cd /srv/levelup && DATABASE_URL=... ./scripts/backup.sh /srv/backups 14
set -eu

: "${DATABASE_URL:?DATABASE_URL is required}"
DIR="${1:-./backups}"
KEEP_DAYS="${2:-14}"
MEDIA_DIR="${MEDIA_DIR:-./media}"
STAMP="$(date +%F_%H%M)"

mkdir -p "$DIR"
mongodump --uri "$DATABASE_URL" --gzip --archive="$DIR/db-$STAMP.gz"
tar czf "$DIR/media-$STAMP.tgz" -C "$(dirname "$MEDIA_DIR")" "$(basename "$MEDIA_DIR")"

find "$DIR" -name 'db-*.gz' -mtime +"$KEEP_DAYS" -delete
find "$DIR" -name 'media-*.tgz' -mtime +"$KEEP_DAYS" -delete
echo "Backup written to $DIR ($STAMP)"
