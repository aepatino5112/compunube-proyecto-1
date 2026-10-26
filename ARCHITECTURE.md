# Architecture

La arquitectura principal orientada a servicios mediante microservicios está aceptada en [ADR 0003](docs/adr/0003-primary-distributed-architecture.md); la [evaluación D26](docs/architecture/architecture-evaluation.md) documenta las alternativas docentes.
El [diseño D28 del runtime Go](docs/architecture/go-match-runtime.md) fija tick, publicación, concurrencia por sala, reentrada y degradación de Rust.
La [política E38](docs/architecture/resilience-failover-degraded-mode.md) concreta deadlines, retry seguro, Circuit Breaker y recuperación de settlement.
El [diseño E39](docs/architecture/go-bulkhead-backpressure.md) fija aislamiento por sala, conexión y clase de trabajo remoto con límites configurables.
La [semántica E40](docs/architecture/health-readiness-design.md) distingue liveness, readiness y dependencia degradada por instancia para Go, Rust, PostgreSQL y Envoy.
El [diseño D29 del Player/Profile Service](docs/architecture/rust-player-profile-service.md) fija responsabilidades, capas, idempotencia, transacciones y replicabilidad de Rust.
El [diseño E41 de PostgreSQL](docs/architecture/postgresql-schema.md) fija tablas, constraints, índices y enforcement objetivo del ownership `match`/`player`.
Los [contratos E43](contracts/realtime/events.md) congelan WebSocket realtime v1; `proto/player_profile.proto` congela gRPC interno `compunube.player.v1`.
El [contrato E45](contracts/http/README.md) fija OpenAPI HTTP público v1 para sesión, perfil/economía y crear/entrar sala.
El [catálogo E36 de patrones cloud-native](docs/architecture/cloud-native-pattern-catalog.md) fija el vocabulario permitido y qué patrones son demostrables en la infraestructura prevista.
La [selección E37](docs/architecture/cloud-native-pattern-selection.md) compromete ocho patrones con evidencia y pruebas concretas.

## Vista general

```text
Clients
   |
   | HTTP / realtime
   v
+---------------------------+
| Go Match Service          |
|---------------------------|
| API/Gateway boundary      |
| Rooms & active players    |
| Authoritative race state  |
| Goroutines & channels     |
| Retry/timeout/fallback    |
| Circuit breaker/bulkhead  |
+-------------+-------------+
              |
              | PlayerProfilePort
              | gRPC + Protobuf
              v
        +-----------+
        |   Envoy   |  Ambassador / Load Balancer
        +-----+-----+
             / \
            /   \
           v     v
      +--------+ +--------+
      | Rust 1 | | Rust 2 |
      +---+----+ +----+---+
          \          /
           \        /
            v      v
           PostgreSQL
```

## Go Match Service

Go es dueño del estado runtime:

- sesiones y conexiones activas;
- salas y ciclo de vida de partidas;
- jugador dentro de carrera;
- tick autoritativo;
- inputs, snapshots y eventos;
- movimiento, boost, salto, colisiones, pickups, vidas y meta;
- reconexión;
- resultado autoritativo;
- coordinación del settlement con Rust.

La concurrencia debe ser real mediante goroutines, channels, `context.Context`, límites y cierre ordenado.

## Rust Player/Profile Service

Rust es dueño del estado persistente del jugador:

- perfil;
- inventario;
- catálogo;
- apariencia/equipamiento;
- compras;
- crafting;
- canjes;
- acreditación idempotente de resultados.

Las réplicas Rust no deben conservar estado crítico exclusivo en memoria. El detalle de capas, repositorios, reinicio e idempotencia está en [D29](docs/architecture/rust-player-profile-service.md).

## Clientes

El cliente principal es la web Surf Club en `apps/web/`: conserva Three.js y su JavaScript, y la integración online (HTTP E45, WebSocket E43, traducción a la presentación, reentrada) está en **TypeScript** (`apps/web/src/net`, compilado y verificado en CI Web). La segunda interfaz es el cliente **Python** de `apps/client-secondary/` (G58). La elección y sus límites están en [ADR 0002](docs/adr/0002-client-language-strategy.md).

Ambos clientes envían intención a la frontera pública de Go mediante HTTP E45 y el WebSocket E43. Presentan estado confirmado, usan el mismo contrato público cuando quede definido y no acceden directamente a Rust, al gRPC interno ni a PostgreSQL.

Nunca son autoridad de:

- posición final;
- vidas;
- pickups;
- ranking;
- recompensas;
- saldo.

## Comunicación

- **Cliente ↔ Go realtime:** WebSocket JSON en `/v1/realtime`, subprotocolo `compunube.realtime.v1`.
- **Cliente ↔ Go request/response:** HTTP según [`contracts/http/openapi.yaml`](contracts/http/openapi.yaml).
- **Go ↔ Rust:** gRPC + Protocol Buffers, package `compunube.player.v1`.
- **Go/Rust ↔ PostgreSQL:** solo sobre datos de su ownership.

## Patrones previstos

La selección final E37 está en [cloud-native-pattern-selection.md](docs/architecture/cloud-native-pattern-selection.md): Microservicios, API Gateway, Database per Service, Ambassador, Circuit Breaker, Bulkhead, Retry y Timeout/Fallback. Load balancing y health monitoring se documentan como mecanismos/capacidades; no se cuentan automáticamente como patrones autónomos.

| Patrón | Aplicación |
| --- | --- |
| API Gateway | Go como frontera pública |
| Adapter | port interno + adaptador gRPC |
| Repository | PostgreSQL detrás de repositorios |
| Ambassador | Envoy delante de Rust |
| Circuit Breaker | protege Go frente a fallos repetidos |
| Retry | limitado a operaciones seguras/idempotentes |
| Timeout | deadline explícito para RPC |
| Fallback | la carrera continúa sin perfil/economía |
| Bulkhead | aislamiento de carga/dependencias |
| Observer/Pub-Sub interno | broadcast de eventos/snapshots |

### Reparto de resiliencia

- **Go:** timeout, circuit breaker, fallback y retry limitado.
- **Envoy:** load balancing, health checking y failover de instancia.
- **Rust:** operaciones idempotentes cuando admiten retry.

## Persistencia

Una sola instancia PostgreSQL con ownership lógico:

- schema `match`: Go, para historia de sala/carrera, resultados y coordinación durable de settlement;
- schema `player`: Rust, para perfil, catálogo, propiedad, economía e idempotencia.

No hay claves foráneas cruzadas entre schemas ni persistencia por tick. Desde J84, Go, Rust y postgres-exporter usan roles runtime distintos (`compunube_match_runtime`, `compunube_player_runtime`, `compunube_monitor_runtime`) creados por `db-migrate`; CI comprueba la denegación cruzada.

## Restricciones

1. Rust no es dueño del estado vivo de carrera.
2. Go no modifica directamente datos privados de Player/Profile.
3. El frontend no declara premios ni resultados.
4. Direcciones y secretos no se hardcodean.
5. Una caída de Rust no destruye una partida activa.

## Vistas UML y despliegue

Componentes (D32), despliegue (D33) y secuencias críticas (D34) están en [docs/uml](docs/uml/README.md); la topología física (D31) y el procedimiento de despliegue (H66) en [docs/deployment](docs/deployment/).

## Limitaciones conocidas

- **Sesiones en memoria (F48):** `identity.Registry` vive en el proceso Go; reiniciar Go invalida todas las sesiones y el jugador no puede volver a su perfil online anterior, aunque los datos sigan en `player.*`.
- **Repetir carrera (RF-035):** la sala vuelve sola de `RESULTS` a `LOBBY` 10 s después del settlement confirmado (`ROOM_RESULTS_LOBBY_DELAY`, [ADR 0004](docs/adr/0004-results-return-to-lobby.md)); con el settlement pendiente se queda en `RESULTS`.
- **Resultado pendiente de persistir:** Go reintenta cada segundo guardar el resultado mientras PostgreSQL no está disponible; si Go se reiniciara durante esa caída, el resultado aún no persistido se perdería.
- **Navegadores remotos:** la cookie de sesión es `Secure`; desde otro equipo, el cliente web necesita HTTPS hasta Go. El cliente Python usa `Bearer` y no está afectado.

