# E39 — Bulkhead y backpressure del runtime Go

Diseño de límites para implementar en F50/F51, coherente con [D28](go-match-runtime.md), [E37](cloud-native-pattern-selection.md), la política [E38](resilience-failover-degraded-mode.md), el contrato [E43](../../contracts/realtime/events.md) y [C22](../requirements/non-functional-requirements.md). El aislamiento es por sala, conexión y clase de trabajo remoto. Esta PR no implementa pools, semáforos, rate limits ni métricas.

## Fronteras de aislamiento

```text
                         RoomManager: admisión global acotada
                                │
                  ┌─────────────┴─────────────┐
                  ▼                           ▼
              RoomLoop A                   RoomLoop B
        20 Hz, único escritor       20 Hz, único escritor
        comandos ≤16/tick           estado y colas propios
        input latest + saltos acotados por jugador
           │          │
  WebSocket reader    publisher → snapshot slot (1) → writer de conexión
  validación/límite              → cola crítica (16) ──→ writer de conexión
  sin tocar Race                → eventos transitorios acotados

      profile workers (8, cola 32) ──┐
                                     ├─> E38/J77 → Envoy → Rust
      settlement workers (4, cola 64)┘
                ▲
      `match.settlement_delivery` durable = fuente de pendientes
```

Cada `RoomLoop` es la única goroutine que modifica su sala/carrera; el registro global tiene un lock breve solo para localizar salas. Ninguna sala ejecuta el tick de otra ni espera red, PostgreSQL o RPC dentro del tick. Reader y writer viven por WebSocket y cancelan juntos; writer es el único que escribe al socket. Los pools de perfil y settlement son independientes y tienen capacidad de espera limitada, para que una ruta lenta no monopolice la otra. No hay goroutine por pickup, entidad, input ni solicitud remota en espera.

## Límites iniciales configurables

**Todos los números de esta tabla son objetivos internos propuestos — pendientes de aprobación**, salvo la capacidad de **4 humanos por sala** y los ritmos 20 Hz/10 Hz fijados por B17/D28. Son valores de arranque de laboratorio, no requisitos del profesor; F50/F51 los expondrán por configuración y A05/I72 podrán ajustarlos con medidas. El proceso rechaza admisión nueva al alcanzar límites globales; nunca expulsa una carrera admitida para admitir otra.

| Clave conceptual | Baseline inicial | Política al llenarse / razón |
| --- | ---: | --- |
| `server.max_active_rooms` | **5** | Rechazar nueva sala; coincide con las 5 partidas de referencia NFR-CAP-001. No limita cierre/progreso de salas existentes. |
| `server.max_connections` | **20** | Rechazar conexión nueva; 5 salas × 4 humanos. NFR-CAP-002 usa 2× la carga para observar rechazos y continuidad, no exige admitir los 40. |
| `room.command_queue_capacity` | **32** | Cola de comandos no coalescibles (`room.ready`, `room.leave`, rebind/cierre); rechazar/controlar exceso sin bloquear reader ni loop. |
| `room.max_commands_per_tick` | **16** | Drenar como máximo 16 comandos de control por tick; a 20 Hz da techo de 320 comandos/s por sala y reserva tiempo para simular aun con backlog. |
| `room.input_slots` | **4 latest-only** | Un slot por participante permitido por B17; `race.input` no entra en la cola de comandos de 32. Reemplazar intención continua anterior de ese jugador, conservando secuencias. |
| `room.jump_edges_per_player` | **4** | FIFO acotada de pulsaciones aceptadas por participante; no perder una acción discreta al coalescer movimiento. Si se llena, rechazar y contabilizar nuevas pulsaciones. |
| `connection.input_rate` | **20/s, ráfaga 4** | Límite por sesión/conexión con contador; deriva de ≈20 Hz D28 y tolera una ráfaga breve de red. Rechazar/contabilizar exceso; no cargar el loop con cada paquete. |
| `connection.snapshot_slots` | **1 latest-only** | Snapshot completo nuevo sustituye al pendiente no enviado; 10 Hz no acumula 10 mensajes/s por cliente lento. |
| `connection.critical_queue_capacity` | **16** | FIFO de `room.state`, `race.start`, `race.ended` y errores fatales; si no progresa, cerrar solo esa conexión. |
| `connection.event_queue_capacity` | **16** | `race.event` transitorio puede descartarse al llenarse; contar descartes y recuperar verdad con snapshot. Nunca desplaza cola crítica. |
| `profile.max_concurrency` | **8** | Máximo 8 llamadas/trabajos de perfil concurrentes; evita que Rust lento cree goroutines ilimitadas. |
| `profile.queue_capacity` | **32** | Rechazar nueva consulta/acción con saturación controlada cuando llena; `ready` no se confirma sin perfil. |
| `settlement.max_concurrency` | **4** | Pool separado para entrega idempotente; no consume slots de perfil ni bloquea RoomLoop. |
| `settlement.queue_capacity` | **64** | Solo buffer RAM de trabajos listos; al llenarse, mantener `pending` durable en `match.settlement_delivery` y programar después. |

El cálculo de capacidad parte de 4 participantes × ≈20 inputs/s = **≈80 inputs/s por sala**. El uso de 4 slots latest evita meter esos 80 mensajes/s en la cola de 32 comandos. A 10 snapshots/s y 4 conexiones hay hasta **40 publicaciones/s por sala**; un slot por conexión acota snapshots pendientes a 4, independientemente de cuánto tiempo tarde el consumidor. Los 16 comandos/tick son para control no coalescible y superan el tráfico normal de ready/leave, sin volver ilimitado el drenaje. Los límites globales de 5 salas/20 conexiones igualan la referencia C22; la prueba 2× debe producir admisión rechazada medible y mantener las admitidas dentro del objetivo propuesto de memoria. Los tamaños de mensajes E43 (snapshot con objetos) y hardware A05 obligan a medir RSS antes de aprobar estos números.

## Semántica de entrada y salida

El reader valida frame, identidad, `raceId`, rango y `seq` según E43 antes de entregar el input a una **mailbox de ingreso sincronizada y acotada**; no escribe `Race` ni entidades. RoomLoop confirma pertenencia/estado y toma de la mailbox la intención continua más reciente y válida (`steer`, `netSide`, `boost`) de cada participante. La mailbox conserva por separado las pulsaciones `jumpSeq` **aceptadas** en una FIFO por jugador: un input continuo posterior no borra un salto anterior. RoomLoop consume como máximo una pulsación por jugador y tick; aplica la elegibilidad B16, actualiza `lastProcessedJumpSeq` y no repite ese valor. Si la FIFO está llena, se rechaza explícitamente la nueva pulsación (`RATE_LIMITED`), se contabiliza y no se la marca procesada. Un salto con secuencia mayor recibido tras pérdida de paquetes representa una nueva solicitud, no la ejecución implícita de todos los valores no observados. La implementación debe conservar las reglas E43 también tras reentrada y probar salto seguido de movimiento antes del tick, duplicados y ráfagas de saltos.

Los comandos de control no coalescibles mantienen orden FIFO dentro de la cola de sala; no se espera indefinidamente a colocar uno. Si está llena, la conexión recibe error controlado cuando puede enviarse o se cierra si tampoco progresa la salida. `room.leave` no puede perderse silenciosamente: si no se puede encolar, se cierra la conexión y el loop recibe una señal de cierre por una vía de lifecycle reservada, independiente de la cola saturada. La pérdida de transporte sigue las reglas B17 de reentrada y no se confunde automáticamente con una salida voluntaria. La señal de cierre tampoco debe bloquear al reader; el loop la observa antes de seguir publicando a esa conexión.

La salida separa:

| Clase | Política |
| --- | --- |
| `race.snapshot` | Coalescible: sobrescribir el único slot no enviado por snapshot más nuevo; nunca bloquear RoomLoop. En reentrada, snapshot completo antes de aceptar inputs según E43. |
| `race.event` | Transitorio: cola acotada independiente; si se llena, descartar evento y registrar pérdida. El snapshot posterior reconstruye propiedad, vidas y estado. |
| `room.state`, `race.start`, `race.ended`, error fatal | Críticos: FIFO acotada, no descartar silenciosamente. Si el writer no progresa dentro de un límite de salida configurable, cerrar ese socket y registrar motivo. E43 define lo que se reenvía en RACING/RESULTS tras reatar identidad. |
| Error no fatal / `RATE_LIMITED` | Respuesta acotada y agregada por conexión para no amplificar una inundación de inputs; si no puede entregarse, cerrar la conexión según política de salida. |

La ordenación de mensajes de estado crítico y snapshots debe respetar E43: `race.start` antes de snapshots de una carrera nueva; en reentrada `room.state` y snapshot completo antes de reanudar inputs; en RESULTS se expone el último `race.ended` disponible. El writer puede priorizar críticos sin permitir que snapshots viejos retrasen uno terminal. No se inventa un historial durable de `race.event`.

## Saturación remota, cierre y observabilidad

Una cola de perfil llena devuelve saturación controlada equivalente a `RESOURCE_EXHAUSTED` hacia la capa Go/J77; la frontera pública la mapea sin fingir perfil. La operación no espera dentro de RoomLoop. El Circuit Breaker E38 cuenta fallos de dependencia al terminar una llamada lógica, pero un **rechazo local del Bulkhead** se observa como saturación Go y no se imputa a Rust. Una cola de settlement llena deja la fila durable `pending` en `match.settlement_delivery` (E41); si `match` DB está caída, la memoria sola no garantiza entrega tras caída de Go, como advierte E38. El recuperador lee pendientes gradualmente y aplica deadlines/idempotencia E38.

Al cerrar conexión, se cancela reader/writer, se descartan slots/colas locales y se notifica al loop sin bloquearlo. Al cerrar sala, se cancela su contexto y los trabajos asociados; la entrega durable de settlement permanece recuperable por otro ciclo de worker. Al apagar Go, se detiene admisión, se cancelan contextos, se espera cierre acotado y se liberan colas. F50/F51 deberá probar ausencia de fugas de goroutines, bloqueos de envío y carreras de datos (`go test -race`).

La evidencia operativa mínima: salas/conexiones admitidas y rechazadas, duración/atraso de tick por sala, profundidad y rechazos de comandos, coalescing/rechazos de input y jump, reemplazos de snapshots, descarte de eventos, saturación/cierre de cola crítica, goroutines activas, ocupación/espera/rechazo de cada pool, pendientes de settlement, latencia/error RPC, RSS y reconexiones. Correlacionar con `roomId`, `raceId`, `playerId` y solicitud cuando sea seguro, sin registrar secretos. Nombres finales de métricas pertenecen a H67/H68.

## Ensayo reproducible para F51/I72

1. Levantar el stack Compose y fijar una revisión/configuración. Registrar CPU, RAM, versión, límites, RTT y tamaño real del snapshot E43.
2. Crear **al menos dos salas** activas con clientes sintéticos; en una cargar consultas/settlement o hacer Rust lento. En la otra mantener inputs y snapshots para medir progreso independiente.
3. Añadir un consumidor WebSocket lento y una fuente que exceda la tasa de input; observar reemplazos de snapshots, cierre controlado de la conexión y rechazos/errores sin detener otros participantes.
4. Llevar profile y settlement hasta sus capacidades separadas; comprobar que una ruta saturada no impide la otra y que `settlement_delivery` conserva pendientes después de vaciar la cola RAM/reiniciar workers.
5. Ejecutar NFR-CAP-001: **20 clientes sintéticos en 5 partidas durante 10 min**. Luego NFR-CAP-002: **2× esa carga durante 5 min**, medir RSS Go **≤512 MiB**, rechazos contabilizados y progreso de partidas admitidas. Estos son **objetivos internos propuestos — pendientes de aprobación**, no exigencias docentes ni número de equipos físicos.
6. Registrar p50/p95/p99 de ticks y latencia de respuesta, profundidad máxima de colas, descartes, goroutines y RSS; repetir según C22 y ejecutar race detector. Fallar el criterio si una sala ajena se congela, crecen colas/goroutines sin límite o se acredita un settlement duplicado.

F50/F51 implementarán límites y lifecycle; J77/F54 conectarán pools y entrega durable; I72/I73 ejecutarán las pruebas. Este documento no cambia código ni contratos.
