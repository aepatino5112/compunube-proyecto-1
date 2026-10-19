# D29 — Rust Player/Profile Service replicable

Este diseño desarrolla la frontera persistente definida por [C25](domain-model.md) y [ADR 0003](../adr/0003-primary-distributed-architecture.md). Rust es responsable del perfil y la economía durable del jugador; **no participa en el tick de carrera, no recalcula resultados y no conserva estado crítico exclusivo en una réplica**. El contrato gRPC definitivo pertenece a E43 y el diseño físico de PostgreSQL pertenece a E41.

## Responsabilidad del servicio

El Player/Profile Service concentra operaciones cuyo resultado debe sobrevivir reinicios y ser consistente entre clientes y réplicas:

| Área | Responsabilidad de Rust |
| --- | --- |
| Perfil | Consultar identidad persistente, recursos y revisión del perfil. |
| Inventario | Consultar materiales, monedas y propiedad durable. |
| Catálogo | Exponer elementos/versiones habilitados para operaciones de perfil. |
| Equipamiento y apariencia | Validar propiedad y guardar selección persistente. |
| Compra | Validar catálogo, saldo y propiedad; aplicar el cambio de forma atómica. |
| Crafting | Validar receta/materiales; descontar y acreditar el resultado en una sola transacción. |
| Canje | Convertir materiales según reglas de catálogo vigentes sin aceptar saldos declarados por cliente. |
| Settlement | Acreditar una sola vez el resultado autoritativo recibido desde Go. |

Go conserva salas, participantes, carrera viva, pickups, ranking y `RaceResult`. El frontend nunca invoca Rust directamente ni declara premios, materiales acreditables o saldo final.

## Casos de uso de aplicación

D29 fija los casos de uso conceptuales que deberá exponer la capa de aplicación. E43 decidirá nombres RPC, mensajes y versionado.

### Consultas

- obtener perfil por `playerId`;
- obtener inventario/propiedad;
- obtener catálogo y versión activa;
- obtener equipamiento/apariencia confirmados.

Las consultas pueden usar caché como optimización futura, pero una caché local de instancia **nunca es la única fuente de verdad** ni puede volver no reemplazable a una réplica.

### Comandos de perfil y economía

- comprar un elemento;
- fabricar mediante una receta;
- canjear materiales;
- equipar o cambiar apariencia;
- aplicar settlement de carrera.

Cada comando valida el estado durable dentro del servicio. El cliente no puede enviar un saldo nuevo como hecho consumado y Go no escribe directamente el esquema privado de Rust.

## Capas e interfaces internas

La implementación deberá mantener separadas cuatro responsabilidades:

```text
gRPC transport / adapters
          |
          v
Application use cases
          |
          v
Domain rules
          |
          v
Repository ports
          |
          v
PostgreSQL adapter
```

### Transporte/adaptadores

- reciben solicitudes gRPC desde Go a través de Envoy;
- validan formato, versión y contexto definidos finalmente por E43;
- convierten errores internos a códigos contractuales sin filtrar detalles de PostgreSQL;
- propagan IDs de correlación y deadlines;
- no contienen reglas económicas duplicadas.

### Aplicación

Orquesta transacciones y casos de uso. Ejemplos conceptuales:

- `GetProfile`;
- `GetCatalog`;
- `BuyItem`;
- `CraftItem`;
- `ExchangeMaterials`;
- `EquipItem`;
- `SetAppearance`;
- `SettleRace`.

Los nombres son descriptivos y **no congelan** las RPC de E43.

### Dominio

Contiene invariantes independientes del transporte:

- ningún recurso queda negativo;
- no se equipa un elemento no poseído;
- una compra/craft/canje usa reglas de catálogo válidas;
- una operación económica no se aplica dos veces;
- un settlement no modifica ranking ni reinterpreta pickups;
- `disqualified`, `left` y `dnf` no generan materiales acreditables;
- la selección cosmética no altera autoridad ni resultado de carrera.

### Puertos de repositorio

D29 define responsabilidades, no tablas ni SQL. Como mínimo la implementación necesitará puertos equivalentes a:

- **PlayerProfileRepository:** cargar/actualizar perfil y revisión;
- **InventoryRepository:** consultar y modificar recursos/propiedad dentro de una transacción;
- **CatalogRepository:** consultar catálogo/versiones/reglas activas;
- **EconomicOperationRepository:** registrar/deduplicar comandos económicos por identificador estable;
- **SettlementRepository:** detectar y registrar la acreditación única de una carrera para un jugador.

E41 decidirá tablas, columnas, claves, índices y restricciones físicas. La capa de aplicación no debe depender de SQL disperso fuera de estos adaptadores.

## Transacciones e idempotencia

Las operaciones que cambian saldo, materiales, propiedad o equipamiento se ejecutan como **unidad atómica**: se confirma todo o no se confirma nada.

### Comandos económicos

Los comandos reintentables deberán incluir un identificador estable de solicitud acordado en E43. Conceptualmente:

1. Rust recibe `requestId` y `playerId`.
2. Comprueba si la operación ya fue aplicada.
3. Si existe, devuelve un resultado coherente con la operación original sin repetir efectos.
4. Si no existe, valida reglas y estado actual.
5. Aplica los cambios y registra la deduplicación en la misma frontera transaccional.
6. Solo después del commit responde éxito.

E41 decide cómo representar físicamente la deduplicación.

### Settlement

La identidad conceptual de un settlement es **`(raceId, playerId)`**. Repetir la misma solicitud, incluso tras un timeout posterior al commit, debe producir una única modificación durable.

Rust confía en el resultado emitido por Go dentro del flujo servidor autorizado; no acepta un settlement directo del cliente. La política de retry corresponde a E38/J77 y solo puede habilitarse de forma compatible con esta idempotencia.

## Acceso y ownership de PostgreSQL

Rust escribe únicamente el contexto lógico `player`. No escribe estado vivo de `match` y no necesita leer cada tick de carrera.

Reglas de acceso:

- PostgreSQL es la fuente durable para perfil/economía/settlement;
- credenciales, host, puerto y límites se suministran por configuración externa;
- ninguna réplica depende de disco local para recuperar estado de negocio;
- las transacciones de escritura se ejecutan contra PostgreSQL antes de responder confirmación;
- los errores de base de datos se convierten en errores de servicio controlados;
- pool de conexiones y límites son configurables por instancia;
- E41 definirá permisos, constraints e índices concretos.

Compartir físicamente una instancia PostgreSQL no elimina el ownership lógico: Go no modifica datos privados de `player` y Rust no toma autoridad sobre `match`.

## Replicabilidad

Una instancia Rust es **reemplazable** si otra instancia con la misma versión/configuración puede atender la siguiente solicitud usando PostgreSQL como fuente durable.

Por tanto, una réplica no puede depender para corrección de:

- sesiones guardadas solo en memoria;
- saldos o inventarios solo en memoria;
- una cola local como único registro de settlement;
- archivos locales con catálogo o propiedad que no puedan reconstruirse;
- sticky sessions como requisito funcional.

Puede existir estado efímero por rendimiento —pool de conexiones, caché no autoritativa, métricas o buffers— siempre que perderlo no cambie el resultado durable ni impida que otra réplica continúe.

Envoy podrá distribuir solicitudes entre réplicas saludables. La semántica exacta de health/readiness pertenece a E40 y el failover/retry a E38/J78.

## Reinicio y fallo de instancia

### Reinicio limpio

1. La instancia deja de aceptar trabajo nuevo.
2. Las solicitudes en curso terminan o son canceladas según el deadline disponible.
3. Se cierran recursos locales.
4. Al arrancar de nuevo, la instancia reconstruye su capacidad desde configuración y PostgreSQL.
5. No necesita recuperar estado crítico desde memoria previa.

### Caída durante una operación

- **Antes del commit:** no debe quedar un efecto parcial durable.
- **Después del commit y antes de responder:** el llamador puede no saber si se aplicó; un retry con la misma clave idempotente debe recuperar una respuesta coherente sin duplicar efectos.
- **Caída de una sola réplica:** Envoy puede excluirla y dirigir solicitudes posteriores a otra instancia.
- **Caída de todas las réplicas:** perfil/economía/settlement quedan temporalmente indisponibles, pero Go mantiene las carreras activas y sus resultados; no se muestra saldo ficticio.

Un settlement puede quedar pendiente de confirmación sin alterar el resultado autoritativo de la carrera.

## Concurrencia

Varias réplicas pueden recibir operaciones sobre el mismo jugador. La corrección no puede depender de que todas las solicitudes lleguen a una única instancia.

La implementación deberá apoyarse en transacciones y restricciones durables para evitar:

- doble gasto;
- doble acreditación;
- propiedad duplicada cuando deba ser única;
- pérdida de actualización;
- settlement duplicado.

E41 definirá la estrategia física y las restricciones SQL; D29 fija que la consistencia se resuelve en la frontera transaccional de PostgreSQL, no con locks de memoria entre réplicas.

## Errores y observabilidad

Cada solicitud debe poder correlacionarse entre Go, Envoy, Rust y PostgreSQL sin registrar secretos. Como mínimo se deberá poder observar:

- operación/caso de uso;
- `playerId` y, cuando aplique, `raceId`/`requestId` de forma segura;
- resultado lógico;
- duración;
- error gRPC categorizado;
- error/latencia de PostgreSQL;
- hits de deduplicación;
- settlements aplicados/repetidos;
- estado de health/readiness por instancia.

Los nombres de métricas, códigos gRPC y umbrales quedan para E40/E43 y las tareas de implementación.

## Validación de replicabilidad

D29 se considera implementable si el siguiente comportamiento puede demostrarse después:

1. arrancar dos instancias Rust equivalentes detrás de Envoy;
2. ejecutar una operación durable en una de ellas;
3. detener esa instancia;
4. repetir/consultar desde la otra;
5. obtener estado consistente desde PostgreSQL;
6. repetir un comando idempotente sin duplicar efecto;
7. detener todas las réplicas y comprobar que Go mantiene una carrera activa en modo degradado.

La topología física y los puertos finales pertenecen a D31; esta validación puede realizarse primero en el entorno local/Compose.

## Estado de implementación (F47 + F52)

F47 dejó la base modular del servicio; **F52 implementa las ocho RPC de `compunube.player.v1`** (`GetProfile`, `GetCatalog`, `BuyItem`, `CraftItem`, `ExchangeMaterials`, `EquipItem`, `SetAppearance`, `SettleRace`) sobre `player.*`. Los *seams* `UNIMPLEMENTED` y el `Infallible` de F47 ya no existen.

| Módulo (`services/player-profile-service-rust/src`) | Capa D29 | Contenido actual |
| --- | --- | --- |
| `transport/` | Transporte/adaptadores | Servicio Tonic generado desde `proto/player_profile.proto` (`build.rs`, sin stubs versionados). `mapping.rs`: traducción pura mensaje <-> tipos de aplicación y decodificación de enums (`UNSPECIFIED`/desconocido -> `INVALID_ARGUMENT`). `error.rs`: tabla de estados E43. Sin reglas de negocio. |
| `application/` | Aplicación | Un caso de uso por RPC. Valida la forma de la petición y orquesta una transacción por operación a través de los puertos; los rechazos de negocio son resultados (`MutationOutcome`, `SettlementOutcome`), no errores. |
| `domain/` | Dominio | Reglas puras y sin I/O: catálogo (`catalog`), economía (`economy`: compra, craft, canje, equipar, apariencia), apariencia (`appearance`), huellas (`fingerprint`), liquidación (`settlement`), aprovisionamiento (`provisioning`) y validación estructural (`validation`). |
| `repository/` | Puertos | `CatalogRepository`, `TransactionManager` y `EconomyTransaction` (bloqueo de perfil, búsqueda de operación/liquidación, catálogo, aplicar efecto, registrar, `commit`). Descartar la transacción sin `commit` hace rollback. |
| `repository/postgres/` | Adaptador PostgreSQL | Pools `sqlx` perezosos, sondeo de readiness y todo el SQL. **Único lugar con SQL**; solo `player.*` más lectura de `public.schema_migrations`; nunca `match.*`. Consultas en tiempo de ejecución, sin macros de compilación. |
| `health.rs`, `runtime.rs` | Ciclo de vida | Bucle de sondeo, estado `player_profile` y apagado ordenado. |

Pruebas estructurales (`tests/architecture.rs`) verifican que `application`, `domain` y `transport` no dependan de SQL y que ninguna fuente referencie el schema `match`.

### Reglas de economía (catálogo `online-v1`)

Los valores salen de `apps/web/dist/economy.js` y `appearance.js` y los publica la migración `0002` (ver [E41](postgresql-schema.md) y [`database/README.md`](../../database/README.md)); no se inventa ninguno.

- **Perfil inicial (aprovisionamiento perezoso):** cualquier RPC salvo `GetCatalog` crea el perfil en una transacción si no existe: monedas/plástico/metal en 0, `profile_revision = 1`, 12 objetos base (`coral`, `costero`, `red-base`, los 5 peinados y los 4 personajes, `acquisition_type = 'base'`), 5 ranuras equipadas (`coral`, `costero`, `red-base`, `swept`, `nico`) y apariencia `medium`/`brown`. El aprovisionamiento concurrente es idempotente (`ON CONFLICT DO NOTHING` + relectura).
- **Compra:** solo si el catálogo da precio y no hay receta; **craft:** solo objetos con receta (las redes). Nada queda negativo (dominio + `CHECK`).
- **Canje:** 4 monedas por plástico y 6 por metal. No tiene tabla: son constantes del dominio ligadas a `online-v1`. Cantidad 0, `>= 1e9` o material `UNSPECIFIED` -> `INVALID_ARGUMENT`.
- **Equipar:** solo objetos poseídos y en la ranura de su propio tipo; equipar un personaje fija además su peinado y apariencia (como `economy.js`). Equipar lo ya equipado se aplica.
- **Apariencia:** 5 tonos de piel y 6 colores de cabello (constantes). Un valor fuera de la lista -> `INVALID_APPEARANCE`.
- **Orden de rechazo:** `INVALID_CATALOG_VERSION` -> `INVALID_ITEM` -> `ALREADY_OWNED`/`NOT_OWNED` -> `INVALID_ACTION` -> `INSUFFICIENT_COINS`/`INSUFFICIENT_MATERIALS`. Una versión de catálogo sin publicar, desconocida o vacía es `INVALID_CATALOG_VERSION`.
- **Revisión:** `+1` en cada mutación aplicada (también equipar/apariencia sin cambio efectivo) y en cada liquidación con crédito > 0; rechazos, replays y liquidaciones de crédito 0 no la mueven.
- **Catálogo:** `GetCatalog` vacío devuelve la versión activa (`online-v1`); una versión inexistente o sin publicar es `NOT_FOUND`. Los objetos salen en un orden determinista (tipo, precio, receta, id) y `metadata` ordenada por clave.

### Transacciones e idempotencia

Cada mutación y cada liquidación es una única transacción:

1. `BEGIN`;
2. `SELECT ... FOR UPDATE` del perfil (aprovisionándolo si hace falta): serializa a **todas** las mutaciones del mismo jugador, también entre réplicas;
3. búsqueda de la operación `(player_id, request_id)` (o la liquidación `(race_id, player_id)`) **bajo ese bloqueo**, de modo que dos réplicas con el mismo identificador se serializan y la segunda encuentra el registro de la primera;
4. validación con reglas de dominio contra una versión de catálogo;
5. aplicar efecto, incrementar la revisión y registrar el resultado (`economic_operations` / `settlements`);
6. `COMMIT`.

Duplicados:

| Caso | Resultado |
| --- | --- |
| mismo `request_id`, mismo payload | `replayed = true`, sin efecto adicional; el perfil devuelto es el actual (no se guarda una foto por operación). |
| mismo `request_id`, payload distinto (la huella incluye la operación, la versión de catálogo y los campos) | rechazo `IDEMPOTENCY_CONFLICT`; el registro original no se toca ni se guarda nada nuevo. |
| petición rechazada y repetida | el mismo rechazo con `replayed = true` aunque el estado haya cambiado (`economic_operations.rejection_code`, migración `0002`). |
| liquidación repetida | `replayed = true`; datos distintos para el mismo `(race_id, player_id)` -> `CONFLICT`. |
| liquidación no `finished` con crédito > 0 | `INVALID_SETTLEMENT` (no se guarda; la clave puede reutilizarse con datos válidos). `disqualified`/`left`/`dnf` con crédito 0 se registran sin tocar saldos ni revisión. |

La huella es SHA-256 hexadecimal de líneas canónicas `campo=<longitud>:<valor>` (el prefijo de longitud impide colisiones por fronteras entre campos). Las constraints (`PK`, `CHECK >= 0`, FK de equipamiento) siguen siendo la última defensa.

Errores de sistema: `INVALID_ARGUMENT` (ids vacíos, de más de 128 bytes o con caracteres de control, enums `UNSPECIFIED`, cantidades fuera de rango), `NOT_FOUND` (versión de catálogo inexistente en `GetCatalog`), `UNAVAILABLE`/`RESOURCE_EXHAUSTED`/`DEADLINE_EXCEEDED`/`INTERNAL` según el fallo de PostgreSQL (incluye `serialization_failure`/`deadlock_detected` como reintentables) sin filtrar SQL.

### Pruebas con PostgreSQL

Las pruebas de base de datos (`tests/db_*.rs`, `economy_*.rs`, `grpc_economy.rs`, `two_instances.rs`) usan `PLAYER_TEST_DATABASE_URL`, que debe apuntar a una base migrada con `database/scripts/migrate.sh` (usan ids únicos por prueba y no dependen del orden). Sin la variable se omiten con un aviso visible; con `PLAYER_TEST_REQUIRE_DB=1` su ausencia falla (CI lo fija). En local:

```bash
POSTGRES_PORT=55433 docker compose -p compunube-f52-test up -d postgres --wait
DATABASE_URL=postgresql://compunube:compunube_dev@127.0.0.1:55433/compunube sh database/scripts/migrate.sh
PLAYER_TEST_DATABASE_URL=postgresql://compunube:compunube_dev@127.0.0.1:55433/compunube cargo test --locked
docker compose -p compunube-f52-test down -v
```

`ci-rust.yml` levanta un servicio PostgreSQL, aplica `database/init/00-bootstrap.sql` y las migraciones y ejecuta `cargo test --locked` con esa base. Cubren, entre otras cosas: perfil inicial, catálogo, las cinco mutaciones y la liquidación, replay/conflicto/rechazo repetido, concurrencia sobre el mismo perfil, dos instancias con pools distintos, reinicio y salud al perder y recuperar la base.

### Configuración

| Variable | Defecto | Uso |
| --- | --- | --- |
| `SERVICE_ADDR` | `0.0.0.0:50051` | Dirección gRPC. |
| `METRICS_ADDR` | `0.0.0.0:9100` | Listener HTTP de `GET /metrics` (Prometheus), separado del gRPC. Debe diferir de `SERVICE_ADDR`; si no se puede enlazar el servicio no arranca. |
| `INSTANCE_ID` | `rust-local` | Identidad de la réplica en logs y en la etiqueta `instance_id` de las métricas. |
| `DATABASE_URL` | sin valor | Conexión PostgreSQL. Nunca se imprime (`Debug`/`Display` redactados). |
| `DB_POOL_MAX_CONNECTIONS` / `DB_POOL_MIN_CONNECTIONS` | `10` / `0` | Límites del pool de negocio por instancia. |
| `DB_POOL_ACQUIRE_TIMEOUT_MS` | `3000` | Espera máxima por una conexión. |
| `HEALTH_PROBE_INTERVAL_MS` / `HEALTH_PROBE_TIMEOUT_MS` | `2000` / `1000` | Frecuencia y límite de cada sondeo. |
| `SHUTDOWN_DRAIN_TIMEOUT_MS` | `8000` | Tiempo máximo para que terminen las RPC en curso. |

Un valor numérico inválido detiene el arranque. Un `DATABASE_URL` ausente o inválido **no**: el servicio arranca y permanece `NOT_SERVING` con el motivo en logs, sin la URL. El servicio no ejecuta migraciones; E42 se aplica con `database/scripts/migrate.sh`. El driver no incluye TLS: los URLs con `sslmode=require` fallan hasta que un requisito concreto lo justifique.

### Ciclo de vida

1. `player_profile` (y el nombre vacío) arrancan en `NOT_SERVING`.
2. Un bucle de fondo usa un pool aislado de una conexión, distinto del pool de negocio, y comprueba `SELECT 1`, la versión `0002` en `public.schema_migrations` (publica el catálogo `online-v1` y el almacenamiento de rechazos; requiere `0001`) y las nueve tablas `player.*`. Pasa a `SERVING` solo si todo cumple, vuelve a `NOT_SERVING` ante cualquier fallo o timeout y se recupera solo; por eso una réplica levantada antes de migrar se vuelve `SERVING` después de `migrate.sh` sin reiniciar.
3. Ante SIGTERM o SIGINT: se publica `NOT_SERVING` (los sondeos posteriores se ignoran), se dejan de aceptar conexiones nuevas, las RPC en curso terminan dentro de `SHUTDOWN_DRAIN_TIMEOUT_MS`, se cierran los pools y por último se detiene el listener de métricas (así el drenaje sigue siendo observable).

Los logs son JSON (`tracing`); `service=player-profile-service` e `instance_id` viajan en el span raíz (`span.service`, `span.instance_id`) y ninguna línea incluye credenciales. Ver [Observabilidad](#observabilidad-h67) para la línea por solicitud.

### Observabilidad (H67)

**Endpoint.** Cada réplica sirve `GET /metrics` (formato texto de Prometheus, `text/plain; version=0.0.4`) en `METRICS_ADDR` (por defecto **`0.0.0.0:9100`**), un listener HTTP propio y distinto del gRPC `50051`. No toca PostgreSQL: responde aunque la base esté caída, y se detiene al final del apagado ordenado. Es interno: Envoy no lo enruta (se scrapea cada réplica por su nombre, no a través del balanceador) y `compose.yml` no lo publica al host. `HEAD /metrics` responde solo cabeceras; cualquier otra ruta da `404` y otro método `405`.

**Etiquetas constantes** en todas las series: `service="player-profile-service"` e `instance_id` (el `INSTANCE_ID` de la réplica: `rust-1`, `rust-2`). Ninguna serie lleva `player_id`, `request_id`, `race_id`, versión de catálogo, tokens, SQL ni mensajes de error (cardinalidad y privacidad). La etiqueta `code` solo toma valores de enums cerrados: códigos de rechazo de negocio (`INSUFFICIENT_COINS`, `IDEMPOTENCY_CONFLICT`, `INVALID_SETTLEMENT`, `CONFLICT`, ...) y nombres de estado gRPC (`INVALID_ARGUMENT`, `NOT_FOUND`, `DEADLINE_EXCEEDED`, `RESOURCE_EXHAUSTED`, `UNAVAILABLE`, `INTERNAL`), más `OK` y `CANCELLED`.

| Métrica | Tipo | Etiquetas (además de las constantes) | Significado |
| --- | --- | --- | --- |
| `player_profile_up` | gauge | | Siempre `1` mientras el proceso corre. |
| `player_profile_rpc_requests_total` | counter | `rpc`, `outcome`, `code` | RPC terminadas. `outcome`: `applied`, `rejected` (rechazo de negocio en el cuerpo, gRPC OK), `replayed` (ya resuelta antes), `conflict` (misma clave con datos distintos) o `error` (estado gRPC distinto de OK o cancelada). |
| `player_profile_rpc_duration_seconds` | histogram | `rpc` | Duración de la RPC incluida la transacción (buckets de 1 ms a 5 s). |
| `player_profile_rpc_in_flight` | gauge | `rpc` | RPC en curso por método. |
| `player_profile_idempotency_replays_total` | counter | `operation` | Solicitudes respondidas desde una anterior idéntica. `operation`: `buy`, `craft`, `exchange`, `equip`, `appearance`, `settle_race`. |
| `player_profile_idempotency_conflicts_total` | counter | `operation` | Reutilización de clave con datos distintos. |
| `player_profile_settlements_total` | counter | `outcome` | Resultado de `SettleRace`: `credited`, `replayed`, `conflict`, `invalid`. |
| `player_profile_db_pool_connections` | gauge | | Conexiones abiertas del pool de negocio (inactivas + en uso). |
| `player_profile_db_pool_idle_connections` | gauge | | Conexiones abiertas sin trabajo. |
| `player_profile_db_pool_in_use_connections` | gauge | | Conexiones ejecutando una consulta o transacción. |
| `player_profile_db_pool_max_connections` | gauge | | Máximo configurado (`DB_POOL_MAX_CONNECTIONS`). Sin `DATABASE_URL` válido, los cuatro gauges del pool valen `0`. |
| `player_profile_health_serving` | gauge | | `1` si la réplica publica `SERVING` en gRPC Health, `0` si `NOT_SERVING` (incluye arranque y apagado). |
| `player_profile_health_probe_failures_total` | counter | | Sondeos de readiness fallidos (base inalcanzable, migración ausente, timeout). |

Las series sin eventos aún (por RPC, operación, resultado de settlement, pool, health) existen desde el primer scrape en `0`. Cada `SettleRace` repetida o en conflicto también se cuenta en las métricas de idempotencia con `operation="settle_race"`. El pool se lee en cada scrape; el contador de replays no distingue si el rechazo repetido era de negocio o un éxito.

**Logs.** Una línea JSON por RPC, mensaje `rpc completed`, con `service`, `instance_id`, `rpc`, `outcome`, `code`, `error_class` (`none`, `business`, `client`, `server`, `cancelled`) y `latency_ms`. Nivel `info` para éxitos y rechazos de negocio, `warn` para errores de cliente, cancelaciones y fallos de servidor, `error` para `INTERNAL`. No incluye `player_id`, `request_id`, `race_id`, payloads, SQL ni `DATABASE_URL`; el detalle saneado de un `INTERNAL` se registra aparte, sin esos campos.

**Correlación.** No existe hoy un identificador de correlación en `proto/` ni en Go, así que Rust no captura ninguno; añadirlo es una decisión de contrato (E43) que no forma parte de H67.

**Scrape para H68** (Prometheus, red de Compose; los servicios se llaman `player-profile-rust-1` y `-2`):

```yaml
scrape_configs:
  - job_name: player-profile-rust
    metrics_path: /metrics
    static_configs:
      - targets: ["player-profile-rust-1:9100", "player-profile-rust-2:9100"]
```

Las etiquetas `service` e `instance_id` ya vienen en cada serie, así que no hace falta `relabel_configs` para distinguir réplicas. Consultas útiles: tasa de errores `sum by (instance_id, rpc) (rate(player_profile_rpc_requests_total{outcome="error"}[5m]))`, latencia p95 `histogram_quantile(0.95, sum by (le, rpc) (rate(player_profile_rpc_duration_seconds_bucket[5m])))`, saturación del pool `player_profile_db_pool_in_use_connections / player_profile_db_pool_max_connections` y réplicas fuera de servicio `player_profile_health_serving == 0`. Configurar Prometheus/Grafana y publicar el puerto es trabajo de H68/H69; este cambio no los toca.

### Pendiente

- Deadlines y correlación propagados por operación: dependen de un identificador de correlación que el contrato aún no define (ver [Observabilidad](#observabilidad-h67)). Las métricas de deduplicación/settlement, pool y health ya se exponen en `/metrics`.
- Credenciales LOGIN separadas por rol runtime (H62) y TLS hacia PostgreSQL cuando haya un requisito concreto.

## Límites de D29

D29 **no** congela:

- tablas, columnas, índices, permisos ni migraciones de E41/E42;
- mensajes, RPC, códigos o compatibilidad de E43;
- valores concretos de timeout/retry/circuit breaker de E38;
- health checks definitivos de E40;
- código Rust de F47/F52;
- política física de réplicas/puertos de D31.

Sí congela la responsabilidad funcional, las capas, la necesidad de idempotencia/transacciones, el comportamiento ante reinicio y la condición de que cualquier réplica sea reemplazable sin perder estado crítico.
