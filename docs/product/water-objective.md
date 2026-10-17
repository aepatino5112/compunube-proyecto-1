# B15 · Agua como objetivo compartido de la carrera

**Estado:** decisión de diseño para el MVP; el HUD y el resumen descritos aquí **todavía no están implementados**. El agua es el entorno que el grupo intenta cuidar mientras compite, no una moneda ni un recurso que se gasta. Maracaibo y Orinoco son escenarios estilizados inspirados en cuerpos de agua venezolanos, sin simulación geográfica o ecológica exacta.

La señal observable del objetivo es **cuántos residuos virtuales del recorrido se han recogido y cuántos quedan**. En línea, Go decide una sola vez la propiedad de cada objeto y conserva ese estado; el frontend lo presenta. El lugar obtenido en la carrera y el material acreditado al perfil se muestran por separado. Esta decisión desarrolla el [objetivo educativo B12](educational-goals.md) y respeta la [autoridad de carrera B13](core-gameplay-loop.md).

## Estado y lectura del objetivo

El **total del recorrido** es la cantidad de residuos virtuales recogibles definida por el manifiesto o curso de **esa carrera**. No se fija aquí un número: B16 y el curso versionado determinarán el conjunto final. El **total retirado** es el número de objetos de ese conjunto cuya recogida Go confirmó, sin duplicados; los **restantes** son los del mismo conjunto que aún no tienen propietario. La **contribución personal** cuenta los objetos de ese conjunto adjudicados a cada participante. Así, el total retirado puede reconstruirse a partir de la propiedad confirmada y los restantes del mismo estado, incluso si se pierde un evento visual.

Cada objeto cambia de disponible a recogido **una sola vez**. La suma de contribuciones personales de todos los participantes coincide con el total compartido, incluso si alguno termina descalificado, sale o queda DNF. Recoger más no cambia por sí mismo el puesto ni concede un bonus de ranking; B15 tampoco cambia la física o los efectos de impulso ya existentes que B16 revisará. Este contador **no** mide pureza, contaminación, litros de agua, masa de residuos ni recuperación del ecosistema.

## Feedback propuesto

| Momento | Presentación al jugador | Fuente de la verdad |
| --- | --- | --- |
| Antes de salir | «**Objetivo de agua:** retira residuos virtuales del recorrido mientras llegas a la meta». | Objetivo educativo del curso; no promete que se retiren todos. |
| Durante la carrera | Bloque compacto **«Cuidado del agua»**: «Tú: X objetos» y «Grupo: Y de Z residuos virtuales del recorrido». | En línea, contribución y estado compartido confirmados por Go; Z procede del manifiesto/curso de esa carrera. |
| Recogida | El objeto adjudicado desaparece del recorrido; puede activar la onda o el sonido existente y actualizar el HUD. | El evento activa presentación; el estado/snapshot autoritativo confirma propiedad y contadores. Un efecto aislado no concede un objeto. |
| Fin individual y espera | Mantener visible la contribución propia confirmada; el total del grupo puede seguir avanzando por recogidas de otros jugadores hasta el fin global. | Estado actualizado de la carrera, aunque la participación propia haya terminado. |
| Fin global | Mostrar «**El grupo retiró Y de Z residuos virtuales del recorrido**» y, si quedaron, «Quedaron N residuos virtuales en el recorrido», junto con la contribución personal. | Resumen derivado del estado final confirmado por Go; N es el número de objetos restantes del mismo curso. |

La demo local ya recoge residuos y muestra cantidades, pero **no es una partida compartida autoritativa**. En el modo online propuesto, el cliente no calcula el total global a partir de animaciones ni de eventos recibidos solamente. Al incorporarse o reentrar, debe reconstruir HUD y objetos visibles desde el estado confirmado. No se necesita cambiar todo el agua de color de «sucia» a «limpia»: ese efecto sugeriría una medida de calidad ambiental que el juego no posee.

## Resultado: tres lecturas separadas

| Lectura | Qué se informa | Qué no significa |
| --- | --- | --- |
| **Competencia** | Puesto/estado final, tiempo y condición según [B09](multiplayer-decisions.md) y las reglas que cierre B16. | El contador de agua no altera ranking ni añade premio por posición. |
| **Cuidado del agua** | Objetos virtuales retirados por el participante y por el grupo, frente al total del recorrido; objetos que quedaron. | No es porcentaje de contaminación eliminada ni medida de agua restaurada. |
| **Economía** | Materiales acreditados y perfil confirmado por separado, cuando corresponda. | Una recogida no garantiza un material en inventario: `disqualified`, `left` y DNF reciben **0** materiales de esa carrera según B09. |

Las recogidas de alguien que termina `disqualified`, `left` o DNF **siguen retiradas del recorrido** y cuentan para el grupo y su contribución personal, aunque su premio sea cero. Solo `finished` puede recibir el plástico y metal que Go confirmó para ese jugador; Rust aplica el settlement según la arquitectura. El resultado competitivo puede mostrarse antes de que llegue la actualización del perfil, sin sumar materiales en el cliente. Tras el resultado, se puede recordar la elección preventiva de **Reducir** confirmada según [B14](three-r-design.md) y orientar a **Canjear (Reciclar)** o **Taller (Reutilizar)** cuando haya materiales efectivamente acreditados; esas operaciones no alteran el contador de agua de la carrera cerrada.

## Secuencia educativa y responsabilidades

La secuencia del MVP es **Reducir antes** de la carrera al elegir botella reutilizable o desechable; **recoger durante** la carrera residuos virtuales presentes en el agua representada; y, **después**, decidir si los materiales acreditados se destinan a canje/Reciclar o fabricación/Reutilizar. Reducir representa prevención y no añade ni retira objetos del recorrido. Recoger es una acción virtual, no una medición de saneamiento real.

| Responsable | Regla B15 |
| --- | --- |
| **Frontend** | Muestra mensaje previo, HUD, objetos/efectos, contribución personal y resumen común. Envía solo las intenciones de carrera permitidas. No declara pickups, propiedad, totales globales, premios ni saldos como verdad. |
| **Go Match Service** | Mantiene el conjunto del curso, decide propiedad única de cada residuo y deriva retirados, restantes y contribución por participante del estado autoritativo. Conserva esa verdad para snapshots, reentrada y resultado global; no necesita una base de datos separada de «agua». |
| **Rust Player/Profile Service** | No interviene en el tick ni en el estado del agua. Valida canje, fabricación y settlement de perfil posteriores; no decide ni reescribe qué objetos salieron del recorrido. |

Los futuros snapshots/resultados deben permitir reconstruir el total del curso, el estado o propietario de cada residuo y las contribuciones sin reproducir todos los eventos. Los eventos pueden disparar feedback puntual, pero no reemplazan esa verdad. **E43** definirá los campos, mensajes y transporte; B15 no congela DTO, endpoint ni frecuencia. Tampoco exige persistir un porcentaje de «agua limpia» o estadísticas educativas históricas.

## Casos que debe conservar la implementación

| Caso | Comportamiento del objetivo compartido |
| --- | --- |
| Dos jugadores tocan el mismo objeto | Go adjudica **un propietario** y cuenta **una retirada**. [B09](multiplayer-decisions.md) establece la prioridad general; B16 precisará el cálculo. |
| Descalificación, salida o DNF tras recoger | Los objetos adjudicados no reaparecen. La contribución sigue en el resumen aunque B09 dé 0 materiales de esa carrera. |
| Desconexión y reentrada | El objetivo común no retrocede ni pausa al grupo. Al volver, el cliente recupera objetos y HUD del estado autoritativo, sin volver a sumar eventos pasados. |
| Primer jugador en meta | Puede esperar o espectar; las recogidas posteriores de otros siguen actualizando el total hasta el fin global. |
| Residuos sin recoger al cierre | Se muestran como «residuos virtuales que quedaron en el recorrido», sin sanción ni afirmación de contaminación ambiental real. |

## Límites del lenguaje y continuidad

Se permiten textos como «Recogiste 5 objetos» o «El grupo retiró 37 de 80 residuos virtuales del recorrido». **No** se permite «limpiamos el 46 % del río», «redujimos el 46 % de contaminación», «salvamos X litros», «retiramos X kg», «calidad del agua: 80 %», «agua pura» o «ecosistema recuperado». Una fracción **Y de Z** describe únicamente objetos del juego; no se convierte en porcentaje de calidad o impacto ambiental. El ODS 14 es un marco temático, no una contribución medida. Las métricas observables sostienen la trazabilidad del diseño educativo, pero no prueban aprendizaje ni cambio de conducta.

- **B16**: precisar curso versionado, recogida disputada, reglas de carrera y ranking sin cambiar el significado de las métricas de agua.
- **B17**: formalizar sala, participación, reentrada, fin individual y fin global.
- **E43**: definir cómo se comunica el estado recuperable y el resultado a los clientes, sin aceptar contadores declarados por ellos.
- **B18**: incorporar esta decisión y su estado de implementación al GDD.

Fuentes: [B08](frontend-baseline.md), [B09](multiplayer-decisions.md), [B10](online-player-flow.md), [B12](educational-goals.md), [B13](core-gameplay-loop.md), [B14](three-r-design.md) y la [descripción del prototipo](../../apps/web/docs/backend/README.md). El [plan web](../../apps/web/PLAN.md) describe el feedback visual existente; sus observaciones históricas no fijan las reglas finales de B16.
