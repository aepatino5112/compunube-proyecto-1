# D31 · Topología física

**Estado:** topología de referencia validada en CI; **distribución física pendiente** de los datos de A05 (`docs/deployment/a05-lab-audit.md`). No se fijan direcciones, hostnames ni recursos que no se hayan medido.

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

## Distribución en el laboratorio (pendiente)

Con los datos de A05 se decidirá, y se registrará aquí y en D33:

1. Equipo de servicios: Go, Envoy, rust-1, rust-2 y PostgreSQL (todos en uno si los recursos lo permiten; si no, PostgreSQL o una Rust en un segundo equipo, ajustando Compose y el firewall).
2. Tres equipos cliente: navegador y/o cliente Python. El navegador desde otro equipo requiere HTTPS hasta Go, porque Go emite la cookie de sesión con `Secure` (ver H66).
3. Límites de recursos medidos y si las instancias comparten host.

Bloqueo humano: acceso físico al laboratorio (Ángel Patiño).
