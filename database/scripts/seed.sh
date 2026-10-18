#!/bin/sh
set -eu
: "${DATABASE_URL:?DATABASE_URL is required}"
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
for seed in "$script_dir"/../seeds/*.sql; do
  [ -f "$seed" ] || continue
  psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f "$seed"
done
