#!/usr/bin/env bash
# H66: build and deploy the current checkout with Docker Compose, then verify it.
#   scripts/deploy/deploy.sh            # revision = git commit (with -dirty if modified; zip-<time> without Git)
#   COMPUNUBE_REVISION=v1.0.0 scripts/deploy/deploy.sh
# Secrets come only from the untracked env file (COMPUNUBE_ENV_FILE, default .env).
source "$(dirname "$0")/lib.sh"

if [ -n "${COMPUNUBE_REVISION:-}" ]; then
  revision=$COMPUNUBE_REVISION
elif git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  revision=$(git rev-parse --short=12 HEAD)$(git diff --quiet HEAD -- || echo -dirty)
else
  revision=zip-$(date -u +%Y%m%d%H%M%S)   # ZIP download: no commit to name it after
fi
export COMPUNUBE_REVISION=$revision COMPUNUBE_IMAGE_TAG=$revision
preflight
mkdir -p "$STATE_DIR/backups" && chmod 700 "$STATE_DIR" "$STATE_DIR/backups"
previous=$(revision_of match-service-go)
log "deploying revision $revision (running: $previous)"

backup=none
if [ -n "$(dc ps -q postgres)" ]; then
  backup="$STATE_DIR/backups/$(date -u +%Y%m%dT%H%M%SZ)-before-$revision.dump"
  log "backup of PostgreSQL before deploying -> $backup"
  (umask 077; dc exec -T postgres sh -c 'pg_dump --format=custom -U "$POSTGRES_USER" -d "$POSTGRES_DB"' > "$backup")
  [ -s "$backup" ] || die "backup is empty"
fi

log "building images tagged $revision"
dc build
log "starting the stack (migrations run before Go/Rust; waits for health checks)"
dc up -d --no-build --wait --wait-timeout 300
smoke "$revision"
printf '%s %s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$revision" "$backup" >> "$STATE_DIR/history"
log "deployment of $revision complete; history in $STATE_DIR/history"
