#!/usr/bin/env bash
# J78 - Envoy load balancing and failover between two Rust Player/Profile replicas.
#
# Reproducible validation against an ISOLATED Compose project. It never touches
# the default project or its volumes, and tears everything down on exit
# (`down -v`), also when a step fails or the script is interrupted.
#
#   scripts/validation/j78-rust-failover.sh
#
# Host requirements: docker (compose v2), curl, jq, grpcurl.
# Tunables (environment): J78_PROJECT, J78_POSTGRES_PORT, J78_GO_HTTP_PORT,
#   J78_ENVOY_GRPC_PORT, J78_ENVOY_ADMIN_PORT, J78_SKIP_BUILD=1 (reuse images),
#   J78_REMOVE_IMAGES=1 (also remove the images this script tags),
#   J78_REQUESTS (requests per distribution check, default 100),
#   J78_EXCLUDE_BUDGET (seconds Envoy may take to exclude a killed replica,
#   default 20), J78_REINCORPORATE_BUDGET (seconds to re-admit a restored replica,
#   default 30), J78_BREAKER_CLOSE_BUDGET (seconds for Go's circuit breaker to
#   let traffic flow after a replica is back, default 60).
#
# What it shows (one run, observed numbers printed as it goes):
#   1. Go only knows `envoy:50051`; the Envoy cluster is ROUND_ROBIN over both
#      replicas with the gRPC health check `player_profile`.
#   2. Load spreads over rust-1 and rust-2 (per-instance Rust metrics and Envoy
#      per-host counters).
#   3. Hard kill of rust-1 (SIGKILL): time until Envoy excludes it and what the
#      client sees in that window; rust-2 keeps serving.
#   4. Hard kill of rust-2 too: Go keeps living (healthz/readyz), profile reads
#      degrade to 503 PROFILE_UNAVAILABLE and the Go circuit breaker opens
#      (Envoy request counter stops growing, fast failures).
#   5. Restore rust-1: SERVING, Envoy re-admission and Go breaker closing times
#      without any action on Go; restore rust-2 and balanced traffic again.
#   6. Readiness is tied to PostgreSQL: with the database stopped the replicas
#      report NOT_SERVING (Docker's TCP healthcheck still says healthy) and a
#      restarted replica only becomes SERVING after the database is back.
#   Per-INSTANCE_ID logs and the Envoy cluster state are printed at each phase.
#
# Nothing in Go, Rust, proto, Envoy, Compose, monitoring, DB or CI is changed;
# the harness only starts/kills containers of its own isolated project. Go is
# not given any replica address: every call goes through Envoy.
set -uo pipefail

cd "$(dirname "$0")/../.." || exit 2

for key in POSTGRES_PASSWORD MATCH_DB_PASSWORD PLAYER_DB_PASSWORD MONITOR_DB_PASSWORD GRAFANA_ADMIN_PASSWORD; do
  if [ -z "${!key:-}" ]; then
    printf -v "$key" '%s' "$(openssl rand -hex 24)"
    export "$key"
  fi
done

PROJECT="${J78_PROJECT:-compunube-j78}"
export POSTGRES_PORT="${J78_POSTGRES_PORT:-55478}"
export GO_HTTP_PORT="${J78_GO_HTTP_PORT:-58078}"
export ENVOY_GRPC_PORT="${J78_ENVOY_GRPC_PORT:-55078}"
export ENVOY_ADMIN_PORT="${J78_ENVOY_ADMIN_PORT:-59078}"
REQUESTS="${J78_REQUESTS:-100}"
EXCLUDE_BUDGET="${J78_EXCLUDE_BUDGET:-20}"
REINCORPORATE_BUDGET="${J78_REINCORPORATE_BUDGET:-30}"
BREAKER_CLOSE_BUDGET="${J78_BREAKER_CLOSE_BUDGET:-60}"

GO_URL="http://127.0.0.1:${GO_HTTP_PORT}"
ENVOY_ADDR="127.0.0.1:${ENVOY_GRPC_PORT}"
ENVOY_ADMIN="http://127.0.0.1:${ENVOY_ADMIN_PORT}"
SERVICE="compunube.player.v1.PlayerProfileService"
RUN_ID="$(date +%s)"
PLAYER="j78-p-$RUN_ID"
R1=player-profile-rust-1
R2=player-profile-rust-2

GO_BODY="$(mktemp)"
PASSED=0
FAILED=0
FAILURES=()
SCRIPT_START=$(date +%s)

dc() {
  docker compose -p "$PROJECT" -f compose.yml -f scripts/validation/compose.validation.yml "$@"
}
log() { printf '%s\n' "$*"; }
step() { printf '\n=== %s ===\n' "$*"; }
pass() { PASSED=$((PASSED + 1)); printf 'PASS  %s\n' "$*"; }
fail() { FAILED=$((FAILED + 1)); FAILURES+=("$*"); printf 'FAIL  %s\n' "$*"; }
finding() { printf 'FINDING  %s\n' "$*"; }
expect() { # expect DESCRIPTION EXPECTED ACTUAL
  if [ "$2" = "$3" ]; then pass "$1 (= $3)"; else fail "$1 (expected '$2', got '$3')"; fi
}
# within DESCRIPTION VALUE MAX (unit-less, integers)
within() { if [ "$2" -le "$3" ]; then pass "$1 ($2 <= $3)"; else fail "$1 ($2 > $3)"; fi; }

cleanup() {
  local code=$?
  rm -f "$GO_BODY"
  step "teardown"
  dc down -v --remove-orphans >/dev/null 2>&1
  if [ -z "$(dc ps -aq 2>/dev/null)" ]; then log "project $PROJECT removed (containers, network, volumes)"; else log "WARNING: leftovers in $PROJECT"; fi
  if [ "${J78_REMOVE_IMAGES:-0}" = 1 ]; then
    docker rmi compunube-validation-rust:dev compunube-validation-go:dev >/dev/null 2>&1 && log "removed validation images"
  fi
  step "summary"
  log "elapsed: $(($(date +%s) - SCRIPT_START))s  passed: $PASSED  failed: $FAILED"
  if [ "$FAILED" -gt 0 ] || [ "$code" -ne 0 ]; then
    for f in "${FAILURES[@]:-}"; do [ -n "$f" ] && log "  - $f"; done
    log "RESULT: FAIL"
    exit "$([ "$code" -ne 0 ] && echo "$code" || echo 1)"
  fi
  log "RESULT: PASS"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

# --- time helpers (milliseconds; falls back to whole seconds where `date +%N` is unsupported)
now_ms() {
  local t
  t=$(date +%s%N)
  case $t in
    *[!0-9]*) echo $(($(date +%s) * 1000)) ;;
    *) echo $((t / 1000000)) ;;
  esac
}
since_ms() { echo $(($(now_ms) - $1)); }
fmt_s() { awk -v ms="$1" 'BEGIN{printf "%.1fs", ms/1000}'; }
utc_now() { date -u +%Y-%m-%dT%H:%M:%SZ; }

# wait_until DESCRIPTION TIMEOUT_SECONDS COMMAND...  -> sets WAITED_MS; returns 1 on timeout
WAITED_MS=0
wait_until() {
  local desc=$1 timeout=$2 start
  shift 2
  start=$(now_ms)
  while ! "$@" >/dev/null 2>&1; do
    if [ "$(since_ms "$start")" -ge $((timeout * 1000)) ]; then
      WAITED_MS=$(since_ms "$start")
      fail "timeout (${timeout}s) waiting for: $desc"
      return 1
    fi
    sleep 0.2
  done
  WAITED_MS=$(since_ms "$start")
  log "  ok after $(fmt_s "$WAITED_MS"): $desc"
}

# --- Envoy views
# Envoy prints `healthy` in health_flags only for a host with NO flag at all. A host that Docker's DNS
# stopped resolving is kept in rotation (`/pending_dynamic_removal`) until the active health check fails,
# so "in rotation" means: no failed_active_hc flag.
host_flags() { curl -s "$ENVOY_ADMIN/clusters" | awk -F'::' '$1 == "player_profile_cluster" && $3 == "health_flags" && $2 ~ /:[0-9]+$/ { print $2 " " $4 }'; }
healthy_count() { host_flags | grep -c ' healthy$' || true; }
host_count() { host_flags | wc -l | tr -d ' '; }
hosts_is() { [ "$(host_count)" = "$1" ]; }
in_rotation() { host_flags | grep -vc 'failed_active_hc' || true; }
rotation_is() { [ "$(in_rotation)" = "$1" ]; }
rotation_le() { [ "$(in_rotation)" -le "$1" ]; }
healthy_is() { [ "$(healthy_count)" = "$1" ]; }
hc_attempts() { curl -s "$ENVOY_ADMIN/stats" | awk -F': ' '/^cluster\.player_profile_cluster\.health_check\.attempt:/ {print $2+0}'; }
envoy_rq_total() { curl -s "$ENVOY_ADMIN/stats" | awk -F': ' '/^http\.player_profile_grpc\.downstream_rq_total:/ {print $2}'; }
# container addresses are remembered so a killed replica can still be named in the cluster table
IP_R1=""; IP_R2=""
ip_of() { docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$(dc ps -aq "$1" 2>/dev/null | head -1)" 2>/dev/null; }
refresh_ips() {
  local a
  # a stopped container reports "invalid IP"; keep the last address seen while it was running
  a=$(ip_of $R1); case $a in *[!0-9.]* | "") ;; *) IP_R1=$a ;; esac
  a=$(ip_of $R2); case $a in *[!0-9.]* | "") ;; *) IP_R2=$a ;; esac
  return 0
}
# cluster_table: one line per upstream host known to Envoy, with the service name instead of the container address
cluster_table() {
  refresh_ips
  curl -s "$ENVOY_ADMIN/clusters" | awk -F'::' -v ip1="$IP_R1" -v ip2="$IP_R2" '
    $1 == "player_profile_cluster" && NF >= 4 && $2 ~ /:[0-9]+$/ {
      split($2, a, ":"); h = a[1]
      n = (ip1 != "" && h == ip1) ? "rust-1" : (ip2 != "" && h == ip2) ? "rust-2" : "unmapped(" h ")"
      seen[n] = 1
      if ($3 == "health_flags") flags[n] = $4
      if ($3 == "rq_total") rq[n] = $4
      if ($3 == "rq_error") err[n] = $4
      if ($3 == "cx_active") cx[n] = $4
    }
    END { c = 0; for (n in seen) c++; printf "  hosts=%d\n", c;
          for (n in seen) printf "  %-10s flags=%-34s rq_total=%s rq_error=%s cx_active=%s\n", n, flags[n], rq[n], err[n], cx[n] }' | sort
}
# envoy_host_rq HOSTNAME -> upstream request counter Envoy keeps for that replica (0 when unknown)
envoy_host_rq() {
  local ip=$IP_R1
  [ "$1" = "$R2" ] && ip=$IP_R2
  [ -n "$ip" ] || { echo 0; return; }
  curl -s "$ENVOY_ADMIN/clusters" | awk -F'::' -v ip="$ip" '$1 == "player_profile_cluster" { split($2, a, ":"); if (a[1] == ip && $3 == "rq_total") print $4 }' | head -1 | awk '{print $1+0}'
}

# --- Rust per-instance views (metrics port 9100 is internal; the image has `nc`)
rust_metrics() { dc exec -T "$1" sh -c "printf 'GET /metrics HTTP/1.0\r\n\r\n' | nc -w 2 127.0.0.1 9100" 2>/dev/null; }
rpc_count() { # service rpc -> requests that instance counted for that RPC since it started
  rust_metrics "$1" | awk -v rpc="$2" '/^player_profile_rpc_requests_total\{/ && index($0, "rpc=\"" rpc "\"") { s += $NF } END { print s + 0 }'
}
serving_gauge() { rust_metrics "$1" | awk '/^player_profile_health_serving\{/ { print $NF }' | head -1; }
gauge_is() { [ "$(serving_gauge "$1")" = "$2" ]; }
docker_health() { docker inspect -f '{{if .State.Running}}{{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}}{{else}}not-running{{end}}' "$(dc ps -aq "$1" | head -1)" 2>/dev/null; }

# inst_log SINCE: per-INSTANCE_ID view of what each replica logged since SINCE
inst_log() {
  local svc
  for svc in $R1 $R2; do
    dc logs --no-log-prefix --since "$1" "$svc" 2>/dev/null | jq -rRn --arg svc "$svc" '
      [inputs | fromjson?] as $l
      | ($l | map(select(.message == "rpc completed"))) as $rpc
      | "  [\($svc)] rpc completed: " + (if ($rpc | length) == 0 then "none" else ($rpc | group_by(.rpc + " " + .outcome + "/" + .code) | map("\(.[0].rpc) \(.[0].outcome)/\(.[0].code) x\(length)") | join("; ")) end),
        ($l[] | select(.message != "rpc completed" and (.message | test("starting player|SERVING|shutdown|listening"))) | "  [\($svc)] \(.timestamp[11:19]) \(.message)" + (if .reason then " (" + .reason + ")" else "" end))'
  done
}

# --- clients
probe() { # one GetProfile through Envoy -> sets PROBE_RES (OK | FAIL:<grpc code>) and PROBE_MS
  local t0 out
  t0=$(now_ms)
  out=$(grpcurl -plaintext -max-time 3 -import-path proto -proto player_profile.proto -d "{\"player_id\":\"$PLAYER\"}" "$ENVOY_ADDR" "$SERVICE/GetProfile" 2>&1)
  PROBE_MS=$(($(now_ms) - t0))
  if printf '%s' "$out" | jq -e '.profile' >/dev/null 2>&1; then
    PROBE_RES=OK
  else
    PROBE_RES="FAIL:$(printf '%s' "$out" | sed -n 's/^ *Code: *//p' | head -1)"
  fi
}
go_status() { curl -s -o /dev/null -w '%{http_code}' --max-time 3 "$GO_URL$1"; }
go_read() { # one authenticated profile read through Go -> sets GO_CODE, GO_MS, GO_ERR
  local out
  out=$(curl -s -o "$GO_BODY" -w '%{http_code} %{time_total}' --max-time 5 -H "Authorization: Bearer $SESSION_TOKEN" "$GO_URL/v1/profile")
  GO_CODE=${out%% *}
  GO_MS=$(awk -v t="${out#* }" 'BEGIN{printf "%d", t*1000}')
  GO_ERR=$(jq -r '.error.code // .code // ""' "$GO_BODY" 2>/dev/null)
}

# distribution N -> sets D_R1 D_R2 (Rust per-instance GetProfile counters) and E_R1 E_R2 (Envoy per-host counters)
distribution() {
  local n=$1 i b1 b2 a1 a2 eb1 eb2 ea1 ea2 fails=0
  b1=$(rpc_count $R1 GetProfile); b2=$(rpc_count $R2 GetProfile)
  eb1=$(envoy_host_rq $R1); eb2=$(envoy_host_rq $R2)
  for i in $(seq 1 "$n"); do
    probe
    [ "$PROBE_RES" = OK ] || fails=$((fails + 1))
  done
  a1=$(rpc_count $R1 GetProfile); a2=$(rpc_count $R2 GetProfile)
  ea1=$(envoy_host_rq $R1); ea2=$(envoy_host_rq $R2)
  D_R1=$((a1 - b1)); D_R2=$((a2 - b2)); E_R1=$((ea1 - eb1)); E_R2=$((ea2 - eb2)); D_FAILS=$fails
}

step "prerequisites"
for tool in docker curl jq grpcurl; do
  if command -v "$tool" >/dev/null 2>&1; then log "found $tool"; else log "missing required tool: $tool"; exit 2; fi
done
docker compose version >/dev/null 2>&1 || { log "docker compose v2 is required"; exit 2; }
log "project=$PROJECT ports: postgres=$POSTGRES_PORT go=$GO_HTTP_PORT envoy=$ENVOY_GRPC_PORT admin=$ENVOY_ADMIN_PORT requests-per-check=$REQUESTS"
log "budgets: exclusion<=${EXCLUDE_BUDGET}s re-admission<=${REINCORPORATE_BUDGET}s breaker-close<=${BREAKER_CLOSE_BUDGET}s"

step "bring-up (isolated Compose project, idempotent: stale project removed first)"
dc down -v --remove-orphans >/dev/null 2>&1
if [ "${J78_SKIP_BUILD:-0}" != 1 ]; then
  dc build player-profile-rust-1 match-service-go >/dev/null 2>&1 || { log "image build failed"; exit 1; }
fi
dc up -d --no-build --wait --wait-timeout 120 postgres >/dev/null 2>&1 || { log "postgres did not become healthy"; exit 1; }
dc exec -T postgres sh -c 'export PGPASSWORD="$POSTGRES_PASSWORD"; export DATABASE_URL="postgresql://$POSTGRES_USER@127.0.0.1:5432/$POSTGRES_DB"; sh /opt/compunube-database/scripts/migrate.sh' >/dev/null 2>&1 \
  && log "migrations 0001 + 0002 applied" || { log "migration failed"; exit 1; }
dc up -d --no-build --wait --wait-timeout 180 $R1 $R2 envoy match-service-go >/dev/null 2>&1 || { log "stack did not become healthy"; exit 1; }
refresh_ips
wait_until "Envoy sees 2 healthy Rust replicas" 90 healthy_is 2 || exit 1
wait_until "both replicas report SERVING (gauge)" 30 gauge_is $R1 1 || exit 1
wait_until "rust-2 reports SERVING (gauge)" 30 gauge_is $R2 1 || exit 1
T_PHASE0=$(utc_now)
HC_ATTEMPTS0=$(hc_attempts)
T_FIRST_TRAFFIC=$(now_ms)
SESSION=$(curl -s -X POST "$GO_URL/v1/sessions")
SESSION_TOKEN=$(printf '%s' "$SESSION" | jq -r .token)
[ -n "$SESSION_TOKEN" ] && [ "$SESSION_TOKEN" != null ] || { log "could not open a Go session"; exit 1; }
go_read
expect "Go answers a profile read end to end before any failure (HTTP)" "200" "$GO_CODE"

# ---------------------------------------------------------------------------
step "S1 topology: Go only talks to Envoy; Envoy cluster is ROUND_ROBIN with gRPC health"
expect "Go is configured only with the Envoy address" "PLAYER_PROFILE_GRPC_ADDR=envoy:50051" "$(dc exec -T match-service-go env | grep '^PLAYER_PROFILE_GRPC_ADDR=')"
expect "Go environment holds no Rust replica name" "0" "$(dc exec -T match-service-go env | grep -c 'player-profile-rust' || true)"
CLUSTER_JSON=$(curl -s "$ENVOY_ADMIN/config_dump" | jq -c '[.configs[] | select(."@type" | endswith("ClustersConfigDump")) | .static_clusters[].cluster | select(.name == "player_profile_cluster")][0]')
# the JSON dump omits an enum at its proto default (ROUND_ROBIN = 0)
expect "cluster lb_policy" "ROUND_ROBIN" "$(printf '%s' "$CLUSTER_JSON" | jq -r '.lb_policy // "ROUND_ROBIN"')"
expect "infra/envoy/envoy.yaml declares it explicitly" "1" "$(grep -c 'lb_policy: ROUND_ROBIN' infra/envoy/envoy.yaml)"
expect "health check is the gRPC health service player_profile" "player_profile" "$(printf '%s' "$CLUSTER_JSON" | jq -r '.health_checks[0].grpc_health_check.service_name')"
log "Envoy health check config: $(printf '%s' "$CLUSTER_JSON" | jq -c '.health_checks[0] | {interval, timeout, unhealthy_threshold, healthy_threshold}')"
log "Envoy endpoints: $(printf '%s' "$CLUSTER_JSON" | jq -c '[.load_assignment.endpoints[].lb_endpoints[].endpoint.address.socket_address | "\(.address):\(.port_value)"]')"
if [ "$(printf '%s' "$CLUSTER_JSON" | jq 'has("outlier_detection")')" = true ]; then
  log "outlier_detection: configured"
else
  finding "no outlier_detection in player_profile_cluster: Envoy removes a failed replica ONLY through the active health check (and DNS), never from observed request failures"
fi
log "route: $(curl -s "$ENVOY_ADMIN/config_dump" | jq -c '[.configs[] | select(."@type" | endswith("ListenersConfigDump")) | .static_listeners[].listener.filter_chains[].filters[].typed_config.route_config.virtual_hosts[].routes[].route | {cluster, timeout, retry_policy: (.retry_policy // "none")}][0]')"
log "cluster state at rest:"
cluster_table
expect "Envoy healthy hosts" "2" "$(healthy_count)"

# ---------------------------------------------------------------------------
step "S2 distribution: $REQUESTS GetProfile requests through Envoy with both replicas healthy"
distribution "$REQUESTS"
log "rust-1 counted $D_R1, rust-2 counted $D_R2 (Rust instance_id metric); Envoy per-host rq_total delta: rust-1 $E_R1, rust-2 $E_R2; client failures: $D_FAILS"
expect "every request succeeded" "0" "$D_FAILS"
expect "the two replicas together served exactly $REQUESTS requests" "$REQUESTS" "$((D_R1 + D_R2))"
MIN_SHARE=$((REQUESTS * 35 / 100))
if [ "$D_R1" -ge "$MIN_SHARE" ] && [ "$D_R2" -ge "$MIN_SHARE" ]; then pass "both replicas received a real share (each >= 35%: $D_R1 / $D_R2)"; else fail "unbalanced distribution $D_R1 / $D_R2 (each must be >= $MIN_SHARE)"; fi
log "note: Envoy runs one ROUND_ROBIN cursor per worker thread, so the split is close to, not exactly, 50/50 when every request opens a new connection"
log "per-instance logs since start:"
inst_log "$T_PHASE0"

# ---------------------------------------------------------------------------
step "S2b Envoy health-check cadence (warm-up so that the failover timings below are steady-state)"
log "health_check.attempt at first traffic: $HC_ATTEMPTS0 (one per host at start-up)"
hc_round_done() { [ "$(hc_attempts)" -ge $((HC_ATTEMPTS0 + 2)) ]; }
log "sending light traffic until Envoy runs the next health-check round (cadence changes from no_traffic_interval to interval only after that round)"
while ! hc_round_done; do
  probe
  [ "$(since_ms "$T_FIRST_TRAFFIC")" -ge 100000 ] && break
  sleep 0.5
done
HC_FIRST_MS=$(since_ms "$T_FIRST_TRAFFIC")
if hc_round_done; then
  log "next health-check round $(fmt_s "$HC_FIRST_MS") after the first request"
  pass "Envoy completed a health-check round after traffic started (health_check.attempt $HC_ATTEMPTS0 -> $(hc_attempts))"
else
  fail "no further Envoy health-check round within 100s of the first request"
fi
if [ "$HC_FIRST_MS" -gt 10000 ]; then
  finding "the first health-check round after start-up came $(fmt_s "$HC_FIRST_MS") after the first request, consistent with Envoy's no_traffic_interval default (60s, not set in envoy.yaml): a replica that dies in the first minute after Envoy starts is detected up to ~60s later instead of ~3-8s"
fi

# ---------------------------------------------------------------------------
step "S3 hard kill of rust-1 (docker kill = SIGKILL): requests keep flowing through rust-2"
log "Docker restart policy is switched off for the killed replica only, so that the harness (not Docker) decides when it returns"
docker update --restart=no "$(dc ps -aq $R1)" >/dev/null 2>&1
T_S3=$(utc_now)
ok=0; bad=0; first_bad=""; last_bad=""; codes=""
T_KILL=$(now_ms)
docker kill "$(dc ps -aq $R1)" >/dev/null 2>&1
log "rust-1 killed; probing every ~100 ms until Envoy takes it out of rotation (failed_active_hc)"
EXCL_MS=""
while :; do
  probe
  rel=$(since_ms "$T_KILL")
  if [ "$PROBE_RES" = OK ]; then ok=$((ok + 1)); else bad=$((bad + 1)); [ -z "$first_bad" ] && first_bad=$rel; last_bad=$rel; codes="$codes ${PROBE_RES#FAIL:}"; fi
  if [ "$(in_rotation)" -le 1 ]; then EXCL_MS=$(since_ms "$T_KILL"); break; fi
  if [ "$rel" -ge $((EXCLUDE_BUDGET * 3000)) ]; then break; fi
  sleep 0.1
done
if [ -n "$EXCL_MS" ]; then
  log "Envoy took rust-1 out of rotation $(fmt_s "$EXCL_MS") after the kill"
  within "time to exclusion ${EXCL_MS}ms within budget ${EXCLUDE_BUDGET}s" "$EXCL_MS" $((EXCLUDE_BUDGET * 1000))
else
  fail "Envoy never took rust-1 out of rotation within $((EXCLUDE_BUDGET * 3))s"
fi
log "client view during the window (requests sent every ~100 ms): ok=$ok failed=$bad failed-codes=[${codes# }] first-failure=${first_bad:--}ms last-failure=${last_bad:--}ms after the kill"
if [ "$bad" -gt 0 ]; then
  finding "between the kill and the exclusion $bad of $((ok + bad)) requests failed (no retry policy, no outlier_detection): a replica that dies keeps receiving its round-robin share until the health check fails twice"
fi
log "cluster state right after exclusion:"
cluster_table
B2=$(rpc_count $R2 GetProfile)
fails=0
for _ in $(seq 1 30); do probe; [ "$PROBE_RES" = OK ] || { fails=$((fails + 1)); log "  failed request: $PROBE_RES"; }; done
A2=$(rpc_count $R2 GetProfile)
expect "after exclusion 30 of 30 requests succeed" "0" "$fails"
expect "after exclusion rust-2 served all 30" "30" "$((A2 - B2))"
go_read
expect "Go profile read through the surviving replica" "200" "$GO_CODE"
expect "Go /healthz and /readyz while one replica is down" "200 200" "$(go_status /healthz) $(go_status /readyz)"
log "per-instance logs for this phase:"
inst_log "$T_S3"

# ---------------------------------------------------------------------------
step "S4 hard kill of rust-2 as well: Go degrades, stays alive, circuit breaker opens"
docker update --restart=no "$(dc ps -aq $R2)" >/dev/null 2>&1
T_S4=$(utc_now)
T_KILL2=$(now_ms)
docker kill "$(dc ps -aq $R2)" >/dev/null 2>&1
log "rust-2 killed; polling until Envoy has 0 hosts in rotation"
wait_until "Envoy has 0 hosts in rotation" $((EXCLUDE_BUDGET * 2)) rotation_is 0 || true
EXCL2_MS=$(since_ms "$T_KILL2")
log "Envoy took the last replica out of rotation $(fmt_s "$EXCL2_MS") after its kill"
within "time to exclusion of the second replica ${EXCL2_MS}ms within budget ${EXCLUDE_BUDGET}s" "$EXCL2_MS" $((EXCLUDE_BUDGET * 1000))
log "cluster state with both replicas down:"
cluster_table
probe
log "direct call through Envoy right after exclusion (the cluster still lists the dead host, Envoy is in panic mode): $PROBE_RES in ${PROBE_MS}ms"
expect "Go liveness /healthz (does not depend on Rust)" "200" "$(go_status /healthz)"
expect "Go readiness /readyz (docs: Go keeps serving races)" "200" "$(go_status /readyz)"
log "profile reads through Go while both replicas are down (idx http error-code latency envoy-requests-added):"
prev=-1; cur=$(envoy_rq_total)
for _ in $(seq 1 25); do [ "$prev" = "$cur" ] && break; sleep 0.4; prev=$cur; cur=$(envoy_rq_total); done
non503=0; opened_after=""; sent_total=0; flat_streak=0; max_flat_ms=0
for i in $(seq 1 14); do
  before=$(envoy_rq_total)
  go_read
  sleep 0.3
  added=$(($(envoy_rq_total) - before))
  sent_total=$((sent_total + added))
  log "  read $i: $GO_CODE ${GO_ERR:--} ${GO_MS}ms envoy+$added"
  [ "$GO_CODE" = 503 ] && [ "$GO_ERR" = PROFILE_UNAVAILABLE ] || non503=$((non503 + 1))
  if [ "$added" -eq 0 ]; then
    flat_streak=$((flat_streak + 1)); [ -z "$opened_after" ] && opened_after=$((i - 1))
    [ "$GO_MS" -gt "$max_flat_ms" ] && max_flat_ms=$GO_MS
  else
    flat_streak=0; opened_after=""; max_flat_ms=0
  fi
done
expect "all 14 reads answered 503 PROFILE_UNAVAILABLE (never 5xx of another kind, never a fake profile)" "0" "$non503"
if [ -n "$opened_after" ] && [ "$flat_streak" -ge 5 ]; then
  pass "circuit breaker opened: $opened_after read(s) reached Envoy, then $flat_streak consecutive reads added 0 Envoy requests"
else
  fail "circuit breaker did not stay open (reads reaching Envoy: $sent_total, trailing flat streak: $flat_streak)"
fi
within "fast failure once open (slowest flat read ${max_flat_ms}ms <= 200ms)" "$max_flat_ms" 200
log "Envoy requests per read while the breaker was still closed: $sent_total in total (Go retries a failed read once; Envoy has no retry policy)"
wait_until "Envoy removed the dead hosts from the cluster (hosts=0)" 30 hosts_is 0 || true
log "dead hosts were already gone from the cluster when checked $(fmt_s "$(since_ms "$T_KILL2")") after the second kill (the earlier table, taken right after exclusion, still listed them)"
probe
log "direct call through Envoy with an empty cluster: $PROBE_RES in ${PROBE_MS}ms"
expect "Go /healthz after the degraded reads" "200" "$(go_status /healthz)"
expect "Go /readyz after the degraded reads" "200" "$(go_status /readyz)"
log "per-instance logs for this phase:"
inst_log "$T_S4"

# ---------------------------------------------------------------------------
step "S5 restore rust-1: SERVING, Envoy re-admission and breaker closing, no action on Go"
T_S5=$(utc_now)
T_START=$(now_ms)
dc start $R1 >/dev/null 2>&1
wait_until "rust-1 reports SERVING (gauge)" 60 gauge_is $R1 1 || true
SERVING_MS=$(since_ms "$T_START")
wait_until "Envoy re-admits rust-1 (1 host in rotation)" "$REINCORPORATE_BUDGET" rotation_is 1 || true
READMIT_MS=$(since_ms "$T_START")
log "rust-1: SERVING after $(fmt_s "$SERVING_MS"), re-admitted by Envoy after $(fmt_s "$READMIT_MS") from 'docker compose start'"
within "time to re-admission ${READMIT_MS}ms within budget ${REINCORPORATE_BUDGET}s" "$READMIT_MS" $((REINCORPORATE_BUDGET * 1000))
log "cluster state after re-admission:"
cluster_table
log "Go reads (normal calls only) until the breaker lets traffic through again:"
TG=$(now_ms); closed_ms=""; reads=0
while [ "$(since_ms "$TG")" -lt $((BREAKER_CLOSE_BUDGET * 1000)) ]; do
  go_read; reads=$((reads + 1))
  if [ "$GO_CODE" = 200 ]; then closed_ms=$(since_ms "$T_START"); break; fi
  sleep 1
done
if [ -n "$closed_ms" ]; then
  log "first 200 through Go $(fmt_s "$closed_ms") after the replica was started, $(fmt_s $((closed_ms - READMIT_MS))) after Envoy re-admitted it ($reads read(s); Go breaker open duration is 10s by default)"
  pass "Go circuit breaker closed on its own (no Go restart, no configuration change)"
else
  fail "Go kept answering 503 for ${BREAKER_CLOSE_BUDGET}s after rust-1 was healthy again"
fi
fails=0
for _ in $(seq 1 10); do probe; [ "$PROBE_RES" = OK ] || { fails=$((fails + 1)); log "  failed request: $PROBE_RES"; }; done
expect "10 of 10 direct requests through Envoy succeed with one replica" "0" "$fails"
log "per-instance logs for this phase:"
inst_log "$T_S5"

step "S6 restore rust-2: both replicas serve again and the balance is back"
T_S6=$(utc_now)
T_START2=$(now_ms)
dc start $R2 >/dev/null 2>&1
wait_until "Envoy has 2 hosts in rotation" "$REINCORPORATE_BUDGET" rotation_is 2 || true
READMIT2_MS=$(since_ms "$T_START2")
log "rust-2 re-admitted $(fmt_s "$READMIT2_MS") after 'docker compose start'"
within "time to re-admission of the second replica ${READMIT2_MS}ms within budget ${REINCORPORATE_BUDGET}s" "$READMIT2_MS" $((REINCORPORATE_BUDGET * 1000))
cluster_table
distribution "$REQUESTS"
log "rust-1 counted $D_R1, rust-2 counted $D_R2; Envoy per-host delta: rust-1 $E_R1, rust-2 $E_R2; client failures: $D_FAILS"
expect "every request succeeded" "0" "$D_FAILS"
expect "the two replicas together served exactly $REQUESTS requests" "$REQUESTS" "$((D_R1 + D_R2))"
if [ "$D_R1" -ge "$MIN_SHARE" ] && [ "$D_R2" -ge "$MIN_SHARE" ]; then pass "both replicas received a real share again (each >= 35%: $D_R1 / $D_R2)"; else fail "unbalanced distribution after restore $D_R1 / $D_R2"; fi
go_read
expect "Go profile read after full recovery" "200" "$GO_CODE"
log "per-instance logs for this phase:"
inst_log "$T_S6"

# ---------------------------------------------------------------------------
step "S7 readiness follows PostgreSQL: NOT_SERVING while the database is down, SERVING only after it returns"
T_S7=$(utc_now)
dc stop postgres >/dev/null 2>&1
wait_until "rust-1 reports NOT_SERVING (gauge)" 30 gauge_is $R1 0 || true
wait_until "rust-2 reports NOT_SERVING (gauge)" 30 gauge_is $R2 0 || true
wait_until "Envoy has 0 hosts in rotation" "$REINCORPORATE_BUDGET" rotation_is 0 || true
log "Docker health with PostgreSQL down: rust-1=$(docker_health $R1) rust-2=$(docker_health $R2) (TCP check only: it cannot see the database)"
dc restart $R1 >/dev/null 2>&1
sleep 8
expect "restarted rust-1 stays NOT_SERVING while PostgreSQL is down (8s later)" "0" "$(serving_gauge $R1)"
expect "Envoy keeps 0 hosts in rotation while PostgreSQL is down" "0" "$(in_rotation)"
log "Docker health of the restarted rust-1: $(docker_health $R1) (healthy by TCP although it serves nothing)"
T_DB=$(now_ms)
dc start postgres >/dev/null 2>&1
wait_until "rust-1 reports SERVING again" 60 gauge_is $R1 1 || true
log "rust-1 SERVING $(fmt_s "$(since_ms "$T_DB")") after PostgreSQL was started"
wait_until "rust-2 reports SERVING again" 60 gauge_is $R2 1 || true
wait_until "Envoy has 2 hosts in rotation" "$REINCORPORATE_BUDGET" rotation_is 2 || true
log "Envoy re-admitted both replicas $(fmt_s "$(since_ms "$T_DB")") after PostgreSQL was started"
probe
expect "request through Envoy after the database returned" "OK" "$PROBE_RES"
log "per-instance logs for this phase:"
inst_log "$T_S7"
log "final cluster state:"
cluster_table

step "Rust never touches match.*"
if grep -rn 'match\.' services/player-profile-service-rust/src >/dev/null 2>&1; then fail "Rust source references match.*"; else pass "no 'match.' reference under services/player-profile-service-rust/src"; fi
