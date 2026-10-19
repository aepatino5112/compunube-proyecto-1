# E41 — Esquema PostgreSQL y ownership de datos

Este diseño convierte el modelo conceptual de [C25](domain-model.md), la arquitectura de [ADR 0003](../adr/0003-primary-distributed-architecture.md) y el diseño de Rust [D29](rust-player-profile-service.md) en un **modelo físico objetivo para PostgreSQL**. E41 fija tablas, claves, restricciones, índices y ownership; **E42** implementará las migraciones versionadas, seeds y recuperación.

La instancia PostgreSQL es físicamente compartida en el laboratorio, pero los datos se separan en dos contextos:

- schema **`match`**, escrito por Go Match Service;
- schema **`player`**, escrito por Rust Player/Profile Service.

No hay estado vivo de carrera por tick en PostgreSQL. Posiciones, inputs, pickups disponibles, timers, persecuciones y conexiones permanecen en memoria autoritativa de Go. La persistencia de `match` conserva identidad de sala/carrera, resultados históricos y estado durable necesario para coordinar settlement; no convierte PostgreSQL en autoridad de simulación.

## Principios de diseño

1. **Ownership por servicio.** Go no hace DML sobre `player`; Rust no hace DML sobre `match`.
2. **IDs compartidos por valor.** `playerId`, `roomId` y `raceId` cruzan fronteras como identificadores opacos, no mediante joins de negocio entre servicios.
3. **Sin claves foráneas entre schemas.** Evita que Rust necesite privilegios sobre `match` o que Go necesite privilegios sobre `player`.
4. **Transacciones en Rust.** Saldo, materiales, propiedad, equipamiento y settlement cambian de forma atómica.
5. **Idempotencia durable.** Operaciones económicas se deduplican por `(player_id, request_id)`; settlement por `(race_id, player_id)`.
6. **Consistencia entre réplicas.** Locks y constraints viven en PostgreSQL, no en memoria de una réplica Rust.
7. **Contratos desacoplados.** Los IDs se almacenan como `TEXT` porque E43 aún no congela formato UUID/ULID ni payloads.
8. **Historial sin Event Sourcing.** Las tablas registran estado durable y operaciones necesarias; no se reconstruye todo el dominio reproduciendo eventos.

## Vista física

```text
PostgreSQL
├── match                         owner lógico: Go
│   ├── rooms
│   ├── races
│   ├── race_participants
│   └── settlement_delivery
└── player                        owner lógico: Rust
    ├── profiles
    ├── catalog_versions
    ├── item_definitions
    ├── catalog_entries
    ├── owned_items
    ├── equipment_slots
    ├── profile_appearance
    ├── economic_operations
    └── settlements
```

## Schema `player` — ownership Rust

### `player.profiles`

Estado económico principal de un jugador.

| Columna | Tipo objetivo | Restricción / uso |
| --- | --- | --- |
| `player_id` | `TEXT` | PK; identidad estable, opaca y no derivada de cosméticos. |
| `coins` | `BIGINT` | NOT NULL DEFAULT 0, CHECK `coins >= 0`. |
| `plastic` | `BIGINT` | NOT NULL DEFAULT 0, CHECK `plastic >= 0`. |
| `metal` | `BIGINT` | NOT NULL DEFAULT 0, CHECK `metal >= 0`. |
| `profile_revision` | `BIGINT` | NOT NULL DEFAULT 0, CHECK `profile_revision >= 0`; aumenta tras una mutación confirmada. |
| `created_at` | `TIMESTAMPTZ` | NOT NULL. |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL. |

No se guardan aquí posición, ranking ni estado de sala. Los contadores locales `totalCleaned` y `races` del prototipo no se convierten automáticamente en autoridad online: si más adelante se requieren estadísticas persistentes, se diseñan a partir de hechos autoritativos y no de `localStorage`.

### `player.catalog_versions`

Versiones publicadas del catálogo económico/cosmético.

| Columna | Tipo objetivo | Restricción / uso |
| --- | --- | --- |
| `catalog_version` | `TEXT` | PK. |
| `active` | `BOOLEAN` | NOT NULL DEFAULT false. |
| `created_at` | `TIMESTAMPTZ` | NOT NULL. |
| `published_at` | `TIMESTAMPTZ` | NULL hasta publicación. |

Un **índice único parcial** permite como máximo una versión `active = true`. La activación concreta se realiza mediante migración/operación administrativa, no desde el cliente.

### `player.item_definitions`

Identidad estable de un objeto a través de versiones de catálogo.

| Columna | Tipo objetivo | Restricción / uso |
| --- | --- | --- |
| `item_id` | `TEXT` | PK. |
| `item_type` | `TEXT` | CHECK entre los tipos soportados por el producto: `character`, `board`, `outfit`, `net`, `hair`. |
| `created_at` | `TIMESTAMPTZ` | NOT NULL. |

Separar identidad y versión permite que un objeto ya poseído siga identificándose aunque cambie descripción, precio o receta en otro catálogo.

### `player.catalog_entries`

Definición versionada de cada objeto.

| Columna | Tipo objetivo | Restricción / uso |
| --- | --- | --- |
| `catalog_version` | `TEXT` | FK → `catalog_versions`. |
| `item_id` | `TEXT` | FK → `item_definitions`. |
| `enabled` | `BOOLEAN` | NOT NULL DEFAULT true. |
| `name` | `TEXT` | NOT NULL. |
| `description` | `TEXT` | NOT NULL DEFAULT ''. |
| `price_coins` | `BIGINT` | NULL o CHECK `>= 0`. |
| `recipe_plastic` | `BIGINT` | NOT NULL DEFAULT 0, CHECK `>= 0`. |
| `recipe_metal` | `BIGINT` | NOT NULL DEFAULT 0, CHECK `>= 0`. |
| `metadata` | `JSONB` | NOT NULL DEFAULT `{}`; atributos visuales no económicos. |

PK compuesta: **`(catalog_version, item_id)`**.

Los valores de precio/receta vienen de datos de referencia del juego; E41 no inventa cantidades. La migración `0002` (F52) publica `online-v1` con las 22 entradas copiadas de `apps/web/dist/economy.js`; `price_coins` NULL significa «no se vende» y una receta > 0 significa «se fabrica». `metadata` guarda como strings `color`, `rarity` (redes) y, en personajes, `gender`, `morph`, `skin`, `hairColor`, `hair`. Reglas como «solo redes son craftables» siguen siendo invariantes de dominio Rust además de los constraints básicos.

### `player.owned_items`

Propiedad durable.

| Columna | Tipo objetivo | Restricción / uso |
| --- | --- | --- |
| `player_id` | `TEXT` | FK → `profiles`. |
| `item_id` | `TEXT` | FK → `item_definitions`. |
| `acquired_at` | `TIMESTAMPTZ` | NOT NULL. |
| `acquisition_type` | `TEXT` | Compra, crafting, base u otra causa controlada por dominio. |

PK compuesta: **`(player_id, item_id)`**. Esta clave es la garantía física de **propiedad única**: un retry no puede crear una segunda propiedad del mismo objeto para el mismo jugador.

Índice adicional: `(item_id, player_id)` para consultas inversas/diagnóstico.

### `player.equipment_slots`

Selección persistente de objetos equipables.

| Columna | Tipo objetivo | Restricción / uso |
| --- | --- | --- |
| `player_id` | `TEXT` | Parte de PK. |
| `slot` | `TEXT` | Parte de PK; `board`, `outfit`, `net`, `hair`, `character`. |
| `item_id` | `TEXT` | Objeto seleccionado. |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL. |

PK: **`(player_id, slot)`**.

FK compuesta **`(player_id, item_id)` → `owned_items(player_id, item_id)`** para impedir equipar un objeto no poseído. Rust valida además que `item_type` corresponda al `slot`; no se introduce trigger para duplicar reglas del dominio.

### `player.profile_appearance`

Apariencia que no se modela como propiedad de item.

| Columna | Tipo objetivo | Restricción / uso |
| --- | --- | --- |
| `player_id` | `TEXT` | PK, FK → `profiles`. |
| `skin_id` | `TEXT` | NOT NULL. |
| `hair_color_id` | `TEXT` | NOT NULL. |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL. |

Los valores permitidos se validan contra la configuración/catálogo confirmado por Rust. E43 decidirá su representación contractual, no E41.

### `player.economic_operations`

Libro técnico de deduplicación para comandos económicos, no Event Sourcing.

| Columna | Tipo objetivo | Restricción / uso |
| --- | --- | --- |
| `player_id` | `TEXT` | FK → `profiles`; parte de PK. |
| `request_id` | `TEXT` | Parte de PK; clave idempotente suministrada por el flujo servidor/cliente validado. |
| `operation_type` | `TEXT` | `buy`, `craft`, `exchange`, `equip`, `appearance`. |
| `request_fingerprint` | `TEXT` | NOT NULL; huella canónica del comando para detectar reutilización conflictiva del mismo requestId. |
| `catalog_version` | `TEXT` | NULL cuando no aplica; FK → `catalog_versions`. |
| `status` | `TEXT` | `applied` o `rejected`; no se deja una operación `applied` sin sus cambios de negocio en la misma transacción. |
| `rejection_code` | `TEXT` | Migración `0002` (F52). NULL salvo `status = 'rejected'` (CHECK en ambos sentidos); CHECK de los 9 códigos de `MutationRejectionCode`. Permite que un retry de una petición rechazada devuelva el mismo código. |
| `profile_revision_after` | `BIGINT` | NULL si no hubo mutación; CHECK `>= 0`. |
| `created_at` | `TIMESTAMPTZ` | NOT NULL. |
| `completed_at` | `TIMESTAMPTZ` | NOT NULL al registrar resultado durable. |

PK: **`(player_id, request_id)`**.

Al recibir de nuevo la misma clave, Rust compara la huella. Misma huella → respuesta coherente sin repetir efectos (éxito o el mismo rechazo almacenado); huella distinta → conflicto de idempotencia (no se almacena: la fila original se conserva). Una versión de catálogo desconocida se rechaza con `catalog_version = NULL` porque la columna es FK. El formato exacto de `requestId` y de la respuesta pertenece a E43.

Índices:
- `(player_id, created_at DESC)`;
- `(status, created_at)` para diagnóstico/operación.

### `player.settlements`

Acreditación autoritativa de resultados enviados por Go.

| Columna | Tipo objetivo | Restricción / uso |
| --- | --- | --- |
| `race_id` | `TEXT` | Parte de PK; valor recibido de Go. |
| `player_id` | `TEXT` | Parte de PK, FK → `profiles`. |
| `result_fingerprint` | `TEXT` | NOT NULL; permite detectar un retry conflictivo para la misma carrera/jugador. |
| `credited_plastic` | `BIGINT` | NOT NULL, CHECK `>= 0`. |
| `credited_metal` | `BIGINT` | NOT NULL, CHECK `>= 0`. |
| `profile_revision_after` | `BIGINT` | NOT NULL, CHECK `>= 0`. |
| `applied_at` | `TIMESTAMPTZ` | NOT NULL. |

PK: **`(race_id, player_id)`**. Esta es la garantía física de settlement único exigida por C25/D29.

No se agrega FK a `match.races`: Rust debe poder operar sin permisos de lectura sobre `match`. Go es quien garantiza que `race_id` y las cantidades acreditables provienen de un `RaceResult` autoritativo. Un retry con la misma huella devuelve el mismo efecto; uno con huella distinta para la misma PK se rechaza y se observa.

Índice adicional: `(player_id, applied_at DESC)`.

## Estrategia transaccional de Rust

Toda operación que pueda cambiar recursos o propiedad sigue esta frontera transaccional:

1. iniciar transacción;
2. obtener/crear el registro de deduplicación según corresponda;
3. bloquear el perfil con `SELECT ... FOR UPDATE` por `player_id`;
4. leer catálogo/propiedad requerida;
5. validar saldo, receta, propiedad e invariantes;
6. aplicar cambios de saldo/propiedad/equipamiento;
7. incrementar `profile_revision`;
8. registrar resultado idempotente en la misma transacción;
9. commit;
10. responder.

Implementación F52: el orden real es `BEGIN` -> `SELECT ... FOR UPDATE` del perfil (creándolo de forma perezosa con 12 objetos base, 5 ranuras y apariencia por defecto, `profile_revision = 1`) -> búsqueda de la operación **bajo ese lock** -> validación -> efecto -> revisión -> registro -> `COMMIT`; las lecturas (`GetProfile`) usan `FOR SHARE`. Los rechazos se registran con `rejection_code` y no mueven la revisión.

El lock por perfil serializa mutaciones concurrentes del mismo jugador aunque lleguen a **réplicas Rust distintas**. Jugadores diferentes no se bloquean entre sí. Las claves únicas siguen siendo la última defensa contra duplicados.

Para settlement se usa la misma idea: insertar/detectar `(race_id, player_id)`, bloquear perfil, aplicar crédito una sola vez, actualizar revisión y confirmar todo en una transacción.

## Schema `match` — ownership Go

### `match.rooms`

Historia mínima de la sala, no su estado realtime completo.

| Columna | Tipo objetivo | Restricción / uso |
| --- | --- | --- |
| `room_id` | `TEXT` | PK. |
| `map_id` | `TEXT` | NOT NULL; mapa fijado para la vida de la sala. |
| `created_at` | `TIMESTAMPTZ` | NOT NULL. |
| `closed_at` | `TIMESTAMPTZ` | NULL mientras no se haya registrado cierre. |

No se persisten aquí `ready`, conexión, countdown ni roster mutable como mecanismo de autoridad. Esos hechos pertenecen al RoomLoop vivo.

### `match.races`

Identidad y versiones congeladas de una carrera.

| Columna | Tipo objetivo | Restricción / uso |
| --- | --- | --- |
| `race_id` | `TEXT` | PK. |
| `room_id` | `TEXT` | FK → `rooms`. |
| `rules_version` | `TEXT` | NOT NULL. |
| `course_version` | `TEXT` | NOT NULL. |
| `started_at` | `TIMESTAMPTZ` | NOT NULL. |
| `first_finished_at` | `TIMESTAMPTZ` | NULL si nadie terminó. |
| `ended_at` | `TIMESTAMPTZ` | NULL hasta cierre global registrado. |

Índices:
- `(room_id, started_at DESC)`;
- `(ended_at DESC)` para historia/operación.

No se escriben posiciones por tick ni snapshots de red en esta tabla.

### `match.race_participants`

Resultado autoritativo final por participante.

| Columna | Tipo objetivo | Restricción / uso |
| --- | --- | --- |
| `race_id` | `TEXT` | FK → `races`; parte de PK. |
| `player_id` | `TEXT` | Parte de PK; referencia opaca, sin FK a `player`. |
| `outcome` | `TEXT` | CHECK: `finished`, `disqualified`, `left`, `dnf`. |
| `rank` | `INTEGER` | NULL salvo `finished`; CHECK `rank > 0` cuando existe. |
| `finish_time_ms` | `BIGINT` | NULL salvo cuando aplica; CHECK `>= 0`. |
| `collected_plastic` | `BIGINT` | NOT NULL DEFAULT 0, CHECK `>= 0`. |
| `collected_metal` | `BIGINT` | NOT NULL DEFAULT 0, CHECK `>= 0`. |
| `credited_plastic` | `BIGINT` | NOT NULL DEFAULT 0, CHECK entre 0 y `collected_plastic`. |
| `credited_metal` | `BIGINT` | NOT NULL DEFAULT 0, CHECK entre 0 y `collected_metal`. |
| `reduce_choice` | `TEXT` | Opción confirmada de esa participación, sin convertirla en saldo/perfil. |
| `recorded_at` | `TIMESTAMPTZ` | NOT NULL. |

PK: **`(race_id, player_id)`**.

Constraints adicionales:

- `outcome = 'finished'` ↔ `rank IS NOT NULL`;
- si `outcome <> 'finished'`, `credited_plastic = 0` y `credited_metal = 0`;
- índice único parcial **`(race_id, rank) WHERE rank IS NOT NULL`** para impedir dos puestos iguales;
- índice `(player_id, recorded_at DESC)` para historia por jugador.

El resultado histórico refleja lo decidido por Go; PostgreSQL no recalcula ranking ni elegibilidad.

### `match.settlement_delivery`

Estado durable de coordinación entre resultado Go y confirmación Rust. No almacena saldo de perfil.

| Columna | Tipo objetivo | Restricción / uso |
| --- | --- | --- |
| `race_id` | `TEXT` | Parte de PK, FK → `races`. |
| `player_id` | `TEXT` | Parte de PK; referencia opaca. |
| `state` | `TEXT` | `pending`, `confirmed` o `failed`. |
| `attempt_count` | `INTEGER` | NOT NULL DEFAULT 0, CHECK `>= 0`. |
| `last_error_code` | `TEXT` | NULL; código técnico controlado, no secreto. |
| `next_attempt_at` | `TIMESTAMPTZ` | NULL; solo coordinación, política concreta pertenece a E38/J77. |
| `confirmed_at` | `TIMESTAMPTZ` | NULL hasta confirmación Rust. |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL. |

PK: **`(race_id, player_id)`**, FK compuesta hacia `race_participants(race_id, player_id)`.

Índice: `(state, next_attempt_at)` para localizar trabajo pendiente. La tabla permite conservar «resultado confirmado / settlement pendiente» sin mantener una RPC dentro del tick ni inventar que el saldo ya fue acreditado.

No es una Saga ni Event Sourcing: es estado de entrega de una operación idempotente ya definida por la arquitectura.

## Separación entre estado vivo y persistente

| Hecho | Dónde vive durante carrera | Persistencia E41 |
| --- | --- | --- |
| Posición, velocidad, energía, salto | Go RoomLoop | No por tick. |
| Inputs y secuencias consumidas | Go RoomLoop/conexión | No como historial de negocio. |
| Pickup disponible/propietario vivo | Go RoomLoop | Resultado agregado final, no cada transición. |
| Vidas/protección/pulpo | Go RoomLoop | Solo outcome/resultados necesarios. |
| Conexión y lease de reentrada | Go runtime | No como autoridad durable. |
| Sala/carrera ID y versiones | Go runtime | `match.rooms`, `match.races`. |
| Resultado final | Go | `match.race_participants`. |
| Estado de entrega de settlement | Go worker/coordinación | `match.settlement_delivery`. |
| Perfil, recursos y propiedad | Rust + PostgreSQL | `player.*`. |
| Catálogo/versiones | Rust + PostgreSQL | `player.catalog_*`. |
| Deduplicación económica | Rust + PostgreSQL | `player.economic_operations`. |
| Acreditación única | Rust + PostgreSQL | `player.settlements`. |

E41 **no promete recuperar una carrera activa después de caída del proceso Go**. Eso sigue fuera del alcance de D28. La persistencia histórica comienza en puntos seguros y no introduce escritura de cada frame.

## Roles y permisos objetivo

E42/H62 deben separar credenciales de aplicación:

| Rol conceptual | Permisos |
| --- | --- |
| `compunube_match_app` | CONNECT; USAGE y DML únicamente sobre schema `match`; sin DML sobre `player`. |
| `compunube_player_app` | CONNECT; USAGE y DML únicamente sobre schema `player`; sin DML sobre `match`. |
| `compunube_migrator` | DDL controlado para migraciones versionadas de ambos schemas durante despliegue. |

Las tablas no deben ser propiedad directa de los roles runtime si eso les permite alterar DDL. Los grants exactos pertenecen a E42.

### Estado actual del repositorio

`database/init/00-bootstrap.sql` ya crea `match` y `player`, pero el `compose.yml` actual entrega el mismo `DATABASE_URL`/usuario de PostgreSQL a Go y Rust. Eso es **bootstrap de desarrollo**, no enforcement material de NFR-DAT-001. E41 registra la brecha; E42/H62 deberán introducir credenciales separadas y validarlas.

## Matriz de acceso

| Dato | Go | Rust | Cliente |
| --- | --- | --- | --- |
| `match.rooms/races/race_participants` | R/W | Sin DML | Sin acceso DB |
| `match.settlement_delivery` | R/W | Sin DML | Sin acceso DB |
| `player.profiles/inventory/ownership` | Sin DML; consulta vía Rust | R/W | Sin acceso DB |
| `player.catalog_*` | Sin DML; consulta vía Rust | R/W | Sin acceso DB |
| `player.economic_operations` | Sin DML | R/W | Sin acceso DB |
| `player.settlements` | Sin DML; confirmación vía RPC | R/W | Sin acceso DB |

No se diseñan views cruzadas para saltarse la frontera. Los servicios intercambian información por contratos, no por SQL compartido.

## Invariantes que deben probar E42/F52/F55

- saldo/materiales nunca negativos;
- `(player_id, item_id)` único en propiedad;
- equipamiento exige propiedad;
- `(player_id, request_id)` deduplica una operación económica incluso con requests concurrentes;
- misma clave idempotente con payload distinto se rechaza;
- `(race_id, player_id)` acredita settlement una sola vez;
- timeout posterior al commit + retry no duplica recursos;
- DNF/`disqualified`/`left` conservan recogidas históricas pero acreditan cero;
- solo `finished` tiene puesto numérico;
- dos participantes no comparten el mismo puesto de una carrera;
- Go runtime no puede escribir `player` con su rol de aplicación;
- Rust runtime no puede escribir `match`;
- dos réplicas Rust concurrentes conservan las mismas invariantes gracias a transacciones/constraints de PostgreSQL.

## Alcance y diferidos

E41 **sí congela**:

- tablas lógicas y relaciones objetivo;
- claves primarias/foráneas dentro de cada ownership;
- constraints de propiedad, resultado e idempotencia;
- índices mínimos;
- estrategia de lock transaccional por perfil;
- ausencia de FK entre `match` y `player`;
- roles separados como objetivo de enforcement.

E41 **no implementa**:

- migraciones, seeds, grants ni rollback: **E42**;
- nombres/mensajes RPC, `requestId` wire format ni códigos de error: **E43**;
- repositories SQL de Rust/Go: **F52/F55**;
- retry/circuit breaker: **E38/J77**;
- backup/restauración: **E42/F55**;
- persistencia de cada snapshot/tick o recuperación de carrera activa tras caída de Go.

Los tipos y nombres físicos finales se materializarán en migraciones E42 conservando estas invariantes. Si E43 cambia el formato externo de un identificador, puede adaptarse en el borde sin reabrir ownership o idempotencia.
