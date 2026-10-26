# Runbook: Rust Player/Profile Service (I74-R1)

Guía operativa del servicio `services/player-profile-service-rust`: qué posee, cómo se configura, en qué orden arranca, cómo se comprueba, cómo se prueba y cómo se recupera. Responsable: Ricardo Beltrán ([AGENTS.md](../../AGENTS.md)). Diseño y contrato: [D29](../architecture/rust-player-profile-service.md), [E40](../architecture/health-readiness-design.md), [E38](../architecture/resilience-failover-degraded-mode.md), [`proto/player_profile.proto`](../../proto/player_profile.proto).

## Cómo leer esta guía

Cada comando lleva una marca que dice **de dónde sale su evidencia**. No hay otra forma de saber si algo se ejecutó de verdad.

| Marca | Significado |
| --- | --- |
| **[L]** | Ejecutado localmente al redactar esta guía (2026-10-26, macOS, Docker Desktop 29.6.2, Compose 5.3.1) en proyectos Compose aislados, con puertos no estándar, y limpiado después con `down -v`. |
| **[CI]** | No se ejecutó al redactar la guía; la evidencia es una ejecución de CI registrada en [`docs/evidence/`](../evidence/). La ejecución local queda indicada cuando existe. |
| **[ref]** | Referencia a un archivo o a un comando documentado en otro lugar; no se ejecutó aquí. |

Los ejemplos usan los puertos por defecto (`50051`, `9901`, `8080`, `5432`, `9090`). Si el `.env` los cambia, sustituya el número. Los comandos asumen un shell POSIX en la raíz del repositorio; en Windows 10 **no** se han probado (ver [Alcance no validado](#8-alcance-no-validado)).

## 1. Responsabilidad y ownership

| Dueño | Contexto | Qué hace |
| --- | --- | --- |
| **Rust** (`player-profile-rust-1`, `player-profile-rust-2`) | PostgreSQL `player.*` | Perfil, catálogo, inventario, economía, crafting, canje, equipamiento, apariencia y settlement. Ocho RPC de `compunube.player.v1.PlayerProfileService`. |
| **Go** (`match-service-go`) | PostgreSQL `match.*` | Salas, carreras, tiempo real, HTTP/WebSocket públicos y la cola `match.settlement_delivery`. Llama a Rust solo por Envoy (`envoy:50051`). |

Rust nunca lee ni escribe `match.*` (prueba estructural `tests/architecture.rs`) y Go no escribe `player.*` (roles de base de datos separados, sección 2). Ninguna réplica guarda estado crítico en memoria: cualquiera puede reemplazar a la otra. Rust no participa en el tick de carrera: si cae, Go mantiene las carreras activas y las operaciones de perfil responden `503 PROFILE_UNAVAILABLE` (modo degradado, E38).

## 2. Servicios, puertos, variables y roles

### Servicios de [`compose.yml`](../../compose.yml) que importan a Rust

| Servicio | Imagen | Función |
| --- | --- | --- |
| `postgres` | `postgres:17-alpine` | Base `compunube` con los schemas `match` y `player` (`database/init/00-bootstrap.sql`). |
| `db-migrate` | `postgres:17-alpine` | Proceso de un solo uso: aplica las migraciones y provisiona los roles de runtime ([`bootstrap-runtime.sh`](../../database/scripts/bootstrap-runtime.sh)). Único servicio con la contraseña administrativa. |
| `player-profile-rust-1`, `player-profile-rust-2` | `compunube-player-profile-service:${COMPUNUBE_IMAGE_TAG:-dev}` | Misma imagen, `INSTANCE_ID` `rust-1` y `rust-2`. |
| `envoy` | `envoyproxy/envoy:v1.31.10` | Balancea y comprueba la salud de ambas réplicas ([`infra/envoy/envoy.yaml`](../../infra/envoy/envoy.yaml)). |
| `match-service-go` | `compunube-match-service:${COMPUNUBE_IMAGE_TAG:-dev}` | Cliente de Rust a través de Envoy. |
| `prometheus` | `prom/prometheus:v2.55.1` | Scrapea cada réplica en `:9100/metrics` ([`prometheus.yml`](../../infra/monitoring/prometheus/prometheus.yml)). |

### Puertos

| Puerto | Dónde | ¿Publicado en el host? |
| --- | --- | --- |
| `50051` gRPC | cada réplica Rust (`SERVICE_ADDR`) | No. Se llega por Envoy. |
| `9100` métricas | cada réplica Rust (`METRICS_ADDR`, `GET /metrics`) | No. Lo scrapea Prometheus por nombre de servicio; a mano se lee con `docker compose exec`. |
| `ENVOY_GRPC_PORT` (50051) | Envoy, gRPC hacia las réplicas | Sí. |
| `ENVOY_ADMIN_PORT` (9901) | Envoy admin (`/ready`, `/clusters`) | Sí. |
| `GO_HTTP_PORT` (8080) | Go HTTP/WebSocket | Sí. |
| `POSTGRES_PORT` (5432) | PostgreSQL | Sí. |
| `PROMETHEUS_PORT` (9090) | Prometheus | Sí. |

### Variables del servicio Rust

Fuente: [`config.rs`](../../services/player-profile-service-rust/src/config.rs), [`compose.yml`](../../compose.yml) y [`Dockerfile`](../../services/player-profile-service-rust/Dockerfile). Un valor numérico o de dirección inválido detiene el proceso con código de salida `2` y el log `invalid configuration` **[L]**. Un `DATABASE_URL` ausente **no** lo detiene: la réplica arranca y permanece `NOT_SERVING` con el motivo `DATABASE_URL is not configured` **[L]**.

| Variable | Por defecto | Valor en Compose | Uso |
| --- | --- | --- | --- |
| `SERVICE_ADDR` | `0.0.0.0:50051` | `0.0.0.0:50051` | Dirección gRPC. |
| `METRICS_ADDR` | `0.0.0.0:9100` | (por defecto) | Listener de `GET /metrics`. Debe diferir de `SERVICE_ADDR`. |
| `INSTANCE_ID` | `rust-local` | `rust-1` / `rust-2` | Identidad en logs y etiqueta `instance_id` de las métricas. |
| `DATABASE_URL` | sin valor | `postgres://compunube_player_runtime:<PLAYER_DB_PASSWORD>@postgres:5432/<POSTGRES_DB>` | Conexión PostgreSQL con el rol de runtime de Rust. Nunca se imprime (redactada en `Debug`/`Display`). El driver no incluye TLS: `sslmode=require` falla. |
| `DB_POOL_MAX_CONNECTIONS` / `DB_POOL_MIN_CONNECTIONS` | `10` / `0` | (por defecto) | Pool de negocio por réplica (máximo entre 1 y 256). |
| `DB_POOL_ACQUIRE_TIMEOUT_MS` | `3000` | (por defecto) | Espera máxima por una conexión. |
| `HEALTH_PROBE_INTERVAL_MS` / `HEALTH_PROBE_TIMEOUT_MS` | `2000` / `1000` | (por defecto) | Frecuencia y límite de cada sondeo de readiness. |
| `SHUTDOWN_DRAIN_TIMEOUT_MS` | `8000` | (por defecto) | Tiempo para terminar RPC en curso tras SIGTERM/SIGINT. |
| `RUST_LOG` | `info` | (por defecto) | Nivel de logs (`tracing`). |

Variables de Compose que afectan al servicio (se definen en `.env`, a partir de [`.env.example`](../../.env.example); nunca se versionan los valores):

| Variable | Quién la usa |
| --- | --- |
| `POSTGRES_USER`, `POSTGRES_DB` (por defecto `compunube`), `POSTGRES_PASSWORD` | `postgres` y `db-migrate` (administrador). **Nunca** Rust. |
| `PLAYER_DB_PASSWORD` | Contraseña del rol `compunube_player_runtime` (la fija `db-migrate` y la usa Rust en `DATABASE_URL`). |
| `MATCH_DB_PASSWORD`, `MONITOR_DB_PASSWORD`, `GRAFANA_ADMIN_PASSWORD` | Go, postgres-exporter y Grafana; obligatorias para que `compose.yml` se pueda resolver. |
| `COMPUNUBE_IMAGE_TAG`, `COMPUNUBE_REVISION` | Etiqueta de la imagen y etiqueta OCI `org.opencontainers.image.revision` (por defecto `dev`; las fija [`scripts/deploy/deploy.sh`](../../scripts/deploy/deploy.sh)). |

### Roles de PostgreSQL (solo nombres y variables, nunca valores)

Definidos por [`database/README.md`](../../database/README.md) y [`provision-runtime.sh`](../../database/scripts/provision-runtime.sh); comprobados con `SELECT rolname, rolcanlogin FROM pg_roles WHERE rolname LIKE 'compunube_%'` **[L]**.

| Rol | LOGIN | Uso |
| --- | --- | --- |
| `POSTGRES_USER` (por defecto `compunube`) | sí | Administrador: migraciones y provisión. Solo `postgres`/`db-migrate`, y la suite de pruebas de Rust (sección 5). |
| `compunube_migrator` | no | Dueño de las tablas. |
| `compunube_player_app` | no | Permisos sobre `player.*` y `SELECT` sobre `public.schema_migrations` (la readiness lee la versión aplicada). |
| `compunube_player_runtime` | sí, `PLAYER_DB_PASSWORD` | **El único rol que usa Rust.** Hereda solo `compunube_player_app`. |
| `compunube_match_runtime`, `compunube_monitor_runtime` | sí | Go y postgres-exporter; Rust no los usa. |

## 3. Orden de arranque

```text
PostgreSQL healthy -> db-migrate (exit 0) -> Rust NOT_SERVING -> SERVING (healthy) -> Envoy -> Go
```

1. **PostgreSQL** pasa su healthcheck (`pg_isready`).
2. **`db-migrate`** aplica `0001` y `0002`, y crea o actualiza los roles de runtime. Rust y Go dependen de `service_completed_successfully`; si falla, ninguno arranca.
3. **Rust** arranca `NOT_SERVING`. Un bucle de fondo, con un pool aislado de una conexión, comprueba cada `HEALTH_PROBE_INTERVAL_MS`: `SELECT 1`, que `public.schema_migrations` contenga `0002` y que existan las nueve tablas `player.*`. Solo entonces publica `SERVING` en el servicio gRPC Health `player_profile`; vuelve a `NOT_SERVING` ante cualquier fallo y se recupera sola. Docker marca `healthy` con la sonda [`player-profile-healthcheck`](../../services/match-service-go/cmd/player-profile-healthcheck/main.go) (acepta solo `SERVING`).
4. **Envoy** espera a que ambas réplicas estén `healthy` y comprueba cada una con gRPC Health `player_profile` (intervalo 3 s, `unhealthy_threshold` 2).
5. **Go** espera a `db-migrate` y a que Envoy haya *arrancado* (no a que vea hosts sanos): puede responder `PROFILE_UNAVAILABLE` unos segundos hasta la primera ronda de health de Envoy.

La readiness es la señal de salud: el puerto gRPC abierto no prueba nada.

## 4. Operación

### 4.1 Levantar

```bash
cp .env.example .env              # una vez; el .env está ignorado por Git
# completar POSTGRES_PASSWORD, MATCH_DB_PASSWORD, PLAYER_DB_PASSWORD,
# MONITOR_DB_PASSWORD y GRAFANA_ADMIN_PASSWORD con valores distintos: openssl rand -hex 24
docker compose config -q          # falla con "set <VARIABLE>" si falta un secreto
docker compose up -d --build --wait
```

`docker compose config -q` y `docker compose up -d --build --wait` se ejecutaron **[L]** sobre la pila completa en un proyecto aislado (código de salida `0`; con `COMPOSE_PROJECT_NAME`, `COMPUNUBE_IMAGE_TAG` y puertos propios). Es también el comando de [H66](../deployment/h66-deploy-procedure.md) e [I75](../delivery/installation-and-operation.md) **[CI]**. Para un despliegue versionado, con copia previa y verificación de revisión, use `scripts/deploy/deploy.sh` ([H66](../deployment/h66-deploy-procedure.md), **[CI]**: CI Deploy).

Para ensayar sin tocar la pila por defecto, exporte `COMPOSE_PROJECT_NAME` y puertos alternativos antes de cualquier comando (`POSTGRES_PORT`, `GO_HTTP_PORT`, `ENVOY_GRPC_PORT`, `ENVOY_ADMIN_PORT`, `PROMETHEUS_PORT`, `GRAFANA_PORT`) y use `COMPUNUBE_IMAGE_TAG` propio para no pisar `compunube-*:dev` **[L]**.

### 4.2 Comprobar

```bash
docker compose ps -a                                           # ambas Rust "healthy"; db-migrate "Exited (0)"
docker compose exec -T player-profile-rust-1 /usr/local/bin/player-profile-healthcheck; echo "exit=$?"   # 0 = SERVING
curl -fsS http://127.0.0.1:9901/ready                          # Envoy: LIVE (no prueba que haya hosts Rust)
curl -fsS http://127.0.0.1:9901/clusters | grep 'player_profile_cluster::.*health_flags'   # dos líneas "healthy"
curl -fsS http://127.0.0.1:8080/healthz && curl -fsS http://127.0.0.1:8080/readyz          # Go
```

Todos **[L]**. `healthcheck` devuelve `1` si la réplica está `NOT_SERVING`. Con ambas réplicas detenidas, `/clusters` **no lista** ninguna línea `player_profile_cluster::…::health_flags` y `/ready` sigue en `LIVE` **[L]**.

### 4.3 Sondear el contrato gRPC (a través de Envoy)

Requiere `grpcurl`. Se usa el `.proto` del repositorio porque el servicio no expone reflexión **[L]**:

```bash
grpcurl -plaintext -import-path proto -proto player_profile.proto 127.0.0.1:50051 list
grpcurl -plaintext -import-path proto -proto player_profile.proto -d '{}' \
  127.0.0.1:50051 compunube.player.v1.PlayerProfileService/GetCatalog
```

`GetCatalog` es de solo lectura y devuelve `online-v1` **[L]**. **Cualquier otra RPC, incluido `GetProfile`, crea el perfil si no existe** y las mutaciones cambian saldos: úselas solo con jugadores de prueba y en un proyecto aislado. `grpc.health.v1.Health` no se puede consultar con `grpcurl` sin su propio `.proto` (el repositorio no lo incluye); use la sonda del contenedor y `/clusters`.

### 4.4 Logs

```bash
docker compose logs -f --tail=100 player-profile-rust-1
# solo una línea por RPC (JSON): servicio, instancia, método, resultado, código, latencia y correlación
docker compose logs --no-log-prefix player-profile-rust-1 player-profile-rust-2 \
  | jq -c 'select(.message=="rpc completed")'
# motivos por los que una réplica no sirve
docker compose logs --no-log-prefix player-profile-rust-1 | jq -c 'select(.level=="WARN") | {message, reason}'
```

**[L]**. Los logs son JSON (`service`, `instance_id` y, en las líneas del arranque, el span `service`). No contienen `playerId`, `requestId` de negocio, tokens, payloads ni la `DATABASE_URL`.

**Correlación.** Go acepta o genera `X-Request-ID` y lo envía a Rust como metadata gRPC `x-correlation-id`; Rust lo registra como `correlation_id` en `rpc completed` solo si tiene entre 1 y 64 caracteres ASCII alfanuméricos, `-` o `_`; si falta o es inválido registra `""` sin reflejar la entrada. No es label de Prometheus ni clave de idempotencia ([H67-Final](../evidence/h67-final-correlation.md); pruebas de Rust en `tests/grpc_request_log.rs`). Seguir una petición de punta a punta **[L]**:

```bash
TOKEN=$(curl -fsS -X POST http://127.0.0.1:8080/v1/sessions | jq -r .token)
curl -fsS -o /dev/null -H "Authorization: Bearer $TOKEN" -H 'X-Request-ID: runbook-corr-1' http://127.0.0.1:8080/v1/profile
docker compose logs --no-log-prefix match-service-go player-profile-rust-1 player-profile-rust-2 \
  | jq -c 'select(.correlation_id=="runbook-corr-1")'
```

Crea una sesión y un perfil de prueba.

### 4.5 Métricas (una serie por instancia)

El puerto `9100` no se publica; se lee dentro del contenedor (la imagen incluye `nc`) o a través de Prometheus:

```bash
docker compose exec -T player-profile-rust-1 sh -c "printf 'GET /metrics HTTP/1.0\r\n\r\n' | nc -w 2 127.0.0.1 9100" \
  | grep -E '^player_profile_(up|health_serving|db_pool_max_connections)\{'
curl -fsS http://127.0.0.1:9090/api/v1/targets | jq -r '.data.activeTargets[] | [.labels.job, .labels.instance, .health] | @tsv'
curl -fsS http://127.0.0.1:9090/api/v1/query --data-urlencode 'query=player_profile_health_serving' | jq -c '.data.result[] | [.metric.instance_id, .value[1]]'
```

**[L]**. Cada serie lleva `service="player-profile-service"` e `instance_id`. Catálogo de métricas y semántica: [D29, Observabilidad](../architecture/rust-player-profile-service.md#observabilidad-h67). `player_profile_health_serving` pasa a `0` y `player_profile_health_probe_failures_total` crece cuando la readiness falla **[L]**. El panel y las reglas de alerta están en [H68](../evidence/h68-prometheus.md) y [H69](../evidence/h69-grafana.md).

### 4.6 Detener y limpiar

```bash
docker compose stop player-profile-rust-1        # SIGTERM: publica NOT_SERVING, drena y cierra pools
docker compose down                              # conserva los volúmenes (datos de PostgreSQL)
docker compose down -v                           # BORRA los volúmenes: PostgreSQL, Prometheus y Grafana
docker image rm compunube-player-profile-service:<etiqueta> compunube-match-service:<etiqueta>   # solo las etiquetas propias
```

`down -v` destruye los datos del proyecto Compose indicado: úselo solo en proyectos de ensayo (`-p` o `COMPOSE_PROJECT_NAME`). **[L]** en proyectos aislados.

## 5. Pruebas

### 5.1 Suite de Rust (con PostgreSQL de verdad)

La suite necesita una base migrada y la variable `PLAYER_TEST_DATABASE_URL`. Sin ella las pruebas de base de datos **se omiten con un aviso (`!!! SKIPPED`) y el resultado sale verde**: un omitido no es un pase. `PLAYER_TEST_REQUIRE_DB=1` convierte la ausencia en fallo; CI lo fija ([`ci-rust.yml`](../../.github/workflows/ci-rust.yml)).

```bash
export POSTGRES_PASSWORD=... MATCH_DB_PASSWORD=... PLAYER_DB_PASSWORD=... MONITOR_DB_PASSWORD=... GRAFANA_ADMIN_PASSWORD=...   # valores desechables
export POSTGRES_PORT=55433
docker compose -p compunube-rust-test up -d --wait postgres
docker compose -p compunube-rust-test run --rm --no-deps db-migrate

cd services/player-profile-service-rust
cargo fmt --check
cargo clippy --locked --all-targets --all-features -- -D warnings
PLAYER_TEST_DATABASE_URL="postgresql://compunube:${POSTGRES_PASSWORD}@127.0.0.1:55433/compunube" \
PLAYER_TEST_REQUIRE_DB=1 cargo test --locked
cd ../..

docker compose -p compunube-rust-test down -v
```

**[L]** (199 pruebas en 17 binarios, 0 fallidas, ninguna omitida con `PLAYER_TEST_REQUIRE_DB=1`; localmente con Rust 1.98.1, CI usa 1.99). Notas:

- La URL usa el administrador (`compunube`) porque las pruebas preparan saldos directamente; **no** use esta URL fuera de una base desechable.
- `docker compose up -d --wait postgres db-migrate` (con `db-migrate` como objetivo explícito) devuelve código `1` en Compose 5.3.1 aunque `db-migrate` termine con éxito **[L]**; por eso se separa en dos pasos.
- `tests/grpc_request_log.rs` va en su propio binario a propósito: `tracing` cachea el interés de cada callsite en todo el proceso.
- Sin la variable, `cargo test --locked` pasa pero omite las pruebas de base de datos con el aviso **[L]**.

### 5.2 Humo de base de datos

Reproducible solo en un proyecto aislado: el humo E42 inserta un fixture ([`database/README.md`](../../database/README.md)).

```bash
docker compose exec -T postgres sh /opt/compunube-database/scripts/smoke.sh          # E42/F52: migraciones, catálogo, backup y restore en bases efímeras
docker compose run --rm --no-deps db-migrate sh /opt/compunube-database/scripts/smoke-runtime.sh   # J84: acceso propio permitido y cruzado denegado
```

**[L]** (`… smoke: PASS` y `… access: PASS`); también **[CI]** (CI Integration, [J84](../evidence/j84-runtime-db-credentials.md)).

### 5.3 Harnesses de integración

Todos viven en [`scripts/validation/`](../../scripts/validation/), usan un proyecto Compose aislado con puertos propios y credenciales efímeras, y borran contenedores, red y volúmenes al terminar (también si fallan). Los `.py` terminan con `RESULT: PASS` o `RESULT: FAIL` y el código de salida coincide.

Requisitos: Docker con Compose v2 y Python 3 (solo biblioteca estándar) para J83, J85, H68 y H69; I72 e I73 además usan el cliente Python (`python3 -m pip install -r apps/client-secondary/requirements.txt`); los `.sh` (F54, J78) requieren `curl`, `jq` y `grpcurl`.

| Harness | Comando | Qué prueba | Evidencia |
| --- | --- | --- | --- |
| [J83](../../scripts/validation/j83-profile-economy.py) | `python3 scripts/validation/j83-profile-economy.py` | Go → Envoy → Rust: perfil, economía, replay, conflicto, rechazo, settlement y caída de Rust. | [docs](../evidence/j83-profile-economy.md) **[CI]** · **[L]** `RESULT: PASS`, 56 comprobaciones, 24,6 s (imágenes ya construidas). |
| [J85](../../scripts/validation/j85-compose-readiness.py) | `python3 scripts/validation/j85-compose-readiness.py` | Docker `unhealthy` con PostgreSQL caído o tabla `player` ausente; recuperación; muerte de una réplica. | [docs](../evidence/j85-grpc-compose-readiness.md) **[CI]** · **[L]** `RESULT: PASS`, 6 comprobaciones, 157,4 s. |
| [H68](../../scripts/validation/h68-prometheus.py) | `python3 scripts/validation/h68-prometheus.py` | Cinco targets `UP`, `instance_id` distintos, alertas, caída de rust-1 y de PostgreSQL. | [docs](../evidence/h68-prometheus.md) **[CI]** · **[L]** `RESULT: PASS`, 14 comprobaciones, 65,2 s. |
| [H69](../../scripts/validation/h69-grafana.py) | `python3 scripts/validation/h69-grafana.py` | Grafana provisionado, paneles y alertas frente a fallos de réplicas y PostgreSQL. | [docs](../evidence/h69-grafana.md) **[CI]** · **[L]** `RESULT: PASS`, 19 comprobaciones, 123,6 s. |
| [I72](../../scripts/validation/i72-e2e-concurrency.py) | `python3 scripts/validation/i72-e2e-concurrency.py` | 12 clientes en 3 salas; crédito exacto una vez en `player.*`. | [docs](../evidence/i72-e2e-concurrency.md) **[CI]**; no se ejecutó localmente. |
| [I73](../../scripts/validation/i73-resilience.py) | `python3 scripts/validation/i73-resilience.py` | `docker kill` de ambas Rust y parada de PostgreSQL durante una carrera; settlement `pending` → `confirmed`. | [docs](../evidence/i73-resilience.md) **[CI]**; no se ejecutó localmente. |
| [F54](../../scripts/validation/f54-settlement-e2e.sh) | `scripts/validation/f54-settlement-e2e.sh` | Settlement extremo a extremo con grpcurl. No lo ejecuta CI. | [docs](../evidence/f54-settlement-e2e.md): ejecución local de 2026-10-19 (macOS), anterior a J84; **no se re-ejecutó** aquí. |
| [J78](../../scripts/validation/j78-rust-failover.sh) | `scripts/validation/j78-rust-failover.sh` | Reparto de Envoy y exclusión/reincorporación de réplicas. No lo ejecuta CI. | [docs](../evidence/j78-rust-failover.md): ejecución local de 2026-10-19 (macOS), anterior a J84; **no se re-ejecutó** aquí. |

Las ejecuciones **[CI]** son las que cada documento de evidencia enlaza; esta guía no las repite ni las reinterpreta. Los resultados **[L]** de J83, J85, H68 y H69 son de una sola ejecución local el 2026-10-26 sobre el árbol de `main` `9523523` y no sustituyen a la evidencia de CI; los tiempos dependen de la caché de imágenes y de la máquina.

## 6. Diagnóstico y recuperación

Primero identifique el motivo: Rust lo registra con `readiness check failed; reporting NOT_SERVING` (primer fallo) o `readiness check failing; …` (el motivo cambió), siempre con un texto fijo y sin credenciales:

```bash
docker compose logs --no-log-prefix --since 5m player-profile-rust-1 player-profile-rust-2 \
  | jq -c 'select(.level=="WARN") | {instance_id: .span.instance_id, message, reason}'
```

| `reason` (log de Rust) | Causa | Sección |
| --- | --- | --- |
| `database unreachable: connection i/o error` | PostgreSQL detenido o inalcanzable **[L]** | 6.1 |
| `migration 0002 has not been applied` | Falta la migración **[L]** | 6.2 |
| `player schema is incomplete, missing tables: …` | Falta una tabla `player.*` **[L]** | 6.2 |
| `database unreachable: database error (sqlstate 28P01)` | La contraseña de `DATABASE_URL` no coincide con el rol **[L]** | 6.5 |
| `DATABASE_URL is not configured` | Variable ausente **[L]** | 6.5 |

### 6.1 PostgreSQL caído

**Síntomas [L].** Envoy pierde ambos hosts en unos 6 s (`/clusters` muestra `health_flags::/failed_active_hc` en cada uno); Go responde `503 {"code":"PROFILE_UNAVAILABLE"}` en perfil y economía mientras `/healthz` y `/readyz` siguen en `200`; `player_profile_health_serving` pasa a `0`; Docker marca ambas Rust `unhealthy` tras unos 40 s (CI mide 48 s en J85: depende del intervalo de 5 s del healthcheck y de sus reintentos). Las carreras activas continúan en Go.

**Diagnóstico.**

```bash
docker compose ps postgres
docker compose logs --tail=50 postgres
docker compose exec -T postgres pg_isready
```

**Recuperación.** `docker compose start postgres` (o `up -d postgres`). No hace falta tocar Rust: se recupera sola. **[L]**: Envoy volvió a ver dos hosts y Docker marcó `healthy` en unos 6 s; el Circuit Breaker de Go se cierra solo con su siguiente sonda (≈10 s) y la API pública vuelve a `200`. Los settlements `pending` los drena Go ([E38](../architecture/resilience-failover-degraded-mode.md)); no acredite a mano.

Si PostgreSQL no vuelve a arrancar y el volumen está dañado, la salida es la restauración de una copia (sección 7), que es **destructiva**.

### 6.2 Esquema o migración incorrectos

**Síntomas [L].** Rust `NOT_SERVING` con `migration 0002 has not been applied` o `player schema is incomplete, missing tables: <tabla>`; Envoy sin hosts; Go `503 PROFILE_UNAVAILABLE`. Pasa en una base nueva donde no corrió `db-migrate`, tras una restauración de una copia antigua o si alguien renombró o borró objetos.

**Diagnóstico** (administrador, dentro del contenedor):

```bash
docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT version FROM public.schema_migrations ORDER BY 1"'   # debe listar 0001 y 0002
docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT tablename FROM pg_tables WHERE schemaname='"'"'player'"'"' ORDER BY 1"'   # nueve tablas
docker compose ps -a db-migrate                                  # ¿terminó con "Exited (0)"?
docker compose logs db-migrate
```

Las nueve tablas son `profiles`, `catalog_versions`, `item_definitions`, `catalog_entries`, `owned_items`, `equipment_slots`, `profile_appearance`, `economic_operations` y `settlements`.

**Recuperación.** Las migraciones son idempotentes y de avance: vuelva a ejecutar el proceso administrativo y espere a la readiness.

```bash
docker compose up -d db-migrate        # [L] repone 0002 y los permisos; no toca datos
docker compose logs --no-log-prefix --since 30s player-profile-rust-1 | jq -c 'select(.message|test("SERVING")) | .message'
```

**[L]**: tras borrar la fila `0002` de `schema_migrations`, `db-migrate` la repuso y Rust volvió a `SERVING` en unos 6 s; tras renombrar `player.settlements`, volvió al restaurar el nombre. `db-migrate` no recrea tablas **renombradas o borradas a mano** con datos: restaure el nombre original o una copia (sección 7). No ejecute SQL de migración a mano sobre la base real, ni un `down`: no existe un rollback automático ([database/README.md](../../database/README.md)).

### 6.3 Rust `NOT_SERVING` (una o ambas réplicas)

Compruebe qué réplica y por qué:

```bash
docker compose ps -a player-profile-rust-1 player-profile-rust-2
for n in 1 2; do docker compose exec -T player-profile-rust-$n /usr/local/bin/player-profile-healthcheck; echo "rust-$n exit=$?"; done
docker compose logs --no-log-prefix --since 5m player-profile-rust-1 | jq -c 'select(.level!="INFO") | {message, reason, error}'
```

- **Una réplica `NOT_SERVING`:** Envoy la excluye tras dos fallos de health (3 s cada uno) y la otra sirve todo. Corrija la causa (tabla 6) y reincorpórela: `docker compose restart player-profile-rust-N` si el proceso quedó en mal estado.
- **Ambas:** la causa es casi siempre compartida (PostgreSQL, esquema o credenciales): 6.1, 6.2 o 6.5. Go queda en modo degradado (`PROFILE_UNAVAILABLE`) pero las carreras siguen.
- **Proceso caído o en reinicio:** `docker compose logs` muestra `invalid configuration` (salida `2`; corrija la variable) o un `panic`/`service terminated with an error` (salida `1`; conserve el log y reporte).

**Recuperación.** `docker compose up -d player-profile-rust-1 player-profile-rust-2`. **[L]**: tras detener y arrancar ambas, Envoy volvió a dos hosts en unos 6 s y, a los ≈12 s, Go respondió `200` otra vez.

### 6.4 Envoy sin hosts

**Síntoma.** Go responde `503 PROFILE_UNAVAILABLE` aunque `docker compose ps` muestre las Rust. Envoy mismo está vivo (`/ready` → `LIVE`): **`/ready` no prueba que haya upstreams**.

```bash
curl -fsS http://127.0.0.1:9901/ready
curl -fsS http://127.0.0.1:9901/clusters | grep -E 'player_profile_cluster::.*(health_flags|rq_total)'
```

Cero líneas `health_flags` (ambas réplicas detenidas) o `health_flags::/failed_active_hc` (health fallido) significa que ninguna réplica está `SERVING`: vaya a 6.3. Si las réplicas están `healthy` en Docker pero Envoy cuenta mal (por ejemplo tres hosts sanos tras reiniciar ambas), revise `ignore_health_on_host_removal: true` en [`infra/envoy/envoy.yaml`](../../infra/envoy/envoy.yaml) ([H69, hallazgo](../evidence/h69-grafana.md)). Si Envoy no responde, `docker compose up -d envoy`.

**Recuperación [L].** Al reiniciar las Rust, Envoy volvió a dos hosts `healthy` en unos 6 s. Go reanuda tras la sonda half-open de su Circuit Breaker (≈10 s).

### 6.5 Credenciales de runtime desalineadas

**Síntoma [L].** Réplica `NOT_SERVING` con `database unreachable: database error (sqlstate 28P01)`; el log no contiene la contraseña. Ocurre si cambió `PLAYER_DB_PASSWORD` sin volver a ejecutar `db-migrate`, o al revés.

**Recuperación (rotación) [L].** Cambie el valor en `.env` y ejecute, en este orden:

```bash
docker compose up -d --force-recreate db-migrate                                  # ALTER ROLE con la contraseña nueva
docker compose up -d --no-deps --force-recreate player-profile-rust-1 player-profile-rust-2
```

(y recree también Go y postgres-exporter si rotó sus contraseñas, según [`database/README.md`](../../database/README.md)). Nunca imprima ni pegue el `.env` en un ticket.

## 7. Copia de seguridad y restauración

> **ADVERTENCIA: LA RESTAURACIÓN ES DESTRUCTIVA.**
> `restore.sh` usa `pg_restore --clean --if-exists`: **borra y reemplaza los objetos y datos de la base destino** por los de la copia. Todo lo escrito después de la copia (perfiles, saldos, settlements, historial de la sala) se pierde. **[L]** en el ensayo: 3 perfiles antes de restaurar, 2 después. Antes de ejecutarla: confirme que `DATABASE_URL` apunta a la base correcta, haga una copia nueva de lo que existe y detenga Go y ambas Rust. No pruebe una copia restaurándola sobre la base en uso: use un proyecto o cluster aislado.

Los scripts leen `DATABASE_URL` del entorno (no la escriben en Git ni en logs) y requieren los clientes de PostgreSQL (`pg_dump`, `pg_restore`) en el host. Aquí `DATABASE_URL` es la del **administrador**:

```bash
export DATABASE_URL="postgresql://<POSTGRES_USER>:<POSTGRES_PASSWORD>@127.0.0.1:5432/<POSTGRES_DB>"
sh database/scripts/backup.sh /ruta/segura/compunube.dump          # pg_dump -Fc; archivo con permisos 0600

docker compose stop match-service-go player-profile-rust-1 player-profile-rust-2
RESTORE_CONFIRM=YES sh database/scripts/restore.sh /ruta/segura/compunube.dump   # DESTRUCTIVO
docker compose up -d --wait player-profile-rust-1 player-profile-rust-2 match-service-go
```

**[L]** (backup y restore con clientes 18.6 del host contra PostgreSQL 17; sin `RESTORE_CONFIRM=YES`, `restore.sh` se niega con código `1`; tras restaurar, ambas Rust volvieron a `healthy`). `pg_dump` no incluye los roles: en un cluster nuevo cree antes los roles con `db-migrate`. Para guardar el volcado solo con Docker, véase [I75](../delivery/installation-and-operation.md#copia-de-seguridad-y-restauración) **[ref]**. El humo E42 prueba backup y restore en bases efímeras en cada CI Integration **[CI]**; `scripts/deploy/deploy.sh` hace además una copia previa a cada actualización ([H66](../deployment/h66-deploy-procedure.md)).

## 8. Alcance no validado

- **Windows 10 y equipos del laboratorio:** ningún comando de esta guía se ha ejecutado en las PC Windows 10 del laboratorio, ni en WSL2 de esos equipos. La auditoría [A05](../deployment/a05-lab-audit.md) está **pendiente y sin datos**; esta guía **no** afirma que funcione allí.
- **Topología física:** [D31](../deployment/d31-topology.md) y [H66](../deployment/h66-deploy-procedure.md) dejan la distribución entre equipos pendiente de A05/H66. La topología validada es un host Docker con ambas réplicas Rust: la caída de una réplica se ha demostrado, **no** la caída de un equipo.
- **Evidencia solo de CI:** I72 e I73 (no se ejecutaron localmente) y las ejecuciones de CI citadas de J83, J85, H68 y H69 son de GitHub Actions (`ubuntu-latest`); ninguna es del laboratorio.
- **Sin re-ejecutar:** F54 y J78 se ejecutaron por última vez en macOS el 2026-10-19, antes de J84 (credenciales por rol); sus scripts se actualizaron en J84 pero no se han vuelto a correr.
- **Sin cubrir aquí:** TLS hacia PostgreSQL (el driver no lo incluye), la cookie `Secure` de Go sobre HTTP en otros equipos ([H66](../deployment/h66-deploy-procedure.md)) y el endurecimiento de puertos publicados.

## 9. Referencias

[D29](../architecture/rust-player-profile-service.md) · [E40](../architecture/health-readiness-design.md) · [E38](../architecture/resilience-failover-degraded-mode.md) · [E41](../architecture/postgresql-schema.md) · [`database/README.md`](../../database/README.md) · [H66](../deployment/h66-deploy-procedure.md) · [I75](../delivery/installation-and-operation.md) · [Diagnóstico general](../operations/troubleshooting.md) · [README del servicio](../../services/player-profile-service-rust/README.md)
