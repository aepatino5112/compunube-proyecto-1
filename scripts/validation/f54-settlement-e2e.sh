#!/usr/bin/env bash
# F54 - Settlement end to end: Go -> Envoy -> Rust (SettleRace) -> Go confirmation.
#
# Reproducible validation against an ISOLATED Compose project. It never touches
# the default project or its volumes, and tears everything down on exit
# (`down -v`), also when a step fails or the script is interrupted.
#
#   scripts/validation/f54-settlement-e2e.sh
#
# Host requirements: docker (compose v2), curl, jq, grpcurl.
# Tunables (environment): F54_PROJECT, F54_POSTGRES_PORT, F54_GO_HTTP_PORT,
#   F54_ENVOY_GRPC_PORT, F54_ENVOY_ADMIN_PORT, F54_SKIP_BUILD=1 (reuse images),
#   F54_REMOVE_IMAGES=1 (also remove the images this script tags),
#   F54_DRAIN_TIMEOUT (seconds to wait for recovery, default 180).
#
# TEST-HARNESS FIXTURE (explicit): a real race needs 2-4 human WebSocket
# players. This harness does NOT drive one. It INSERTs into match.rooms,
# match.races, match.race_participants and match.settlement_delivery(pending)
# exactly what matchstore.Postgres.Save persists for a RaceResult. Everything
# after that is the real code: the Go settlement coordinator claims the rows,
# calls SettleRace through the real gRPC adapter -> Envoy -> Rust, and confirms
# the rows. Rust never touches match.*; only this harness and Go do.
set -uo pipefail

cd "$(dirname "$0")/../.." || exit 2

for key in POSTGRES_PASSWORD MATCH_DB_PASSWORD PLAYER_DB_PASSWORD MONITOR_DB_PASSWORD GRAFANA_ADMIN_PASSWORD; do
  if [ -z "${!key:-}" ]; then
    printf -v "$key" '%s' "$(openssl rand -hex 24)"
    export "$key"
  fi
done

PROJECT="${F54_PROJECT:-compunube-f54}"
export POSTGRES_PORT="${F54_POSTGRES_PORT:-55454}"
export GO_HTTP_PORT="${F54_GO_HTTP_PORT:-58054}"
export ENVOY_GRPC_PORT="${F54_ENVOY_GRPC_PORT:-55054}"
export ENVOY_ADMIN_PORT="${F54_ENVOY_ADMIN_PORT:-59054}"
DRAIN_TIMEOUT="${F54_DRAIN_TIMEOUT:-180}"

GO_URL="http://127.0.0.1:${GO_HTTP_PORT}"
ENVOY_ADDR="127.0.0.1:${ENVOY_GRPC_PORT}"
ENVOY_ADMIN="http://127.0.0.1:${ENVOY_ADMIN_PORT}"
SERVICE="compunube.player.v1.PlayerProfileService"
RUN_ID="$(date +%s)"

PASSED=0
FAILED=0
FAILURES=()
SCRIPT_START=$(date +%s)

dc() {
  docker compose -p "$PROJECT" -f compose.yml -f scripts/validation/compose.validation.yml "$@"
}
sql() { dc exec -T postgres psql -U compunube -d compunube -X -At -F '|' -v ON_ERROR_STOP=1 "$@"; }
grpc() { # grpc METHOD JSON [extra grpcurl flags]
  local method=$1 body=$2
  shift 2
  grpcurl -plaintext -import-path proto -proto player_profile.proto -d "$body" "$@" "$ENVOY_ADDR" "$SERVICE/$method"
}
log() { printf '%s\n' "$*"; }
step() { printf '\n=== %s ===\n' "$*"; }
pass() { PASSED=$((PASSED + 1)); printf 'PASS  %s\n' "$*"; }
fail() { FAILED=$((FAILED + 1)); FAILURES+=("$*"); printf 'FAIL  %s\n' "$*"; }
expect() { # expect DESCRIPTION EXPECTED ACTUAL
  if [ "$2" = "$3" ]; then pass "$1 (= $3)"; else fail "$1 (expected '$2', got '$3')"; fi
}

cleanup() {
  local code=$?
  step "teardown"
  dc down -v --remove-orphans >/dev/null 2>&1
  if [ -z "$(dc ps -aq 2>/dev/null)" ]; then log "project $PROJECT removed (containers, network, volumes)"; else log "WARNING: leftovers in $PROJECT"; fi
  if [ "${F54_REMOVE_IMAGES:-0}" = 1 ]; then
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

# wait_for DESCRIPTION TIMEOUT_SECONDS COMMAND...  (polls until COMMAND succeeds)
wait_for() {
  local desc=$1 timeout=$2 start
  shift 2
  start=$(date +%s)
  while ! "$@" >/dev/null 2>&1; do
    if [ $(($(date +%s) - start)) -ge "$timeout" ]; then
      fail "timeout (${timeout}s) waiting for: $desc"
      return 1
    fi
    sleep 0.5
  done
  log "  ok after $(($(date +%s) - start))s: $desc"
}

envoy_healthy_is() { [ "$(curl -s "$ENVOY_ADMIN/clusters" | grep -Ec 'player_profile_cluster::.*::health_flags::healthy' || true)" = "$1" ]; }
envoy_rq_total() { curl -s "$ENVOY_ADMIN/stats" | awk -F': ' '/^http\.player_profile_grpc\.downstream_rq_total:/ {print $2}'; }

new_session() { # sets SESSION_PLAYER / SESSION_TOKEN
  local body
  body=$(curl -s -X POST "$GO_URL/v1/sessions")
  SESSION_PLAYER=$(printf '%s' "$body" | jq -r .playerId)
  SESSION_TOKEN=$(printf '%s' "$body" | jq -r .token)
}
go_profile() { curl -s -H "Authorization: Bearer $2" "$GO_URL/v1/profile" | jq -r '[.coins,.plastic,.metal,.profileRevision] | join(" ")'; }
rust_profile() { # player id -> "coins plastic metal revision" read straight from Rust through Envoy
  grpc GetProfile "{\"player_id\":\"$1\"}" 2>/dev/null | jq -r '.profile | [(.coins // "0"),(.plastic // "0"),(.metal // "0"),.profileRevision] | join(" ")'
}
db_profile() { sql -c "SELECT coins,plastic,metal,profile_revision FROM player.profiles WHERE player_id='$1'" | tr '|' ' '; }

# fixture RACE ROOM "player|outcome|rank|finish_ms|collected_plastic|collected_metal|credited_plastic|credited_metal|reduce_choice" ...
fixture() {
  local race=$1 room=$2 line values="" p o rk fin cp cm crp crm rc
  shift 2
  for line in "$@"; do
    IFS='|' read -r p o rk fin cp cm crp crm rc <<<"$line"
    [ -z "$rk" ] && rk=NULL
    [ -z "$fin" ] && fin=NULL
    values="${values:+$values,}('$race','$p','$o',$rk,$fin,$cp,$cm,$crp,$crm,'$rc')"
  done
  sql -q <<SQL
INSERT INTO match.rooms(room_id,map_id) VALUES('$room','maracaibo') ON CONFLICT DO NOTHING;
INSERT INTO match.races(race_id,room_id,rules_version,course_version,started_at,ended_at)
  VALUES('$race','$room','rules-f54','course-f54',now()-interval '2 minutes',now()-interval '1 minute');
INSERT INTO match.race_participants(race_id,player_id,outcome,rank,finish_time_ms,collected_plastic,collected_metal,credited_plastic,credited_metal,reduce_choice) VALUES $values;
INSERT INTO match.settlement_delivery(race_id,player_id,state) SELECT race_id,player_id,'pending' FROM match.race_participants WHERE race_id='$race';
SQL
}
delivery_row() { sql -c "SELECT state,attempt_count,coalesce(last_error_code,'-'),(confirmed_at IS NOT NULL) FROM match.settlement_delivery WHERE race_id='$1' AND player_id='$2'"; }
race_states() { sql -c "SELECT string_agg(DISTINCT state,',') FROM match.settlement_delivery WHERE race_id='$1'"; }
all_confirmed() { [ "$(sql -c "SELECT count(*) FILTER (WHERE state<>'confirmed') FROM match.settlement_delivery WHERE race_id='$1'")" = 0 ]; }
settlements_rows() { sql -c "SELECT count(*) FROM player.settlements WHERE race_id='$1' AND player_id='$2'"; }
rust_log() { dc logs --no-log-prefix player-profile-rust-1 player-profile-rust-2 2>/dev/null; }
rust_settle_lines() { # race player -> count of "result:replayed" pairs from Rust's own log
  rust_log | jq -r --arg r "$1" --arg p "$2" 'select(.message=="settlement resolved" and .race_id==$r and .player_id==$p) | "\(.result):\(.code // ""):replayed=\(.replayed)"' 2>/dev/null | sort | uniq -c | sed 's/^ *//' | tr '\n' ';'
}

step "prerequisites"
for tool in docker curl jq grpcurl; do
  if command -v "$tool" >/dev/null 2>&1; then log "found $tool"; else log "missing required tool: $tool"; exit 2; fi
done
docker compose version >/dev/null 2>&1 || { log "docker compose v2 is required"; exit 2; }
log "project=$PROJECT ports: postgres=$POSTGRES_PORT go=$GO_HTTP_PORT envoy=$ENVOY_GRPC_PORT admin=$ENVOY_ADMIN_PORT"

step "bring-up (isolated Compose project, idempotent: stale project removed first)"
dc down -v --remove-orphans >/dev/null 2>&1
if [ "${F54_SKIP_BUILD:-0}" != 1 ]; then
  dc build player-profile-rust-1 match-service-go >/dev/null 2>&1 || { log "image build failed"; exit 1; }
fi
dc up -d --no-build --wait --wait-timeout 120 postgres >/dev/null 2>&1 || { log "postgres did not become healthy"; exit 1; }
dc exec -T postgres sh -c 'export PGPASSWORD="$POSTGRES_PASSWORD"; export DATABASE_URL="postgresql://$POSTGRES_USER@127.0.0.1:5432/$POSTGRES_DB"; sh /opt/compunube-database/scripts/migrate.sh' >/dev/null 2>&1 \
  && log "migrations 0001 + 0002 applied" || { log "migration failed"; exit 1; }
dc up -d --no-build --wait --wait-timeout 180 player-profile-rust-1 player-profile-rust-2 envoy match-service-go >/dev/null 2>&1 || { log "stack did not become healthy"; exit 1; }
wait_for "Envoy sees 2 healthy Rust replicas" 90 envoy_healthy_is 2 || exit 1
expect "Go configured only with the Envoy address" "PLAYER_PROFILE_GRPC_ADDR=envoy:50051" "$(dc exec -T match-service-go env | grep '^PLAYER_PROFILE_GRPC_ADDR=')"

# ---------------------------------------------------------------------------
step "S1 happy path: persisted RaceResult -> Go coordinator -> Envoy -> Rust -> confirmed"
new_session; A=$SESSION_PLAYER; A_TOKEN=$SESSION_TOKEN
B="f54-b-$RUN_ID"; C="f54-c-$RUN_ID"; D="f54-d-$RUN_ID"; E="f54-e-$RUN_ID"; F="f54-f-$RUN_ID"
RACE_OK="f54-race-ok-$RUN_ID"; RACE_LEFT="f54-race-left-$RUN_ID"
log "A (Go session) finished 30 plastic/12 metal rank1; B finished 10/4 rank2; C dnf collected 9/3; D disqualified collected 7/2"
log "race 2: F finished 6/2 rank1; E left collected 5/1"
t_s1=$(date +%s)
fixture "$RACE_OK" "f54-room-ok-$RUN_ID" \
  "$A|finished|1|61000|30|12|30|12|reusable" "$B|finished|2|65000|10|4|10|4|reusable" \
  "$C|dnf|||9|3|0|0|disposable" "$D|disqualified|||7|2|0|0|disposable"
fixture "$RACE_LEFT" "f54-room-left-$RUN_ID" \
  "$F|finished|1|70000|6|2|6|2|reusable" "$E|left|||5|1|0|0|reusable"
wait_for "all deliveries of $RACE_OK confirmed by Go" 60 all_confirmed "$RACE_OK" || true
wait_for "all deliveries of $RACE_LEFT confirmed by Go" 60 all_confirmed "$RACE_LEFT" || true
log "time from fixture insert to confirmed: $(($(date +%s) - t_s1))s"
for pair in "$RACE_OK:$A" "$RACE_OK:$B" "$RACE_OK:$C" "$RACE_OK:$D" "$RACE_LEFT:$F" "$RACE_LEFT:$E"; do
  race=${pair%%:*}; pl=${pair#*:}
  expect "delivery $pl (state|attempts|last_error|confirmed_at set)" "confirmed|1|-|t" "$(delivery_row "$race" "$pl")"
done
expect "A credited exactly 30/12 (Rust via Go HTTP: coins plastic metal revision)" "0 30 12 2" "$(go_profile "$A" "$A_TOKEN")"
expect "B credited exactly 10/4" "0 10 4 2" "$(rust_profile "$B")"
expect "F credited exactly 6/2" "0 6 2 2" "$(rust_profile "$F")"
expect "C (dnf) credited 0 and revision untouched" "0 0 0 1" "$(rust_profile "$C")"
expect "D (disqualified) credited 0 and revision untouched" "0 0 0 1" "$(rust_profile "$D")"
expect "E (left) credited 0 and revision untouched" "0 0 0 1" "$(rust_profile "$E")"
expect "player.settlements row for A (credited_plastic|credited_metal|revision_after)" "30|12|2" "$(sql -c "SELECT credited_plastic,credited_metal,profile_revision_after FROM player.settlements WHERE race_id='$RACE_OK' AND player_id='$A'")"
expect "player.settlements rows for C/D/E credit zero" "0|0;0|0;0|0" "$(sql -c "SELECT credited_plastic,credited_metal FROM player.settlements WHERE (race_id,player_id) IN (('$RACE_OK','$C'),('$RACE_OK','$D'),('$RACE_LEFT','$E')) ORDER BY player_id" | paste -sd ';' -)"
log "Rust log (race|player): A -> $(rust_settle_lines "$RACE_OK" "$A")"
BALANCE_A=$(db_profile "$A")

# ---------------------------------------------------------------------------
step "S2 replay: the same settlement is sent again by Go (delivery reset to pending, as after a crash before confirm)"
sql -q -c "UPDATE match.settlement_delivery SET state='pending',confirmed_at=NULL,next_attempt_at=NULL WHERE race_id='$RACE_OK'"
wait_for "deliveries of $RACE_OK confirmed again" 60 all_confirmed "$RACE_OK" || true
expect "delivery A re-sent (attempt_count 2) and confirmed" "confirmed|2|-|t" "$(delivery_row "$RACE_OK" "$A")"
expect "A balance and revision unchanged (no extra credit)" "$BALANCE_A" "$(db_profile "$A")"
expect "exactly one player.settlements row for A" "1" "$(settlements_rows "$RACE_OK" "$A")"
expect "Rust resolved A once as applied and once as replayed" "1 applied::replayed=false;1 applied::replayed=true;" "$(rust_settle_lines "$RACE_OK" "$A")"
log "direct replay through Envoy:"
replay=$(grpc SettleRace "{\"race_id\":\"$RACE_OK\",\"player_id\":\"$A\",\"outcome\":\"RACE_OUTCOME_FINISHED\",\"credited_plastic\":30,\"credited_metal\":12}" | jq -c '{replayed:.success.replayed,plastic:.success.profile.plastic,metal:.success.profile.metal,rev:.success.profile.profileRevision}')
log "  $replay"
expect "direct replay: replayed=true, balance unchanged" '{"replayed":true,"plastic":"30","metal":"12","rev":"2"}' "$replay"

# ---------------------------------------------------------------------------
step "S3 same (race_id, player_id) with a different payload -> settlement CONFLICT"
log "harness alters A's durable credited_plastic 30 -> 29 (allowed by the DB CHECK) so Go sends a different payload under the same key"
sql -q -c "UPDATE match.race_participants SET credited_plastic=29 WHERE race_id='$RACE_OK' AND player_id='$A'" \
        -c "UPDATE match.settlement_delivery SET state='pending',confirmed_at=NULL,next_attempt_at=NULL WHERE race_id='$RACE_OK' AND player_id='$A'"
delivery_failed() { [ "$(delivery_row "$1" "$2" | cut -d'|' -f1)" = failed ]; }
wait_for "Go records the deterministic rejection (state failed)" 60 delivery_failed "$RACE_OK" "$A" || true
expect "Go delivery A (state|attempts|last_error|confirmed_at set)" "failed|3|CONFLICT|f" "$(delivery_row "$RACE_OK" "$A")"
expect "A balance still unchanged (conflicting payload credited nothing)" "$BALANCE_A" "$(db_profile "$A")"
log "Rust log for A: $(rust_settle_lines "$RACE_OK" "$A")"
conflict=$(grpc SettleRace "{\"race_id\":\"$RACE_OK\",\"player_id\":\"$A\",\"outcome\":\"RACE_OUTCOME_FINISHED\",\"credited_plastic\":29,\"credited_metal\":12}" | jq -r '.rejection.code')
expect "direct grpcurl through Envoy with the conflicting payload" "SETTLEMENT_REJECTION_CONFLICT" "$conflict"
expect "other participants of the race remain confirmed" "confirmed" "$(sql -c "SELECT string_agg(DISTINCT state,',') FROM match.settlement_delivery WHERE race_id='$RACE_OK' AND player_id<>'$A'")"

# ---------------------------------------------------------------------------
step "S4 Rust outage: circuit breaker, pending deliveries, J81 autonomous recovery, no double credit"
new_session; G=$SESSION_PLAYER; G_TOKEN=$SESSION_TOKEN
H="f54-h-$RUN_ID"; RACE_OUT="f54-race-outage-$RUN_ID"
log "stopping BOTH Rust replicas"
dc stop player-profile-rust-1 player-profile-rust-2 >/dev/null 2>&1
wait_for "Envoy sees 0 healthy Rust replicas" 60 envoy_healthy_is 0 || true
t_outage=$(date +%s)
fixture "$RACE_OUT" "f54-room-out-$RUN_ID" "$G|finished|1|60000|15|5|15|5|reusable" "$H|dnf|||4|1|0|0|disposable"
total_attempts() { sql -c "SELECT coalesce(sum(attempt_count),0) FROM match.settlement_delivery WHERE race_id='$RACE_OUT'"; }
attempts_at_least() { [ "$(total_attempts)" -ge "$1" ]; }
wait_for "Go made >= 6 delivery attempts while Rust is down" 90 attempts_at_least 6 || true
expect "deliveries stay pending (never failed) during the outage" "pending" "$(race_states "$RACE_OUT")"
expect "last_error_code of G is UNAVAILABLE" "UNAVAILABLE" "$(sql -c "SELECT last_error_code FROM match.settlement_delivery WHERE race_id='$RACE_OUT' AND player_id='$G'")"
expect "no player.settlements row exists yet for G" "0" "$(settlements_rows "$RACE_OUT" "$G")"
# Quiesce Envoy's counter (in-flight attempts finished) before measuring the breaker.
prev=-1; cur=$(envoy_rq_total)
for _ in $(seq 1 75); do
  [ "$prev" = "$cur" ] && break
  sleep 0.4; prev=$cur; cur=$(envoy_rq_total)
done
rq_before=$cur
not503=0; slowreads=0
for _ in 1 2 3 4 5 6 7 8 9 10; do
  out=$(curl -s -o /dev/null -w '%{http_code} %{time_total}' -H "Authorization: Bearer $G_TOKEN" "$GO_URL/v1/profile")
  [ "${out%% *}" = 503 ] || not503=$((not503 + 1))
  awk -v t="${out#* }" 'BEGIN{exit !(t > 0.2)}' && slowreads=$((slowreads + 1))
done
rq_after=$(envoy_rq_total)
expect "10 user reads during the outage: none answered other than 503 PROFILE_UNAVAILABLE" "0" "$not503"
expect "10 user reads during the outage: none slower than 200ms" "0" "$slowreads"
expect "circuit breaker open: those 10 reads produced 0 Envoy requests (before=$rq_before after=$rq_after)" "$rq_before" "$rq_after"
log "outage so far: $(($(date +%s) - t_outage))s, delivery attempts: $(total_attempts)"
log "restoring ONE replica (rust-1); no user traffic is sent to Go from here on"
t_restore=$(date +%s)
dc start player-profile-rust-1 >/dev/null 2>&1
wait_for "Envoy sees 1 healthy Rust replica" 60 envoy_healthy_is 1 || true
log "  Envoy re-admitted rust-1 after $(($(date +%s) - t_restore))s"
wait_for "J81 autonomous recovery: all deliveries of $RACE_OUT confirmed" "$DRAIN_TIMEOUT" all_confirmed "$RACE_OUT" || true
log "recovery time: $(($(date +%s) - t_restore))s after restore ($(($(date +%s) - t_outage))s after outage start)"
expect "G delivery confirmed (state|confirmed_at set)" "confirmed|t" "$(delivery_row "$RACE_OUT" "$G" | awk -F'|' '{print $1 "|" $4}')"
g_attempts=$(sql -c "SELECT attempt_count FROM match.settlement_delivery WHERE race_id='$RACE_OUT' AND player_id='$G'")
if [ "$g_attempts" -ge 5 ]; then pass "G needed retries across the outage (attempt_count=$g_attempts >= 5)"; else fail "G attempt_count=$g_attempts, expected >= 5 (outage not exercised)"; fi
expect "G credited exactly once: 15/5, revision 2" "0 15 5 2" "$(rust_profile "$G")"
expect "exactly one player.settlements row for G" "1" "$(settlements_rows "$RACE_OUT" "$G")"
expect "Rust applied G exactly once (no double credit)" "1" "$(rust_log | jq -r --arg r "$RACE_OUT" --arg p "$G" 'select(.message=="settlement resolved" and .race_id==$r and .player_id==$p and .result=="applied" and .replayed==false) | 1' | wc -l | tr -d ' ')"
expect "H (dnf) credited 0" "0 0 0 1" "$(rust_profile "$H")"
log "restoring second replica"
dc start player-profile-rust-2 >/dev/null 2>&1
wait_for "Envoy sees 2 healthy Rust replicas" 60 envoy_healthy_is 2 || true

# ---------------------------------------------------------------------------
step "S5 Rust never wrote match.*"
match_counters() { sql -c "SELECT string_agg(relname||'='||n_tup_ins||'/'||n_tup_upd||'/'||n_tup_del, ' ' ORDER BY relname) FROM pg_stat_user_tables WHERE schemaname='match'"; }
stable_match_counters() { # PostgreSQL flushes statistics asynchronously: sample until two readings agree
  local prev="" cur
  cur=$(match_counters)
  while [ "$prev" != "$cur" ]; do sleep 1; prev=$cur; cur=$(match_counters); done
  printf '%s' "$cur"
}
before=$(stable_match_counters)
log "match.* tuple counters (ins/upd/del) before Rust-only traffic: $before"
R="f54-rustonly-$RUN_ID"
grpc SettleRace "{\"race_id\":\"rustonly-$RUN_ID\",\"player_id\":\"$R\",\"outcome\":\"RACE_OUTCOME_FINISHED\",\"credited_plastic\":8,\"credited_metal\":2}" >/dev/null
grpc ExchangeMaterials "{\"player_id\":\"$R\",\"request_id\":\"ro-ex\",\"catalog_version\":\"online-v1\",\"material\":\"MATERIAL_PLASTIC\",\"amount\":8}" >/dev/null
grpc BuyItem "{\"player_id\":\"$R\",\"request_id\":\"ro-buy\",\"catalog_version\":\"online-v1\",\"item_id\":\"brisa\"}" >/dev/null
grpc SetAppearance "{\"player_id\":\"$R\",\"request_id\":\"ro-app\",\"catalog_version\":\"online-v1\",\"skin_id\":\"warm\",\"hair_color_id\":\"copper\"}" >/dev/null
after=$(stable_match_counters)
log "match.* tuple counters after:                                  $after"
expect "Rust-only gRPC traffic (settle, exchange, buy, appearance) changed no match.* row" "$before" "$after"
expect "while player.settlements did record the Rust-only settlement" "1" "$(sql -c "SELECT count(*) FROM player.settlements WHERE player_id='$R'")"
if grep -rn 'match\.' services/player-profile-service-rust/src >/dev/null 2>&1; then fail "Rust source references match.*"; else pass "no 'match.' reference under services/player-profile-service-rust/src"; fi
