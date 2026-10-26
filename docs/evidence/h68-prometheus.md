# H68: Prometheus de Go, Rust, Envoy y PostgreSQL

La [configuración versionada](../../infra/monitoring/prometheus/prometheus.yml) scrapea cada 5 s cinco targets por DNS de Compose:

| Job | Instancia |
| --- | --- |
| `match-service-go` | `match-service-go:8080/metrics` |
| `player-profile-rust` | `player-profile-rust-1:9100/metrics` |
| `player-profile-rust` | `player-profile-rust-2:9100/metrics` |
| `envoy` | `envoy:9901/stats/prometheus` |
| `postgres` | `postgres-exporter:9187/metrics` |

Rust conserva `instance_id=rust-1` y `instance_id=rust-2` en las series propias. El puerto 9100 solo se alcanza en la red interna de Compose. Prometheus puede empezar antes de que un target esté listo; repite scrapes y registra su estado en `/api/v1/targets`.

Las [reglas](../../infra/monitoring/prometheus/rules/operational.yml) detectan target caído (1 min), PostgreSQL inaccesible (30 s), ambas Rust caídas (30 s) y Circuit Breaker abierto (1 min). Son ventanas para evitar señales durante un reinicio breve, no SLA. Prometheus expone su estado por `/api/v1/rules` y `ALERTS`; este batch no configura envío de notificaciones.

## Reproducción

Desde la raíz, ejecutar `python3 scripts/validation/h68-prometheus.py`. El [harness](../../scripts/validation/h68-prometheus.py) usa un proyecto Compose aislado, credenciales efímeras y puertos propios. Comprueba los cinco targets `UP`, `instance_id` distintos, consultas representativas de Go/Rust/Envoy/PostgreSQL y las cuatro alertas cargadas. Luego mata rust-1, observa ese target `DOWN` con rust-2 `UP`, restaura rust-1 y comprueba recuperación. Detiene PostgreSQL, verifica `pg_up=0`, ambas Rust `player_profile_health_serving=0` y el alerta de base, y espera la recuperación. El teardown de contenedores, red y volúmenes se ejecuta siempre; termina en `RESULT: PASS/FAIL`.

CI Infrastructure valida Prometheus y las rules con `promtool check config`; CI Integration ejecuta el harness con imágenes construidas por el workflow. Localmente Docker Desktop no está integrado en esta distribución WSL, por lo que la ejecución Compose queda a cargo de CI.

Las señales `pg_up` y `cluster.*.membership_healthy` están descritas por [postgres-exporter](https://github.com/prometheus-community/postgres_exporter/blob/master/docs/README.md) y [Envoy](https://www.envoyproxy.io/docs/envoy/v1.32.10/configuration/upstream/cluster_manager/cluster_stats); el harness consulta la forma Prometheus real exportada por este stack.
