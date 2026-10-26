# UML de Compunube Online

## D35 · Estados de sala y participante

Las [fuentes de sala](room-state.puml) y [participante](participant-state.puml), con sus [SVG de sala](room-state.svg) y [participante](participant-state.svg), trasladan las transiciones de [B17](../product/multiplayer-room-lifecycle.md), [B16](../product/authoritative-race-rules.md) y el wire contract [E43](../../contracts/realtime/events.md). Los nombres de estado son únicamente los de `RoomState` y `ParticipantState` E43. Las condiciones temporales son reglas de B17/B16, no temporizadores gestionados por el diagrama.

**Ciclo conceptual de carrera:** la sala entra en `COUNTDOWN` cuando hay 2–4 presentes y todos están `ready`; si cambia roster o preparación vuelve a `LOBBY`. Tras 3 s Go inicia la carrera, fija roster/versiones y emite el `raceId` autoritativo al pasar a `RACING`. El primer `finished` activa el plazo de 45 s; Go cierra antes si todos quedan terminales, incluso si nunca hubo un `finished`. Al vencer el plazo convierte activos/reconnecting en `dnf`, publica resultado inmutable y pasa a `RESULTS`. Settlement Rust puede seguir pendiente sin reabrir esa carrera. Los miembros restantes pueden repetir en `LOBBY` con el mismo mapa y nueva preparación; una sala vacía pasa a `CLOSED`. Esto **no** define un tercer enum público de carrera.

En `LOBBY`/`COUNTDOWN`, la salida o pérdida de conexión sin sesión utilizable elimina la membresía: no crea el estado terminal `left` de una carrera que aún no empezó. Durante `RACING`, la desconexión accidental usa `reconnecting` hasta 15 s y puede terminar en meta/descalificación mientras el jugador está ausente. Las flechas terminal → `not_ready` solo aplican a quien conserva membresía tras el resultado.

## C20 · Casos de uso online

[Fuente PlantUML](use-cases.puml) y [SVG generado](use-cases.svg) representan el mismo modelo del [catálogo C19](../requirements/online-use-cases.md). El límite es **Compunube Online** y su único actor externo primario es **Jugador**. Frontend, Go, Rust, PostgreSQL y Envoy son participantes internos; la nota del diagrama resume su recorrido y C19 precisa las responsabilidades.

El diagrama agrupa UC-01…UC-17 en acceso/perfil, sala/preparación, carrera/continuidad y resultado/progreso. Las extensiones se usan solo para contacto elegible, desconexión, salida voluntaria y decisión de repetir/salir después del resultado. Las precondiciones y el orden completo están en C19; el diagrama no fija API ni protocolo.

## D32 · Componentes

[Fuente](components.puml) y [SVG](components.svg). Clientes web (Three.js + módulos TypeScript, servidos por `server.mjs` con proxy `/v1` del mismo origen) y Python se conectan solo a Go por HTTP E45 y WebSocket E43. Go agrupa sesión, perfil/economía, salas/realtime, RoomLoop con la simulación autoritativa, buzones de entrada/salida, el port gRPC con Circuit Breaker y el coordinador de settlement; persiste `match.*`. Go usa un único destino lógico (Envoy), que balancea y comprueba la salud gRPC de `rust-1` y `rust-2`; ambas réplicas escriben `player.*`. PostgreSQL separa los schemas con roles runtime distintos y sin claves foráneas cruzadas. Prometheus/Grafana observan Go, ambas Rust, Envoy y PostgreSQL.

## D34 · Secuencias críticas

| Flujo | Fuente | SVG |
| --- | --- | --- |
| D34.1 Sesión, perfil y economía (`requestId` e incertidumbre) | [seq-profile-economy.puml](seq-profile-economy.puml) | [SVG](seq-profile-economy.svg) |
| D34.2 Crear y entrar a sala | [seq-room-join.puml](seq-room-join.puml) | [SVG](seq-room-join.svg) |
| D34.3 Ready, Reducir e inicio | [seq-ready-start.puml](seq-ready-start.puml) | [SVG](seq-ready-start.svg) |
| D34.4 Inputs, tick y snapshots | [seq-race-loop.puml](seq-race-loop.puml) | [SVG](seq-race-loop.svg) |
| D34.5 Resultado y settlement durable | [seq-result-settlement.puml](seq-result-settlement.puml) | [SVG](seq-result-settlement.svg) |
| D34.6 Desconexión y reentrada | [seq-reconnection.puml](seq-reconnection.puml) | [SVG](seq-reconnection.svg) |
| D34.7 Caída y recuperación de Rust | [seq-rust-outage.puml](seq-rust-outage.puml) | [SVG](seq-rust-outage.svg) |

Los mensajes y estados siguen E43/E45, `proto/player_profile.proto` y el código de `services/match-service-go` (por ejemplo `matchstore.Save`, `ClaimDue`/`Confirm` y `ConfirmSettlement`). `seq-common.iuml` contiene solo el estilo compartido.

**Discrepancia detectada:** D35 muestra `RESULTS → LOBBY` (repetir), y Go implementa `rooms.Manager.Repeat`, pero ningún endpoint HTTP ni mensaje E43 lo invoca: hoy la sala permanece en `RESULTS` hasta que sus miembros salen. Los diagramas D34 describen el comportamiento implementado.

## Regenerar el SVG

Se usó **PlantUML 1.2026.9** en contenedor, fijado por digest. Desde la raíz del repositorio:

```bash
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD/docs/uml:/work" -w /work \
  plantuml/plantuml@sha256:9b5071ab56a4192aac458ab4b0d42261c22c8109695894ae5be6013c3be6cac1 \
  -tsvg use-cases.puml
```

El comando escribe `docs/uml/use-cases.svg` desde `use-cases.puml`. Para revisar cambios, regenerar y comparar el SVG versionado con `git diff`; no editar el SVG a mano. El contenedor evita exigir Java/PlantUML instalados en el host.

Para regenerar también D35 con la **misma imagen fijada**:

```bash
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD/docs/uml:/work" -w /work \
  plantuml/plantuml@sha256:9b5071ab56a4192aac458ab4b0d42261c22c8109695894ae5be6013c3be6cac1 \
  -tsvg room-state.puml participant-state.puml
```

Para D32/D34, o para todo el directorio, se pasa la lista explícita de fuentes (el comodín se expandiría en el directorio del host):

```bash
(cd docs/uml && docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/work" -w /work \
  plantuml/plantuml@sha256:9b5071ab56a4192aac458ab4b0d42261c22c8109695894ae5be6013c3be6cac1 \
  -failfast2 -tsvg $(ls *.puml))
```

**CI Docs** ejecuta ese comando en cada PR que toca `docs/uml/`, publica los SVG como artefacto `uml-svg` y falla si algún SVG versionado no coincide con su fuente o falta. Los SVG de D32/D34 se tomaron de ese artefacto; los de C20/D35 se reproducen byte a byte con la misma imagen.
