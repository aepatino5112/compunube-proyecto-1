#!/usr/bin/env bash
# H66: return Go and Rust to a previously deployed image revision.
#   scripts/deploy/rollback.sh            # the revision deployed before the current one
#   scripts/deploy/rollback.sh <revision>
# Images are not rebuilt: the previous tag must still exist locally.
# Database migrations are forward-only. If the newer revision changed the
# schema, restore the backup recorded for it (destructive, explicit):
#   RESTORE_BACKUP=.deploy/backups/<file>.dump RESTORE_CONFIRM=YES scripts/deploy/rollback.sh <revision>
source "$(dirname "$0")/lib.sh"

[ -f "$STATE_DIR/history" ] || die "no deployment history in $STATE_DIR/history"
current=$(revision_of match-service-go)
target=${1:-$(awk -v cur="$current" '$2 != cur {rev=$2} END {print rev}' "$STATE_DIR/history")}
[ -n "$target" ] || die "no previous revision to roll back to"
for image in compunube-match-service compunube-player-profile-service; do
  docker image inspect "$image:$target" >/dev/null 2>&1 || die "image $image:$target is not available locally"
done
export COMPUNUBE_REVISION=$target COMPUNUBE_IMAGE_TAG=$target
preflight
log "rolling back from $current to $target"

if [ -n "${RESTORE_BACKUP:-}" ]; then
  [ "${RESTORE_CONFIRM:-}" = YES ] || die "set RESTORE_CONFIRM=YES to restore $RESTORE_BACKUP (destructive)"
  [ -s "$RESTORE_BACKUP" ] || die "backup $RESTORE_BACKUP not found"
  log "stopping Go and Rust, restoring $RESTORE_BACKUP"
  dc stop match-service-go player-profile-rust-1 player-profile-rust-2
  dc exec -T postgres sh -c 'pg_restore --exit-on-error --clean --if-exists -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < "$RESTORE_BACKUP"
fi

dc up -d --no-build --wait --wait-timeout 300 match-service-go player-profile-rust-1 player-profile-rust-2 envoy
smoke "$target"
printf '%s %s rollback-from-%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$target" "$current" >> "$STATE_DIR/history"
log "rollback to $target complete"
