# UML de Compunube Online

## D35 · Estados de sala y participante

Las [fuentes de sala](room-state.puml) y [participante](participant-state.puml), con sus [SVG de sala](room-state.svg) y [participante](participant-state.svg), trasladan las transiciones de [B17](../product/multiplayer-room-lifecycle.md), [B16](../product/authoritative-race-rules.md) y el wire contract [E43](../../contracts/realtime/events.md). Los nombres de estado son únicamente los de `RoomState` y `ParticipantState` E43. Las condiciones temporales son reglas de B17/B16, no temporizadores gestionados por el diagrama.

**Ciclo conceptual de carrera:** la sala entra en `COUNTDOWN` cuando hay 2–4 presentes y todos están `ready`; si cambia roster o preparación vuelve a `LOBBY`. Tras 3 s Go inicia la carrera, fija roster/versiones y emite el `raceId` autoritativo al pasar a `RACING`. El primer `finished` activa el plazo de 45 s; Go cierra antes si todos quedan terminales, incluso si nunca hubo un `finished`. Al vencer el plazo convierte activos/reconnecting en `dnf`, publica resultado inmutable y pasa a `RESULTS`. Settlement Rust puede seguir pendiente sin reabrir esa carrera. Los miembros restantes pueden repetir en `LOBBY` con el mismo mapa y nueva preparación; una sala vacía pasa a `CLOSED`. Esto **no** define un tercer enum público de carrera.

En `LOBBY`/`COUNTDOWN`, la salida o pérdida de conexión sin sesión utilizable elimina la membresía: no crea el estado terminal `left` de una carrera que aún no empezó. Durante `RACING`, la desconexión accidental usa `reconnecting` hasta 15 s y puede terminar en meta/descalificación mientras el jugador está ausente. Las flechas terminal → `not_ready` solo aplican a quien conserva membresía tras el resultado.

## C20 · Casos de uso online

[Fuente PlantUML](use-cases.puml) y [SVG generado](use-cases.svg) representan el mismo modelo del [catálogo C19](../requirements/online-use-cases.md). El límite es **Compunube Online** y su único actor externo primario es **Jugador**. Frontend, Go, Rust, PostgreSQL y Envoy son participantes internos; la nota del diagrama resume su recorrido y C19 precisa las responsabilidades.

El diagrama agrupa UC-01…UC-17 en acceso/perfil, sala/preparación, carrera/continuidad y resultado/progreso. Las extensiones se usan solo para contacto elegible, desconexión, salida voluntaria y decisión de repetir/salir después del resultado. Las precondiciones y el orden completo están en C19; el diagrama no fija API ni protocolo.

## Regenerar el SVG

Se usó **PlantUML 1.2026.9** en contenedor, fijado por digest. Desde la raíz del repositorio:

```bash
docker run --rm -v "$PWD/docs/uml:/work" -w /work \
  plantuml/plantuml@sha256:9b5071ab56a4192aac458ab4b0d42261c22c8109695894ae5be6013c3be6cac1 \
  -tsvg use-cases.puml
```

El comando escribe `docs/uml/use-cases.svg` desde `use-cases.puml`. Para revisar cambios, regenerar y comparar el SVG versionado con `git diff`; no editar el SVG a mano. El contenedor evita exigir Java/PlantUML instalados en el host.

Para regenerar también D35 con la **misma imagen fijada**:

```bash
docker run --rm -v "$PWD/docs/uml:/work" -w /work \
  plantuml/plantuml@sha256:9b5071ab56a4192aac458ab4b0d42261c22c8109695894ae5be6013c3be6cac1 \
  -tsvg room-state.puml participant-state.puml
```
