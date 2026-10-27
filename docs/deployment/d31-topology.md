# D31 · Topología física

**Estado:** topología de un host validada en CI; reparto por roles validado en CI y pendiente de ejecutar en los equipos físicos (ver abajo). No se fijan direcciones, hostnames ni recursos que no se hayan medido.

## Topología validada (un host)

[D33](../uml/deployment.svg) ([fuente](../uml/deployment.puml)) representa lo que realmente se ejecuta en CI Integration con `compose.yml`: un host Docker con PostgreSQL (volumen persistente), `db-migrate`, `player-profile-rust-1` y `-2` (misma imagen), Envoy, Go, Prometheus, Grafana y postgres-exporter en la red de Compose. Los clientes (navegador vía `server.mjs` y cliente Python) solo alcanzan el puerto público de Go.

| Servicio | Réplicas | Puerto en el host (variable) | Protocolo |
| --- | --- | --- | --- |
| match-service-go | 1 | `GO_HTTP_PORT` (8080) | HTTP E45 + WebSocket E43 |
| envoy | 1 | `ENVOY_GRPC_PORT` (50051), `ENVOY_ADMIN_PORT` (9901) | gRPC / admin HTTP |
| player-profile-rust | 2 (rust-1, rust-2) | no publicados | gRPC :50051, métricas :9100 |
| postgres | 1 | `POSTGRES_PORT` (5432) | SQL |
| prometheus / grafana | 1 / 1 | `PROMETHEUS_PORT` (9090) / `GRAFANA_PORT` (3000) | HTTP |
| cliente web | n | `COMPUNUBE_WEB_PORT` (4173) en cada equipo cliente | HTTP (proxy a Go) |

Las dos réplicas Rust comparten host: la demostración de failover (J78, H69, I73) prueba la caída de una **réplica**, no la de un equipo.

## Distribución en el laboratorio (por roles)

[Laboratorio por roles](lab-roles.md): cinco equipos, uno por pieza, con `scripts/lab.mjs` y el mismo `compose.yml`. Go y Rust leen la dirección de la BD y de Envoy de `POSTGRES_ADDR` y `PLAYER_PROFILE_GRPC_ADDR` (vacías = mismo proyecto Compose).

| Equipo | Rol | Servicios | Puerto publicado |
| --- | --- | --- | --- |
| A | BD | `postgres`, `db-migrate` | 55432 |
| B | Rust | `player-profile-rust-1`, `player-profile-rust-2`, `envoy` | 50051 |
| C | Go | `match-service-go` | 8080 |
| D, E | Web | `server.mjs` en `127.0.0.1:4173` (reenvía `/v1` a C) | ninguno |

Estado: validada en CI Deploy (job `lab-roles`, un proyecto Compose por rol que solo se ven por puertos publicados) y en un ensayo local. **Falta ejecutarla en los equipos físicos.** Las IP se quedan en el `.env` de cada equipo, no aquí. Las dos réplicas Rust comparten el equipo B; Prometheus y Grafana siguen siendo de un solo host.
