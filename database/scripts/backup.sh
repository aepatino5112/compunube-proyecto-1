#!/bin/sh
set -eu
: "${DATABASE_URL:?DATABASE_URL is required}"
: "${1:?usage: backup.sh OUTPUT.dump}"
umask 077
pg_dump --format=custom --no-password --dbname="$DATABASE_URL" --file="$1"
