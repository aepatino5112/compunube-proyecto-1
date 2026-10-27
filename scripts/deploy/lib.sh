# Shared helpers for deploy.sh and rollback.sh (H66). Sourced, not executed.
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$ROOT"
ENV_FILE=${COMPUNUBE_ENV_FILE:-.env}
STATE_DIR=${COMPUNUBE_DEPLOY_DIR:-.deploy}
SECRETS="POSTGRES_PASSWORD MATCH_DB_PASSWORD PLAYER_DB_PASSWORD MONITOR_DB_PASSWORD GRAFANA_ADMIN_PASSWORD"

die() { echo "deploy: $*" >&2; exit 1; }
log() { echo "[$(date -u +%H:%M:%S)] $*"; }
dc() { docker compose --env-file "$ENV_FILE" "$@"; }

# Value from the environment first, then the env file; never printed.
setting() {
  local key=$1 default=${2:-}
  if [ -n "${!key:-}" ]; then printf '%s' "${!key}"; return; fi
  local line
  line=$(grep -E "^${key}=" "$ENV_FILE" 2>/dev/null | tail -n 1 || true)
  printf '%s' "${line#*=}" | grep . || printf '%s' "$default"
}

preflight() {
  command -v docker >/dev/null || die "docker is required"
  docker compose version >/dev/null || die "Docker Compose v2 is required"
  [ -f "$ENV_FILE" ] || die "missing $ENV_FILE (copy .env.example and fill the secrets; it is not versioned)"
  # A ZIP download (as in the lab) has no Git metadata to check against.
  if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    git check-ignore -q "$ENV_FILE" || [ "$ENV_FILE" != ".env" ] || die ".env must stay out of Git"
  fi
  local key
  for key in $SECRETS; do
    [ -n "$(setting "$key")" ] || die "$key is empty in $ENV_FILE"
  done
  [ "$(setting GRAFANA_ADMIN_PASSWORD)" != admin ] || die "GRAFANA_ADMIN_PASSWORD must not be 'admin'"
  dc config --quiet || die "docker compose config failed"
}

revision_of() {
  local id
  id=$(dc ps -q "$1")
  [ -n "$id" ] || { echo "not-running"; return; }
  docker inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$(docker inspect -f '{{.Image}}' "$id")"
}

smoke() {
  local expected=$1 go_port envoy_port healthy service
  go_port=$(setting GO_HTTP_PORT 8080)
  envoy_port=$(setting ENVOY_ADMIN_PORT 9901)
  log "smoke: Go liveness/readiness on :$go_port"
  curl -fsS --retry 30 --retry-delay 2 --retry-all-errors --max-time 5 "http://127.0.0.1:$go_port/healthz" >/dev/null
  curl -fsS --retry 30 --retry-delay 2 --retry-all-errors --max-time 5 "http://127.0.0.1:$go_port/readyz" >/dev/null
  log "smoke: Envoy sees both Rust replicas healthy"
  for _ in $(seq 1 45); do
    healthy=$(curl -fsS "http://127.0.0.1:$envoy_port/clusters" | grep -Ec 'player_profile_cluster::.*::health_flags::healthy$' || true)
    [ "$healthy" -eq 2 ] && break
    sleep 2
  done
  [ "$healthy" -eq 2 ] || die "Envoy reports $healthy healthy Rust replicas, expected 2"
  log "smoke: public session endpoint"
  curl -fsS -X POST "http://127.0.0.1:$go_port/v1/sessions" -o /dev/null
  for service in match-service-go player-profile-rust-1 player-profile-rust-2; do
    [ "$(revision_of "$service")" = "$expected" ] || die "$service runs revision $(revision_of "$service"), expected $expected"
  done
  log "version verified: match-service-go, player-profile-rust-1 and -2 run $expected"
}
