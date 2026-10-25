# J85 — Compose readiness follows real Rust gRPC Health

The Rust container now carries a small [Go probe](../../services/match-service-go/cmd/player-profile-healthcheck/main.go) built from the repository's existing gRPC dependency. Docker runs this probe against `127.0.0.1:50051`, service name `player_profile`, with a two-second deadline. Exit status zero requires `SERVING`; `NOT_SERVING`, transport failures and timeouts return nonzero. Envoy already checks the same gRPC service. No Rust application code or E43 contract changed.

The J84 `db-migrate` one-shot service closes the startup cycle: PostgreSQL healthy → migrations and runtime LOGIN provisioning complete → Rust can become `SERVING` → Envoy → Go. Compose waits for `db-migrate` to exit successfully before starting either Rust replica, so `docker compose up --wait` no longer needs a TCP-open placeholder or a fixed sleep before migrations.

J78 measured a separate Envoy startup cadence gap: in a cluster without routed traffic, its default health interval is 60 s. The first J85 CI runs confirmed that even a hard-killed Rust host could remain marked `healthy` for the harness's 120 s one-host window. J85 sets `no_traffic_interval` and `no_traffic_healthy_interval` to the existing 3 s active interval, so Envoy continues active gRPC health checks when traffic is quiet. This changes probe cadence, not retry or load-balancing policy. See the [Envoy HealthCheck API](https://www.envoyproxy.io/docs/envoy/v1.31.0/api-v3/config/core/v3/health_check.proto) for the no-traffic interval semantics.

Run the isolated [J85 validation harness](../../scripts/validation/j85-compose-readiness.py) with Python 3 and Docker Compose. It generates ephemeral credentials if none are set, builds validation images, uses distinct host ports, and always tears down containers, network and volumes. It ends with `RESULT: PASS/FAIL` and matching exit status.

```bash
python3 scripts/validation/j85-compose-readiness.py
```

The harness checks clean `up --wait`, two healthy Rust containers and two Envoy hosts. It stops PostgreSQL and waits for both Rust containers to become `unhealthy` while the processes remain running and Envoy reaches zero hosts; then it restores PostgreSQL and waits for both to recover. Renaming a required `player` table in the isolated database proves an incomplete schema also makes them unhealthy; the harness restores it. It kills rust-1 with the J78 SIGKILL strategy to confirm Envoy retains one healthy host, then starts and restarts rust-1, confirming two hosts and Docker health again. Polls have bounded deadlines; no fixed startup delay is used.

## Execution record

The [CI Integration run for PR #63](https://github.com/aepatino5112/compunube-proyecto-1/actions/runs/40226406863) passed on 2026-10-25: `RESULT: PASS`, six explicit checks, 146.7 s for the isolated J85 harness. Clean `up --wait` reached two Rust `healthy` containers. With PostgreSQL down, both became `unhealthy` while still running and Envoy reached zero hosts in 48.0 s; restoring PostgreSQL returned both and Envoy to healthy/two hosts in 5.4 s. Removing a required `player` table produced unhealthy/zero hosts; restoring it recovered both. A hard-killed rust-1 left one healthy Envoy host in 7.0 s; start and restart returned rust-1 to healthy in 5.2 s each. These timings describe this run, not an SLA. The J83 public API harness and all six PR checks also passed. Local Docker Desktop WSL integration is disabled in this environment.
