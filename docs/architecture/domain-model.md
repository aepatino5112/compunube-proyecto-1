# C25 — Modelo de dominio de carrera y perfil

Este modelo separa el estado **efímero y autoritativo** de Go de los agregados **persistentes** de Rust. Es conceptual: las asociaciones expresan ownership y flujo de negocio, no tablas, DTO ni cardinalidades físicas. Véase el [diagrama UML](domain-model.svg) y su [fuente PlantUML](domain-model.puml).

## Identidad y frontera

`playerId` es una identidad estable compartida por referencia. No se deriva de `displayName`, personaje, skin, tabla, red ni otro cosmético. `ActivePlayer` y `RaceParticipant` guardan esa referencia durante una participación; `PlayerProfile` la usa para encontrar el perfil persistente. La sesión/conexión se valida aparte y no convierte un personaje visible en identidad.

| Contexto | Modelo y responsabilidad |
| --- | --- |
| **Go / Match runtime** | `Room` mantiene mapa fijo, miembros, preparación, cuenta atrás y ciclo `LOBBY → COUNTDOWN → RACING → RESULTS → LOBBY/CLOSED`. `RoomMember` referencia `ActivePlayer`/`playerId` y registra la elección de Reducir de esa participación. `Race` fija roster, reglas y curso; `RaceParticipant` mantiene posición, progreso, velocidad, energía, salto, vidas, protección, pulpo, recogidas, tiempos y estado terminal. `RaceInput` es intención recibida; `InputState` conserva la última intención válida y secuencias consumidas. `CourseManifest` y `PickupState` distinguen definición del recorrido y disponibilidad/propiedad viva de objetos. `ReconnectLease` y `ConnectionBinding` gestionan ausencia temporal y sesión enlazada sin duplicar participantes. `RaceResult` contiene `ParticipantResult` y nace solo de reglas Go. |
| **Rust / Player persistente** | `PlayerProfile` agrupa identidad, recursos y revisión. `Inventory` conserva monedas/materiales; `Catalog` ofrece `CatalogItem`; `OwnedItem` y `EquipmentSelection` separan propiedad y selección. `EconomicOperation` representa compra, canje o fabricación atómicos e idempotentes. `Settlement` registra la acreditación del resultado recibido de Go; `ProfileRevision`/solicitud idempotente permiten observar cambios y deduplicar acciones. Rust no recalcula posiciones, puestos, recogidas ni estados terminales. |

La elección de Reducir y el conteo de objetos del objetivo compartido son hechos de participación/carrera en Go; no son saldos de Rust. Solo un `ParticipantResult` con `finished` puede proponer acreditar los materiales confirmados por Go; `disqualified`, `left` y `dnf` acreditan cero, aunque sus recogidas sigan contando para el objetivo de agua. El resultado autoritativo y la confirmación posterior del perfil son estados distintos.

## Interacción y persistencia

Go entrega a un **puerto de aplicación PlayerProfilePort** consultas de perfil y solicitudes de settlement; el adaptador técnico previsto es gRPC/Protobuf a través de Envoy. El `.proto` actual es borrador hasta E43. Solo Go, como servidor, envía resultados a Rust. Rust aplica el settlement de manera transaccional e idempotente por la clave conceptual **`(raceId, playerId)`**, incluso ante repetición o respuesta perdida; E41 decidirá la representación SQL. Go puede conservar resultado confirmado y settlement pendiente sin bloquear la carrera si Rust está caído. Ningún cliente accede directamente a Rust ni a PostgreSQL.

PostgreSQL figura como persistencia conceptual: el contexto lógico `match` pertenece a Go y `player` a Rust. Go no escribe datos privados de `player`; Rust no escribe estado vivo de `match`. E41 define tablas, columnas, claves, índices y migraciones; este modelo no los adelanta. La carrera viva se mantiene en memoria de Go y no se persiste cada tick.

## Trazabilidad y alcance

- [ADR 0001](../adr/0001-service-boundaries.md) fija el ownership; [B18](../product/game-design-document-v1.md), [B16](../product/authoritative-race-rules.md) y [B17](../product/multiplayer-room-lifecycle.md) fijan reglas y ciclo de vida.
- [C21](../requirements/functional-requirements.md) y [C22](../requirements/non-functional-requirements.md) fijan requisitos y criterios de resiliencia/idempotencia.
- E43 cerrará identidad pública, mensajes y contratos Go↔Rust. Los [eventos realtime](../../contracts/realtime/events.md), el [proto](../../proto/player_profile.proto) y los [tipos web](../../apps/web/docs/backend/contracts-proposed.ts) siguen como propuestas.

## Reproducir el SVG

Desde la raíz del repositorio, con Docker disponible:

```bash
docker run --rm -v "$PWD/docs/architecture:/work" -w /work \
  plantuml/plantuml@sha256:9b5071ab56a4192aac458ab4b0d42261c22c8109695894ae5be6013c3be6cac1 \
  -tsvg domain-model.puml
```
