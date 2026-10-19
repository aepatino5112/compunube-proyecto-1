# F54 - Settlement end to end: Go -> Envoy -> Rust

Reproducible evidence that a persisted Go `RaceResult` is credited exactly once by the Rust Player/Profile service through Envoy, that Go confirms its `match.settlement_delivery` rows, and that the pending queue drains by itself after a Rust outage.

- Code under test: `main` at `e413b5c` (F47 + F52 merged), nothing patched.
- Harness: [`scripts/validation/f54-settlement-e2e.sh`](../../scripts/validation/f54-settlement-e2e.sh) with the Compose override [`scripts/validation/compose.validation.yml`](../../scripts/validation/compose.validation.yml).
- Run: 2026-10-19 on macOS (Docker 29.6, Compose 5.3), three full runs plus one deliberate failing run. The numbers below come from the last passing run unless noted.

## How to reproduce

```bash
scripts/validation/f54-settlement-e2e.sh
```

Host tools: `docker` (Compose v2), `curl`, `jq`, `grpcurl`. The script builds the Rust and Go images from the working tree (tagged `compunube-validation-{rust,go}:dev`, so a developer's `compunube-player-profile-service:dev` is never overwritten), starts an isolated Compose project (`compunube-f54`, host ports 55454 / 58054 / 55054 / 59054, all overridable with `F54_*` variables, see the script header), applies migrations `0001` and `0002` with `database/scripts/migrate.sh`, runs the scenarios, prints `PASS`/`FAIL` per check and ends with `RESULT: PASS` (exit 0) or `RESULT: FAIL` (exit 1). An `EXIT` trap always runs `docker compose down -v --remove-orphans`; the same command runs first, so a stale project from an interrupted run is cleaned. `F54_REMOVE_IMAGES=1` also removes the two validation images. No secrets are printed or stored (the DB credentials are the public Compose defaults and never echoed).

Idempotent teardown was shown by running the script three times in a row (the second run started after a half-created stale `compunube-f54` project): each run ended with `project compunube-f54 removed (containers, network, volumes)` and `docker ps -a / volume ls / network ls` filtered by the project name were empty afterwards. A run with `F54_DRAIN_TIMEOUT=2` failed on purpose: `passed: 33 failed: 7`, `RESULT: FAIL`, exit 1, and the teardown still ran.

## Test-harness fixture (explicit)

A real race needs two to four human WebSocket players, which this harness does not drive. **The harness INSERTs rows into `match.rooms`, `match.races`, `match.race_participants` and `match.settlement_delivery (state='pending')`**, exactly the rows `matchstore.Postgres.Save` persists for a `RaceResult` (same columns, outcome rules and credited <= collected). From there everything is the real code: the Go settlement coordinator claims the rows (`ClaimDue`), calls `SettleRace` through the real gRPC adapter and the resilient port to `envoy:50051`, and `Confirm`s the rows. The Rust service never reads or writes `match.*`. Two scenarios additionally manipulate durable `match.*` rows from the harness to reproduce situations that cannot be driven from outside (S2: reset a delivery to `pending`, which is the state after Go crashes between Rust's commit and its own confirmation; S3: alter `credited_plastic` 30 -> 29 so Go sends a different payload under the same key). Nothing in the Go or Rust code, the proto, Compose, Envoy or CI is changed.

## Scenarios and observed results

All 39 checks passed. Selected observations:

### S1 - Happy path (race of 4 + race of 2)

| Player | Outcome | Collected | Credited by Go | Rust profile after (coins plastic metal revision) |
| --- | --- | --- | --- | --- |
| A (real Go session) | finished, rank 1 | 30 / 12 | 30 / 12 | `0 30 12 2` (read through Go `GET /v1/profile`) |
| B | finished, rank 2 | 10 / 4 | 10 / 4 | `0 10 4 2` |
| F | finished, rank 1 | 6 / 2 | 6 / 2 | `0 6 2 2` |
| C | dnf | 9 / 3 | 0 / 0 | `0 0 0 1` |
| D | disqualified | 7 / 2 | 0 / 0 | `0 0 0 1` |
| E | left | 5 / 1 | 0 / 0 | `0 0 0 1` |

All six deliveries ended `confirmed|attempt_count=1|last_error=-|confirmed_at set` in 1 s from the fixture insert. `player.settlements` holds the credited amounts for the finishers and `0|0` rows for C, D and E (revision untouched, as designed). Rust's own log shows `1 applied::replayed=false` for A.

### S2 - Same settlement again

With A's race deliveries reset to `pending`, Go resent the same key: `confirmed|attempt_count=2`, balance and revision unchanged (`0 30 12 2`), still one `player.settlements` row, Rust log `1 applied replayed=false; 1 applied replayed=true`. A direct `grpcurl` through Envoy returned `{"replayed":true,"plastic":"30","metal":"12","rev":"2"}`.

### S3 - Same key, different payload

Go sent `credited_plastic=29` for A's key: Go recorded the deterministic rejection (`failed|attempt_count=3|last_error_code=CONFLICT`), A's balance did not move, the other three participants stayed `confirmed`, Rust logged `rejected:CONFLICT`, and a direct `grpcurl` answered `SETTLEMENT_REJECTION_CONFLICT`.

### S4 - Rust outage, circuit breaker and autonomous recovery (J79/J81)

| Event | Observation |
| --- | --- |
| Both Rust replicas stopped | Envoy reported 0 healthy hosts after 5 s |
| Fixture race inserted (G finished 15/5, H dnf) | Deliveries stayed `pending` (never `failed`), `last_error_code=UNAVAILABLE`, no `player.settlements` row for G |
| >= 6 attempts in 6 s | Circuit opened after five consecutive failures |
| 10 user reads (`GET /v1/profile`) while open | all 503 `PROFILE_UNAVAILABLE`, none slower than 200 ms, **0 new Envoy requests** (`http.player_profile_grpc.downstream_rq_total` 25 -> 25), proving fast rejection inside Go |
| `docker compose start player-profile-rust-1` (only one replica), no traffic sent to Go from here | Envoy re-admitted it after 3 s |
| Autonomous drain | Go's coordinator (backoff, half-open `GetProfile` probe from J81, then `SettleRace`) confirmed all deliveries 78 s after the restore in this run (44 s and 58 s in the two earlier runs; the spread is the bounded exponential backoff with jitter, capped at 60 s) |
| Result | G `0 15 5 2`, exactly one `player.settlements` row, Rust logged one `applied replayed=false` for G (no double credit, attempt_count 8 in the last run), H `0 0 0 1` |

### S5 - Rust never writes `match.*`

`pg_stat_user_tables` counters (inserts/updates/deletes) for `match.*` were identical before and after Rust-only gRPC traffic (settle, exchange, buy, appearance through Envoy, Go idle): `race_participants=8/1/0 races=3/0/0 rooms=3/0/0 settlement_delivery=8/55/0` in run 1, unchanged; and `player.settlements` did record the Rust-only settlement. `rg -n 'match\.' services/player-profile-service-rust/src` finds nothing (also enforced by `tests/architecture.rs`).

## Raw output of the last passing run (abridged)

```text
=== S1 happy path: persisted RaceResult -> Go coordinator -> Envoy -> Rust -> confirmed ===
  ok after 1s: all deliveries of f54-race-ok-... confirmed by Go
time from fixture insert to confirmed: 1s
PASS  A credited exactly 30/12 (Rust via Go HTTP: coins plastic metal revision) (= 0 30 12 2)
PASS  C (dnf) credited 0 and revision untouched (= 0 0 0 1)
=== S2 replay ===
PASS  delivery A re-sent (attempt_count 2) and confirmed (= confirmed|2|-|t)
PASS  Rust resolved A once as applied and once as replayed (= 1 applied::replayed=false;1 applied::replayed=true;)
=== S3 conflict ===
PASS  Go delivery A (state|attempts|last_error|confirmed_at set) (= failed|3|CONFLICT|f)
PASS  direct grpcurl through Envoy with the conflicting payload (= SETTLEMENT_REJECTION_CONFLICT)
=== S4 outage ===
PASS  deliveries stay pending (never failed) during the outage (= pending)
PASS  circuit breaker open: those 10 reads produced 0 Envoy requests (before=25 after=25) (= 25)
  ok after 75s (78s after restore): J81 autonomous recovery: all deliveries of f54-race-outage-... confirmed
PASS  Rust applied G exactly once (no double credit) (= 1)
=== teardown ===
project compunube-f54 removed (containers, network, volumes)
elapsed: 123s  passed: 39  failed: 0
RESULT: PASS
```

## Limits

- No real WebSocket race is played; the `RaceResult` persistence is simulated by the harness fixture described above. Race simulation correctness is covered by the Go tests, not by this card.
- The circuit state is not exposed by Go (no endpoint or metric), so its opening is inferred from the Envoy request counter staying flat while attempts and user reads continue.
- Recovery time depends on the coordinator's jittered backoff and the 10 s open window, so it varies between roughly 40 s and 80 s; the script waits up to `F54_DRAIN_TIMEOUT` (180 s).
- The script needs `grpcurl` and `jq` on the host; CI integration is not changed by this card.
