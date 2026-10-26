# Diagnóstico de problemas frecuentes

Síntomas observados durante el desarrollo y la validación, con su causa comprobada y cómo confirmarla. Los comandos asumen el proyecto Compose por defecto y el `.env` de la raíz.

| Síntoma | Causa comprobada | Cómo confirmarlo | Qué hacer |
| --- | --- | --- | --- |
| `docker compose up` falla con `set GRAFANA_ADMIN_PASSWORD` (u otro secreto) | Los cinco secretos son obligatorios desde H62; Grafana ya no usa `admin/admin`. | `docker compose config` muestra el error. | Completar `.env` con `openssl rand -hex 24` para cada secreto. |
| Go responde `503 PROFILE_UNAVAILABLE` en perfil/economía | Ambas réplicas Rust caídas, Rust sin PostgreSQL (`NOT_SERVING`) o Circuit Breaker abierto tras fallos. | `curl -s localhost:9901/clusters \| grep health_flags`; panel «Circuit breaker state» en Grafana; `docker compose ps`. | Recuperar Rust/PostgreSQL. El Circuit Breaker se cierra solo tras la sonda half-open (≈10 s). Las carreras activas no se detienen. |
| Envoy cuenta 3 hosts «sanos» o reparte tráfico desigual tras reiniciar Rust | Docker reasignó las IPs de las réplicas y una entrada antigua seguía viva (`pending_dynamic_removal`). | `/clusters` muestra el mismo IP con dos hostnames. | Corregido con `ignore_health_on_host_removal: true` (H69). Si reaparece, revisar `infra/envoy/envoy.yaml`. |
| `race.ended` queda en `settlementState: pending` | Rust no disponible o PostgreSQL caído al terminar la carrera; las entregas siguen en `match.settlement_delivery`. | `SELECT state, count(*) FROM match.settlement_delivery GROUP BY state;` | Esperar la recuperación: el coordinador reintenta con backoff y Go republica `race.ended` confirmado. No acreditar a mano. |
| El navegador de otro equipo no mantiene la sesión online | La cookie de Go es `Secure`; sobre `http://<IP>` el navegador la descarta. | Herramientas de desarrollo → Application → Cookies vacío. | Usar `http://127.0.0.1` en el mismo equipo o HTTPS hasta Go (pendiente para el laboratorio). El cliente Python no está afectado. |
| Mutaciones web responden `401 SESSION_REQUIRED` con cookie válida | Go exige `Origin` del mismo origen en mutaciones con cookie (protección CSRF). | Petición sin `Origin` o servida desde otro puerto/host. | Servir la web con `server.mjs` y `COMPUNUBE_GO_URL` (mismo origen). |
| Tras reiniciar Go, el cliente pierde su perfil online | Las sesiones viven en memoria (F48). | `GET /v1/sessions/current` → 401 con el token anterior. | Limitación conocida: crear una sesión nueva. Los datos anteriores siguen en `player.*`. |
| Recargar la página durante la carrera deja al jugador como `left` | La página tardó más de 15 s en volver (ventana de reentrada) o se pulsó «Salir». | Resultado con `outcome: left`. | Volver antes de 15 s; la recarga no envía `room.leave` (G61). |
| El juego se queda en «Preparando el agua…» | El navegador no puede crear un contexto WebGL (por ejemplo, Firefox headless en CI). | Consola: `THREE.WebGLRenderer: Error creating WebGL context`. | Usar un navegador con WebGL (aceleración o software). |
| Una prueba de base de datos «pasa» sin ejecutarse | Faltaba la URL de PostgreSQL y la prueba se omitía. | Salida `--- SKIP`. | En CI se usan `PLAYER_TEST_REQUIRE_DB=1` y `MATCHSTORE_TEST_REQUIRE_DB=1`; localmente, exportar `*_TEST_DATABASE_URL`. |
| `docker run plantuml …` no escribe los SVG en Linux | El contenedor corre con otro usuario. | `Permission denied` al escribir `/work/*.svg`. | Añadir `--user "$(id -u):$(id -g)"` (ver `docs/uml/README.md`). |

Para el servicio Rust (variables, arranque, salud, métricas, diagnóstico de PostgreSQL, migraciones, `NOT_SERVING`, Envoy sin hosts y recuperación), ver el [runbook operativo](../runbooks/rust-player-profile-service.md) (I74-R1, Ricardo Beltrán).
