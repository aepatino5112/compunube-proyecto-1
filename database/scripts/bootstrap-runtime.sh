#!/bin/sh
# One-shot administrative bootstrap. Never run this identity in an app container.
set -eu
: "${POSTGRES_USER:?}"
: "${POSTGRES_PASSWORD:?}"
: "${POSTGRES_DB:?}"
: "${MATCH_DB_PASSWORD:?}"
: "${PLAYER_DB_PASSWORD:?}"
: "${MONITOR_DB_PASSWORD:?}"
export PGPASSWORD="$POSTGRES_PASSWORD"
export DATABASE_URL="postgresql://$POSTGRES_USER@postgres:5432/$POSTGRES_DB"
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
sh "$script_dir/migrate.sh" >/dev/null
sh "$script_dir/provision-runtime.sh"
