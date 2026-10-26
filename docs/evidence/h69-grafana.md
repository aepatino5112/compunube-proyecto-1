# H69: Grafana operacional provisionado

Grafana carga el [datasource Prometheus](../../infra/monitoring/grafana/provisioning/datasources/datasource.yml) con UID estable `compunube-prometheus` y el [dashboard Compunube Operations](../../infra/monitoring/grafana/provisioning/dashboards/json/compunube-operations.json) mediante un [provider versionado](../../infra/monitoring/grafana/provisioning/dashboards/provider.yml). Todo está montado desde Git en `compose.yml`; no requiere importación manual ni el volumen previo de Grafana. En un arranque limpio (`docker compose down -v` seguido de `docker compose up --build -d --wait`), Grafana reconstruye datasource y dashboard.

El dashboard único presenta 22 paneles: salud de los cinco targets, PostgreSQL, cantidad de réplicas Rust caídas, Player/Profile indisponible, salas, conexiones, admisiones/rechazos, entradas descartadas y coalescidas, colas y rechazos de workpool, Circuit Breaker, rechazos rápidos/reintentos, settlement, tasa/errores/latencia p95 de RPC Rust por `instance_id`, readiness Rust, hosts sanos y errores 5xx de Envoy, conexiones PostgreSQL y alertas Prometheus. Los indicadores de PostgreSQL y Rust usan `pg_up` y `up`, mientras que las alertas versionadas de H68 aparecen en el panel de `ALERTS`. No hay labels con identidades o secretos.

## Reproducción y comprobaciones

Ejecutar `python3 scripts/validation/h69-grafana.py` desde cualquier directorio. El [harness](../../scripts/validation/h69-grafana.py) inicia un proyecto Compose aislado con contraseñas efímeras, comprueba por API que Grafana provisionó datasource, provider y dashboard, valida las expresiones PromQL contra Prometheus y genera tráfico público Go (`POST /v1/sessions`, `POST /v1/rooms`, `GET /v1/profile`). Espera que la sala y los RPC Rust aparezcan en métricas.

Luego detiene rust-1: el indicador marca una réplica caída mientras rust-2 conserva readiness. Detiene rust-2 y observa dos réplicas caídas, alerta `CompunubeBothRustDown` y Circuit Breaker Go abierto tras peticiones reales. Restaura ambas, detiene PostgreSQL y espera `pg_up=0` y alerta `CompunubePostgreSQLDown`, con el target Go aún `UP`. Finalmente restaura PostgreSQL y comprueba los cinco targets `UP`. Teardown se ejecuta incluso ante fallos y emite `RESULT: PASS/FAIL`. CI Integration corre este harness después de J83, J85 y H68.

No se ejecuta Docker localmente en este WSL porque Docker Desktop no está integrado; la evidencia dinámica queda en CI Integration.

## Resultado observado en CI

La [ejecución CI Integration](https://github.com/aepatino5112/compunube-proyecto-1/actions/runs/40251197355) terminó con `RESULT: PASS`, 17 comprobaciones en 114,2 s y teardown completo. Grafana sirvió por API el datasource con UID estable y el dashboard provisionado; las 22 expresiones de panel se evaluaron en Prometheus. Tras crear una sesión y sala y consultar seis veces el perfil público, aparecieron la sala y los RPC Rust con ambos `instance_id`. Al detener rust-1, rust-2 siguió `SERVING`; al detener ambas, el indicador llegó a dos, `CompunubeBothRustDown` se activó y el Circuit Breaker de Go abrió. Con PostgreSQL detenido, `pg_up` cayó a cero, se activó `CompunubePostgreSQLDown` y Go siguió scrapeable. Después de restaurar los servicios, los cinco targets volvieron a `UP` y la alerta de PostgreSQL se resolvió. J83, J85 y H68 pasaron en el mismo workflow.
