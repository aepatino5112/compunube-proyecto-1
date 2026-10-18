#!/bin/sh
set -eu
: "${DATABASE_URL:?DATABASE_URL is required}"
: "${1:?usage: RESTORE_CONFIRM=YES restore.sh BACKUP.dump}"
[ "${RESTORE_CONFIRM:-}" = YES ] || { echo 'Set RESTORE_CONFIRM=YES for destructive restore' >&2; exit 1; }
[ -f "$1" ] || { echo 'Backup file not found' >&2; exit 1; }
pg_restore --exit-on-error --clean --if-exists --no-password --dbname="$DATABASE_URL" "$1"
