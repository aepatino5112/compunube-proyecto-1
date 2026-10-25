# J84 — PostgreSQL runtime credential isolation

`db-migrate` is a one-shot Compose service that connects as the administrative PostgreSQL user, applies migrations 0001/0002, then runs the idempotent [`provision-runtime.sh`](../../database/scripts/provision-runtime.sh). Its successful exit gates both Rust replicas, Go and postgres-exporter. The three runtime LOGIN principals inherit separate permission groups: `compunube_match_runtime` → `compunube_match_app`, `compunube_player_runtime` → `compunube_player_app`, and `compunube_monitor_runtime` → `pg_monitor`. Only `db-migrate` receives the administrator password. The historical migration files are unchanged.

The [runtime smoke](../../database/scripts/smoke-runtime.sh) authenticates with the actual Go and Rust LOGIN passwords. It reads and performs rolled-back INSERT/UPDATE/DELETE in each owner's schema. It then requires SELECT/INSERT/UPDATE/DELETE to fail against the other schema. CI Integration runs this after E42's migration, seed, backup and restore smoke. The J83 public HTTP harness runs on this Compose model as a second check that Go settlement and Rust profile/economy continue to function with their own credentials.

Credentials are supplied by `POSTGRES_PASSWORD`, `MATCH_DB_PASSWORD`, `PLAYER_DB_PASSWORD` and `MONITOR_DB_PASSWORD` from the environment or a Git ignored `.env`; CI generates fresh random values per run. No password literal is stored in SQL, Dockerfiles or Compose. See [database/README.md](../../database/README.md) for rotation steps.

## Execution record

Pending CI Integration run on the J84 PR. Local Docker Desktop WSL integration is disabled in this environment.
