# J78 - Envoy load balancing and failover between two Rust replicas

Reproducible evidence that Envoy spreads load over `player-profile-rust-1` and `player-profile-rust-2`, takes a killed replica out of rotation, that Go degrades without dying when both are gone and recovers by itself when one returns. Go is never given a replica address.

- Code under test: `main` at `3786362` (F47, F52, H67, F54, H62, I71 merged), nothing patched: no change in Go, Rust, proto, Envoy, Compose, monitoring, DB or CI.
- Harness: [`scripts/validation/j78-rust-failover.sh`](../../scripts/validation/j78-rust-failover.sh) with the existing Compose override [`scripts/validation/compose.validation.yml`](../../scripts/validation/compose.validation.yml) (retagged images, same as F54).
- Run: 2026-10-19 on macOS (Docker 29.6, Compose 5.3). Two clean passing runs (the second started on a stale half-created `compunube-j78` project), two earlier passing runs and one deliberate failing run. Numbers below come from the last two passing runs (C and D) unless noted; they agree within about 0.5 s.

## How to reproduce

```bash
scripts/validation/j78-rust-failover.sh
```

Host tools: `docker` (Compose v2), `curl`, `jq`, `grpcurl`. The script builds the Rust and Go images from the working tree (tagged `compunube-validation-{rust,go}:dev`), starts an isolated Compose project (`compunube-j78`, host ports 55478 / 58078 / 55078 / 59078), applies migrations `0001` and `0002` with `database/scripts/migrate.sh`, runs the phases, prints `PASS`/`FAIL`/`FINDING` per check and ends with `RESULT: PASS` (exit 0) or `RESULT: FAIL` (exit 1). An `EXIT` trap always runs `docker compose down -v --remove-orphans`; the same command runs first, so a stale project is cleaned. Tunables are listed in the script header (`J78_*`: project, ports, `J78_SKIP_BUILD=1`, `J78_REMOVE_IMAGES=1`, requests per check, and the three time budgets). A run takes about 130 s, 54 s of which are the Envoy health-check warm-up described in S2b. No secrets are printed (the DB credentials are the public Compose defaults and never echoed).

Idempotent teardown: run D started on a project with postgres, rust-1 and rust-2 already running and ended with `project compunube-j78 removed (containers, network, volumes)`; `docker ps -a`, `docker volume ls` and `docker network ls` filtered by `compunube-j78` were empty afterwards. A run with `J78_EXCLUDE_BUDGET=1` failed on purpose: `passed: 32 failed: 5`, `RESULT: FAIL`, exit 1, teardown still ran.

How the harness acts: it only starts, kills and restarts containers of its own project. `docker kill` is a real SIGKILL; for the killed replica only, `docker update --restart=no` stops Docker from restarting it by itself, so that the harness decides when it comes back. Per-instance numbers come from the Rust metric `player_profile_rpc_requests_total{instance_id=...}` (port 9100 is internal; read with `nc` inside the container) and from Envoy's per-host counters in `/clusters`.

## Phases and observed results

36 checks passed in each of the last runs.

### S1 - Topology

| Check | Observed |
| --- | --- |
| Go's only player-profile address | `PLAYER_PROFILE_GRPC_ADDR=envoy:50051`; no `player-profile-rust` string in Go's environment |
| Cluster `player_profile_cluster` | `ROUND_ROBIN` (explicit in `infra/envoy/envoy.yaml`; the JSON config dump omits the proto default), endpoints `player-profile-rust-1:50051`, `player-profile-rust-2:50051` |
| Health check | gRPC `service_name: player_profile`, `interval 3s`, `timeout 1s`, `unhealthy_threshold 2`, `healthy_threshold 1` |
| Route | `timeout 3s`, `retry_policy: none` |
| At rest | both hosts `flags=healthy` |

### S2 - Distribution (100 GetProfile requests through Envoy)

| Run | rust-1 | rust-2 | Envoy per-host `rq_total` delta | failures |
| --- | --- | --- | --- | --- |
| C | 49 | 51 | 49 / 51 | 0 |
| D | 49 | 51 | 49 / 51 | 0 |
| after restoring both (S6, C / D) | 59 / 60 | 41 / 40 | 59 / 41 and 60 / 40 | 0 |

Envoy keeps one ROUND_ROBIN cursor per worker thread, so with a new connection per request the split is near, not exactly, 50/50 (the check requires at least 35% each).

### S2b - Health-check cadence (finding, see below)

The first health-check round after Envoy starts came 53.7 s (run C) and 54.2 s (run D) after the first request. The script waits for it, then runs the failover timings in steady state.

### S3 - Hard kill of rust-1 (SIGKILL)

| Metric | Run C | Run D |
| --- | --- | --- |
| Time until Envoy takes rust-1 out of rotation (`failed_active_hc`) | 7.9 s | 7.9 s |
| Requests sent every ~100 ms in that window | 11 (5 ok, 6 failed `Unavailable`) | 11 (5 ok, 6 failed `Unavailable`) |
| First / last failure after the kill | 1.3 s / 7.9 s | 1.5 s / 7.9 s |
| After exclusion: 30 requests | 30 ok, all served by rust-2 (metric delta 30) | same |
| Go `GET /v1/profile`, `/healthz`, `/readyz` | 200, 200, 200 | same |

Envoy state right after exclusion: `rust-2 flags=healthy rq_total=99 cx_active=10`; rust-1 `flags=/failed_active_hc/pending_dynamic_removal/active_hc_timeout rq_error=6`. The 6 failures are exactly the requests Envoy sent to the dead replica (`rq_error=6`).

### S4 - Both replicas down

| Metric | Run C | Run D |
| --- | --- | --- |
| rust-2 killed; last replica out of rotation | 7.7 s | 7.2 s |
| Direct call through Envoy right after exclusion (cluster still lists the failed host) | `Unavailable` in 1019 ms | `Unavailable` in 1026 ms |
| Direct call once the dead hosts left the cluster (checked ~16 s after the kill) | `Unavailable` in 15 ms | `Unavailable` in 15 ms |
| Go `/healthz` and `/readyz` | 200 and 200 | 200 and 200 |

Go profile reads (`GET /v1/profile`) in run D: reads 1-5 answered `503 PROFILE_UNAVAILABLE` after 755 / 753 / 17 / 22 / 45 ms and added 1 / 1 / 2 / 2 / 2 Envoy requests (Go retries a failed read once; Envoy has no retry policy, so the same attempt is not retried twice); reads 6-14 answered `503 PROFILE_UNAVAILABLE` in 1-2 ms and **added 0 Envoy requests**: the Go circuit breaker (threshold 5 consecutive failed reads) is open. Go stayed alive (healthz/readyz 200) the whole time, never returned a profile it did not read from Rust.

Per-instance log view for the phase: `[player-profile-rust-1] rpc completed: none`, `[player-profile-rust-2] rpc completed: none` (nothing was served).

### S5 - Restore rust-1, no action on Go

| Metric | Run C | Run D |
| --- | --- | --- |
| `docker compose start` -> gRPC `SERVING` (Rust gauge) | 0.8 s | 0.7 s |
| `docker compose start` -> Envoy puts it back in rotation | 4.4 s | 4.4 s |
| First `200` through Go (normal reads once per second, no Go restart or config change) | 6.7 s after start, 2.3 s after Envoy re-admission, 3 reads | 6.7 s, 2.3 s, 3 reads |

The Go breaker had been open for more than its 10 s default, so the first read after Envoy re-admitted the replica was the half-open probe and closed it. Per-instance log: `rust-1: starting player/profile service`, `player/profile gRPC server listening`, `readiness checks passed; reporting SERVING`, then `rpc completed: GetProfile applied/OK x11`.

### S6 - Restore rust-2

Back in rotation 2.2 s (C) / 2.1 s (D) after `docker compose start`; 100 requests split 59/41 (C) and 60/40 (D) with 0 failures; Go read `200`.

### S7 - Readiness follows PostgreSQL

With PostgreSQL stopped: both replicas report NOT_SERVING (gauge 0) within 2 s, Envoy has 0 hosts in rotation 1.5 s later, Docker still reports both containers `healthy`. `docker compose restart player-profile-rust-1` while the database is down: 8 s later the gauge is still 0 and Envoy still has 0 hosts in rotation (Rust log: `readiness check failing; reporting NOT_SERVING (database unreachable: connection i/o error)`), while Docker says `healthy`. After `docker compose start postgres`: rust-1 SERVING 2.1-2.2 s later, both back in Envoy rotation 3.4-3.5 s later, and a request through Envoy returns OK. Rust log shows `readiness checks passed; reporting SERVING` only after the database came back.

Rust never touches `match.*`: `grep -rn 'match\.' services/player-profile-service-rust/src` finds nothing (checked by the script).

## Findings (measured, not tuned)

1. **Health-check cadence at start-up.** `envoy.yaml` sets no `no_traffic_interval`. The first health-check round after start came about 54 s after the first request, consistent with Envoy's default of 60 s for a cluster that has never had traffic. A replica that dies in the first minute after Envoy starts is detected up to about 60 s later instead of 7-8 s (an earlier exploratory run killed rust-1 in that window: 54.9 s, 42 of 83 requests failed). Setting `no_traffic_interval` (and `no_traffic_healthy_interval`) is an Envoy decision for Angel.
2. **Exclusion window.** With `interval 3s`, `timeout 1s`, `unhealthy_threshold 2` the dead replica leaves rotation 7.2-8.1 s after the kill, and every request routed to it in that window fails (about half of the traffic: 6 of 11 here; the dead container's address does not answer, so each fails at `connect_timeout 1s`). There is no `outlier_detection` and no Envoy retry, so passive failures never eject the host faster. Go retries a failed read once (`PLAYER_PROFILE_READ_MAX_RETRIES` default 1); only reads are retried. Number to feed the I73/C22 decision; not changed.
3. **Docker DNS removal does not exclude.** After the kill, Docker's DNS stops resolving the replica and Envoy marks it `pending_dynamic_removal`, but it keeps it in rotation until the active health check fails (the health flag `healthy` disappears first, which is not exclusion). The script therefore measures exclusion as `failed_active_hc`, not by the missing `healthy` flag.
4. **Panic mode with no healthy host.** While the failed host is still listed, a request takes about 1 s (`connect_timeout`) and Go's first reads wait about 755 ms (Go's own deadline). After the dead hosts leave the cluster (checked ~16 s after the kill; the script does not time the removal) Envoy answers `Unavailable` in about 15 ms.
5. **Compose healthcheck gap (H63).** `nc -z 127.0.0.1 50051` reports `healthy` with the database stopped, restarted replicas included (S7), while gRPC health is NOT_SERVING. Readiness for traffic is carried by gRPC health consumed by Envoy; changing the Compose check needs a start-up ordering decision first (CI runs `up --wait` before the migration step and Envoy waits for healthy Rust). Coordination item for Angel.

## What the harness does not do

It does not drive real race traffic or WebSocket players; the Go side of the proof is `GET /v1/profile` with a real session (`POST /v1/sessions`), which goes Go -> circuit breaker -> gRPC adapter -> `envoy:50051` -> Rust. It does not tune or restart Go, Envoy or Prometheus, and does not exercise separate DB LOGIN roles (`compunube_player_app` is `NOLOGIN` today; coordination item).
