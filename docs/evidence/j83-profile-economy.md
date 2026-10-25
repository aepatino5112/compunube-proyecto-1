# J83 — Go → Envoy → Rust profile and economy integration

The reproducible harness is [`scripts/validation/j83-profile-economy.py`](../../scripts/validation/j83-profile-economy.py). Run it with Python 3 and Docker Compose from any directory:

```bash
python3 scripts/validation/j83-profile-economy.py
```

It creates the isolated `compunube-j83` Compose project (ports 55483, 58083, 55083 and 59083), applies migrations 0001/0002, tests the stack, and removes its containers, network and volumes on success or failure. `J83_PROJECT` and the Compose port variables may be overridden; `J83_SKIP_BUILD=1` reuses previously built validation images. The last line is `RESULT: PASS` or `RESULT: FAIL` and the process exit status agrees. CI Integration runs this script on the J83 PR and on subsequent changes to its path.

The HTTP checks use `POST /v1/sessions` and its bearer token. Profile and catalog reads, exchange, purchase, craft, equipment, appearance, replay, idempotency conflict, business rejection and Rust outage all enter through Go's public API. The fixture inserts one completed race result and a pending delivery in `match.*`, as F54 does. Go's durable settlement coordinator calls `SettleRace` through Envoy to credit that session's player in Rust. The harness does not call gRPC directly and does not create a debug endpoint.

The harness checks `player.profiles`, `player.settlements` and `player.economic_operations` through PostgreSQL after public HTTP operations. It also checks that the one `match.settlement_delivery` remains confirmed after economy traffic. The fixture itself is the only direct writer to `match.*` in this test. J84 will enforce the cross-schema boundary with separate runtime database roles.

Expected balances for the deterministic path:

| Phase | Coins | Plastic | Metal | Revision |
| --- | ---: | ---: | ---: | ---: |
| New profile | 0 | 0 | 0 | 1 |
| Race settlement | 0 | 30 | 12 | 2 |
| Exchange 15 plastic | 60 | 15 | 12 | 3 |
| Replay/conflict | 60 | 15 | 12 | 3 |
| Buy `manglar` | 0 | 15 | 12 | 4 |
| Craft `red-reuso` | 0 | 9 | 9 | 5 |

Equipment and appearance advance the revision further. An attempt to buy `sol` with zero coins returns HTTP 422 `INSUFFICIENT_COINS`. Reusing the exchange request ID with a different amount returns HTTP 409 `IDEMPOTENCY_CONFLICT`. After stopping both Rust containers, profile and catalog return HTTP 503 `PROFILE_UNAVAILABLE` while Go `/healthz` and `/readyz` remain 200.

## Execution record

Local execution in the current WSL environment is unavailable because Docker Desktop WSL integration is disabled. The [CI Integration run for PR #61](https://github.com/aepatino5112/compunube-proyecto-1/actions/runs/40221448893) executed the harness on 2026-10-25 at head `00eb15e`: **53 checks passed, 0 failed, `RESULT: PASS`**. The fixture reached confirmed settlement in 0.2 s; stopping both Rust replicas led to `PROFILE_UNAVAILABLE` checks after 58.7 s while Go health/readiness stayed 200. The complete isolated run took 80.1 s and its teardown removed the project. These timings describe this CI run, not a latency target.
