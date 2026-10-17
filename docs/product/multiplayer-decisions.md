# B09 · Decisiones de producto para el multijugador

**Estado:** decisiones aceptadas para el MVP online · **Fecha:** 17-10-2026.

La [línea base B08](frontend-baseline.md) describe una carrera local contra tres IA y un cliente online preparado, pero desconectado. B09 fija el comportamiento multijugador esperado para que B10 defina el recorrido del jugador, B16 precise las reglas autoritativas y B17 modele el ciclo de sala. Este documento no afirma que las decisiones ya estén implementadas ni congela el protocolo de E43. Las propuestas anteriores de la [entrega backend del frontend](../../apps/web/docs/backend/README.md) siguen siendo evidencia del prototipo; cuando difieran de B09, estas decisiones de producto guían el trabajo posterior.

## Decisiones aceptadas

| Tema | Decisión para el MVP online | Motivo | Detalle posterior |
|---|---|---|---|
| Identidad | Cada humano entra con cuenta/perfil online persistente y una identidad `playerId` y sesión emitidas o confirmadas por backend. El personaje es solo cosmético. El modo local puede seguir sin cuenta. | Separar al usuario y su progreso de su avatar y del guardado editable del navegador. | B10: acceso y recorrido; B17: asociación de sesión y sala; E43: contrato. |
| Plazas, mapa e inicio | Sala de **2 a 4 humanos** para correr, capacidad máxima de 4. El creador fija el mapa al crearla. **No se rellenan plazas con IA** en el MVP online. El servidor inicia una cuenta atrás sincronizada cuando hay al menos 2 miembros y **todos los humanos presentes** están `ready`. | Evitar una salida unilateral y distinguir la carrera compartida de la demo con IA. | B10: experiencia de espera; B17: transiciones de sala; B16: condiciones precisas de inicio. |
| Personajes repetidos | Se permiten Nico, Luna, Amara o Samuel repetidos. Cada participante se distingue por `playerId`, nombre visible y un indicador o color de interfaz; apariencia y equipamiento siguen siendo cosméticos. | No bloquear elecciones personales ni confundir apariencia con identidad. | B10: presentación; B17/E43: datos confirmados de miembro. |
| Objetos compartidos | Go adjudica cada residuo o salvavidas una sola vez. Si varios jugadores pueden recogerlo en el mismo tick, gana quien tenga **menor distancia autoritativa al centro del objeto**; un empate exacto se resuelve de forma determinista por `playerId`. El orden de llegada de mensajes al cliente no decide. | Evitar dobles adjudicaciones y sesgo por orden local o de red. | B16: cálculo exacto, representación y desempate operativo; E43: eventos/estado. |
| Pulpo | Cada participante activo tiene una persecución independiente; su pulpo solo puede afectarle a él. | Conservar la mecánica del prototipo sin una amenaza compartida de balance incierto. | B16: daño, distancias y condiciones exactas. |
| Pérdida de foco | Ocultar la pestaña o perder foco libera controles; no pausa la sala. Go continúa la simulación con entrada neutral o timeout de input. | Una acción de un cliente no puede detener a los demás. | B17: continuidad del participante; D28/E43: mecanismo de input. |
| Desconexión y salida | Una desconexión accidental abre **15 s de reentrada** con entrada neutral y carrera en marcha. Volver con la misma identidad/sesión recupera el estado autoritativo. Vencida la ventana, el participante pasa a `left` y queda fuera de la carrera. La salida voluntaria durante la carrera es inmediata y no da premio. | Tolerar un corte breve sin permitir que la ausencia detenga o manipule la partida. | B17: estados/reentrada; B16: efecto exacto en resultado; E43: compatibilidad de sesión. |
| Fin individual | Meta o descalificación terminan solo la participación propia. Los demás continúan; quien termina espera o especta hasta el resultado global. | Evitar que el cierre de un jugador corte la carrera del resto. | B10: vista de espera; B16/B17: resultado y estados. |
| Fin global | La carrera acaba cuando **todos los participantes son terminales** o, si alguien llegó a meta, **45 s después del primer `finished`**, lo que ocurra primero. Quien no llega antes de ese límite queda como no finalizado (**DNF**). | Permitir terminar a los demás sin dejar una sala indefinidamente abierta tras la primera llegada. | B16: clasificación y tratamiento exacto de DNF; B17: transición de cierre. |
| Recompensas | **Sin bonus por puesto** en el MVP. Solo `finished` acredita exactamente el plástico y metal que el servidor confirmó para ese jugador. `disqualified`, `left` y DNF acreditan **0** de esa carrera. La acreditación es única e idempotente por `(raceId, playerId)`. | Alinear premios con el resultado autoritativo y evitar duplicados o autoacreditación. | B16: reglas de resultado; E43: contrato; Rust/Go: settlement posterior. |
| Guardado local | No se importan monedas, materiales, carreras ni propiedad comprada/fabricada desde `localStorage`. Pueden reutilizarse preferencias cosméticas válidas solo si el perfil online permite o posee esas opciones. | El guardado offline es controlable por el cliente y no prueba propiedad ni saldo. | B10: selección y aviso al jugador; E43: datos públicos de perfil. |
| Versiones | `protocolVersion` exige compatibilidad dura de mensajes. `rulesVersion` y `courseVersion` quedan fijadas para cada sala/carrera y deben coincidir al iniciar; un cliente incompatible recibe `INCOMPATIBLE_VERSION`. `catalogVersion` versiona economía/cosméticos y puede refrescarse fuera de una carrera. | Evitar que clientes y servidor simulen reglas o recorridos distintos y permitir evolucionar el catálogo por separado. | B16: reglas versionadas; B17: asociación a sala; E43: formato y negociación. |

## No negociables para backend y frontend

- **Go es autoridad de sala, carrera, colisiones, objetos, vidas y resultado.** El cliente envía intenciones y presenta estado confirmado; ni su posición, ni sus pickups, ni su clasificación son hechos autoritativos. La [arquitectura](../../ARCHITECTURE.md) mantiene a Rust como autoridad de perfil, economía y settlement detrás de Go.
- **La sala no se pausa por un cliente.** Pérdida de foco y ausencia liberan entradas o usan timeout neutral; los participantes presentes siguen compitiendo.
- **Identidad y personaje son distintos.** `playerId`/sesión provienen del backend; un mismo personaje puede representar a varios jugadores.
- **La economía local no es confiable para online.** El cliente no envía saldo, propiedad, premio ni resultado como verdad. El servidor acredita una vez por carrera y jugador; no se migran saldos offline.

## Valores iniciales configurables

| Parámetro de producto | Valor inicial | Cuándo aplica |
|---|---:|---|
| Ventana de reentrada por desconexión accidental | **15 s** | Desde la desconexión; la entrada del ausente es neutral y la partida sigue. |
| Límite de cierre global tras la primera llegada | **45 s** | Desde el primer `finished`; al vencer, quienes no terminaron son DNF. |

Estos valores deben configurarse y versionarse con las reglas de la carrera. **La política queda aceptada aquí; B16/B17 pueden ajustar las cifras y formalizar su aplicación** sin reinterpretar el objetivo de producto.

## Pendiente para tareas posteriores

- **B10** definirá el flujo de cuenta, lobby, espera/espectador, resultados y comunicación al jugador, sin cambiar las decisiones anteriores.
- **B16** precisará física, colisiones, ranking/desempates, DNF, persecución, premios y parámetros versionados. B09 decide la prioridad de menor distancia y `playerId`; B16 fijará el cálculo exacto.
- **B17** formalizará estados y transiciones de sala, carrera y participante, incluida la reentrada y la salida. B09 no define un diagrama de estados.
- **D28/E43** definirán tick, frecuencia de snapshots, transporte y contratos públicos e internos. [Los DTO propuestos](../../apps/web/docs/backend/contracts-proposed.ts) no son el contrato definitivo.

El [adaptador frontend actual](../../apps/web/docs/backend/FRONT_ADAPTER.md) valida 1–4 participantes y admite miembros marcados como `bot`; tampoco garantiza reentrada tras perder la sesión. Los [DTO propuestos](../../apps/web/docs/backend/contracts-proposed.ts) aún no representan DNF como resultado distinto. Esa preparación precede a B09: habrá que alinearla con **2–4 humanos sin bots**, la política de reentrada y DNF al implementar el modo online y cerrar E43. Ningún proveedor real está conectado hoy.
