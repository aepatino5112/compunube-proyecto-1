# Contratos gRPC internos — E43

`player_profile.proto` es la fuente normativa de la frontera **Go Match Service → Envoy → Rust Player/Profile Service**.

## Versión

- Package: `compunube.player.v1`.
- `v1` es la versión mayor del contrato gRPC.
- Se permiten adiciones compatibles: nuevos campos con field numbers nuevos, nuevos RPC opcionales y nuevos valores de enum que el consumidor trate de forma segura.
- No se reutilizan field numbers eliminados.
- Cambiar tipo/semántica, quitar un campo requerido por la aplicación o romper un RPC existente exige `compunube.player.v2`.
- `rulesVersion`, `courseVersion` y `catalogVersion` son versiones de dominio, no del Protobuf.

## Ownership

Go consume este contrato; Rust implementa el servicio. El cliente web/Python **no habla gRPC con Rust**.

RPC v1:

- `GetProfile`
- `GetCatalog`
- `BuyItem`
- `CraftItem`
- `ExchangeMaterials`
- `EquipItem`
- `SetAppearance`
- `SettleRace`

No hay RPC de tick, sala, ranking o pickups. Rust no recibe posición ni recalcula el resultado.

## Idempotencia

### Mutaciones económicas

`BuyItem`, `CraftItem`, `ExchangeMaterials`, `EquipItem` y `SetAppearance` reciben:

- `player_id`;
- `request_id`;
- `catalog_version`;
- intención mínima de la operación.

La clave durable es **`(player_id, request_id)`**. El mismo ID + mismo comando devuelve un resultado coherente con `replayed = true` sin repetir efectos. El mismo ID con payload distinto produce `MUTATION_REJECTION_IDEMPOTENCY_CONFLICT`.

Un rechazo de negocio viaja dentro de `ProfileMutationResponse` con status gRPC **OK**, porque es un resultado determinista de la operación y debe poder reproducirse en un retry.

### Settlement

`SettleRace` usa **`(race_id, player_id)`** como clave idempotente. Go envía `outcome` y únicamente las cantidades **credited** ya decididas por Go:

- `finished`: puede tener materiales > 0;
- `disqualified`, `left`, `dnf`: deben llevar 0.

Repetir el mismo settlement devuelve `replayed = true`. Mismo `(race_id, player_id)` con datos diferentes devuelve `SETTLEMENT_REJECTION_CONFLICT`.

Rust no recalcula rank, pickups ni elegibilidad desde datos del cliente.

## Errores

Los errores de negocio idempotentes se modelan en el response:

### MutationRejectionCode

- `MUTATION_REJECTION_INVALID_ACTION`
- `MUTATION_REJECTION_INVALID_ITEM`
- `MUTATION_REJECTION_INSUFFICIENT_COINS`
- `MUTATION_REJECTION_INSUFFICIENT_MATERIALS`
- `MUTATION_REJECTION_NOT_OWNED`
- `MUTATION_REJECTION_ALREADY_OWNED`
- `MUTATION_REJECTION_INVALID_APPEARANCE`
- `MUTATION_REJECTION_IDEMPOTENCY_CONFLICT`
- `MUTATION_REJECTION_INVALID_CATALOG_VERSION`

### SettlementRejectionCode

- `SETTLEMENT_REJECTION_INVALID_SETTLEMENT`
- `SETTLEMENT_REJECTION_CONFLICT`

Los fallos de transporte/sistema usan códigos gRPC estándar:

| gRPC status | Uso |
| --- | --- |
| `INVALID_ARGUMENT` | request estructuralmente inválido: ID vacío, enum UNSPECIFIED donde no aplica, amount inválido, etc. |
| `NOT_FOUND` | perfil o versión de catálogo solicitada no existe. |
| `DEADLINE_EXCEEDED` | el deadline del llamador venció; el llamador no presume rollback si la operación pudo alcanzar commit. |
| `RESOURCE_EXHAUSTED` | límite interno/pool saturado. |
| `UNAVAILABLE` | Rust/PostgreSQL temporalmente no disponible. |
| `INTERNAL` | error no esperado; no se filtran detalles SQL. |

Go mapea estos resultados a la frontera pública en J77/E45. No se documentan como Swagger gRPC.

## Catálogo y perfil

`PlayerProfile` contiene únicamente estado online confirmado:

- balances virtuales;
- revisión;
- propiedad;
- equipo;
- apariencia.

No contiene `localStorage.settled`, `totalCleaned` o `races` del perfil local histórico. E41 dejó esos contadores fuera del perfil autoritativo hasta que exista un requerimiento respaldado por hechos del servidor.

`GetCatalog` devuelve catálogo económico/cosmético y opciones de apariencia. **No devuelve mapas, rulesVersion ni courseVersion**: esos datos son ownership Go/realtime, no Rust.

## Codegen reproducible

El repositorio no edita stubs generados a mano. `proto/codegen/generate.sh` genera:

- Go: mensajes + cliente/servidor gRPC;
- Rust: mensajes + cliente/servidor Tonic.

Uso local, con `protoc`, `protoc-gen-go`, `protoc-gen-go-grpc`, Go y Cargo disponibles:

```bash
bash proto/codegen/generate.sh /tmp/compunube-contract-stubs
```

CI Contracts instala las herramientas pinneadas, ejecuta el generador y publica el resultado como artefacto efímero. F46/J77 y F47 consumen el mismo `.proto`; el artefacto demuestra que ambos stubs pueden generarse desde la fuente congelada sin mantener copias divergentes.

## Separación con E45

E45 decide:

- rutas HTTP de perfil/catálogo/acciones;
- creación/entrada de sala;
- autenticación/sesión pública;
- OpenAPI/Swagger de HTTP.

E43 solo fija WebSocket realtime y gRPC interno.
