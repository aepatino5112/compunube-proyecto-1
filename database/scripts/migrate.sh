#!/bin/sh
set -eu
: "${DATABASE_URL:?DATABASE_URL is required}"
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
for migration in "$script_dir"/../migrations/*_apply.sql; do
  [ -f "$migration" ] || continue
  psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f "$migration"
done
