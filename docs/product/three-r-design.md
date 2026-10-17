# B14 · Diseño de las tres R y decisión de Reducir

**Estado:** diseño del MVP cerrado; la nueva decisión de Reducir **aún no está implementada**. Los [objetivos educativos B12](educational-goals.md) definen qué debe poder observar el jugador; la [línea base B08](frontend-baseline.md) distingue lo que ya funciona en la demo local de lo pendiente en línea. Esta especificación no demuestra aprendizaje ni impacto ambiental real.

## Tres decisiones distintas

| R | Acción jugable y momento | Respuesta que debe entender el jugador | Soporte y límite |
| --- | --- | --- | --- |
| **Reducir** | **Antes de cada carrera**, escoger una botella reutilizable en vez de una desechable como preparación. | La elección reutilizable queda marcada para esa participación; al terminar se explica que representa prevenir un **residuo virtual potencial** antes de que exista. Elegir la desechable también permite correr y recibe una invitación a probar la otra opción. | **Diseño B14; implementación pendiente.** Es una decisión educativa, sin premio ni efecto en la carrera. No cuenta residuos físicos evitados. |
| **Reciclar** | **Después de la carrera**, entregar plástico o chatarra virtual en **Tienda → Canjear** a cambio de monedas del juego. | El canje confirmado muestra qué material se entregó, cuánto bajó el inventario y cuántas monedas se recibieron; el texto debe asociar la acción con Reciclar. | **Sistema local existente; feedback educativo por completar.** Es una representación lúdica, no una simulación de una planta ni del proceso físico de reciclaje. Se conserva la economía actual. |
| **Reutilizar** | **Después de la carrera**, gastar materiales recuperados en una receta de red del **Taller**. | La fabricación confirmada muestra los materiales consumidos y el objeto cosmético obtenido; el texto debe asociar el nuevo uso dentro del juego con Reutilizar. | **Sistema local existente; feedback educativo por completar.** No representa una transformación industrial real. Se conservan las recetas y el crafting actuales. |

Canjear y fabricar son destinos distintos de las **mismas unidades finitas**: una unidad gastada en uno ya no puede financiar el otro. Los materiales se acreditan según las reglas de resultado existentes; B14 no cambia precios, recetas, premios ni condiciones de acreditación. Las operaciones online de canje y fabricación pertenecen al perfil autoritativo de Rust, no a saldos que declare el navegador.

## Reducir: preparación antes de la carrera

La pregunta breve del MVP es **«¿Qué llevas para hidratarte?»**, con dos opciones visualmente equivalentes: **«Botella reutilizable»** y **«Botella desechable»**. La interfaz debe permitir elegir cualquiera y continuar. No es una pregunta con acceso bloqueado ni un examen; la diferencia educativa se ve en la consecuencia explicada. Para cada carrera se hace una elección nueva, de modo que el jugador pueda comparar decisiones.

1. En modo local, presentar la elección **antes de iniciar** la carrera. En línea, presentarla **antes de solicitar `ready`**; el cliente espera la confirmación de Go antes de tratarla como elección de esa participación. B17 determinará las transiciones exactas de sala y E43 cómo se comunica la intención.
2. La elección reutilizable representa **prevenir** el uso de un desechable y marca una acción de Reducir para esa participación. La desechable queda igualmente registrada como elección, sin marcar Reducir. La selección no crea ni retira objetos del recorrido.
3. La selección queda asociada a **esa participación**, no al inventario, al equipamiento ni a una estadística persistente. En una carrera posterior debe elegirse de nuevo. Si hay reconexión online, el cliente recupera la elección confirmada; no la reconstruye a partir de almacenamiento local.
4. Al presentar el resultado de la participación, mostrar según corresponda: **«Reducir: elegiste una botella reutilizable antes de la carrera»** o **«Reducir: esta vez elegiste una botella desechable; prueba una reutilizable en la próxima»**. El feedback describe la elección confirmada incluso si la participación termina descalificada o sin premio; no implica que se haya acreditado material. La integración exacta con estados terminales corresponde a B17/E43.

La elección **no modifica** velocidad, impulso, vidas, posición, recogidas, ranking, materiales acreditados, monedas ni cualquier ventaja competitiva. Tampoco se añade durabilidad, rotura o reparación de redes/tablas: eso exigiría inventario y balance nuevos y mezclaría Reducir con Reutilizar. Un ejemplo fijo basta para el MVP; otros hábitos pueden estudiarse después.

El texto preferido comunica **la decisión**, no una equivalencia física. Si una interfaz futura presenta «1 decisión de reducción realizada» o «1 residuo virtual potencial evitado», debe rotularlo expresamente como **contador del juego** y mostrarlo solo para la opción reutilizable. B14 no exige añadir ese contador ni convertirlo en saldo o recompensa.

## Secuencia, agua y autoridad

| Momento | Concepto y hecho observable | Responsabilidad en local y online |
| --- | --- | --- |
| Preparación | **Reducir:** elegir opción reutilizable o desechable antes de que exista el residuo potencial. | El frontend presenta la elección. En local conserva la elección de esa carrera. En línea **Go confirma y asocia** la decisión con la participación antes de `ready`/inicio; el frontend muestra solo esa confirmación. |
| Carrera | **Agua:** recoger residuos virtuales en los escenarios estilizados de Maracaibo u Orinoco; es limpieza dentro del juego. | En local la demo simula la carrera. En línea Go decide recogidas, estado y resultado; los clientes muestran hechos confirmados según [B13](core-gameplay-loop.md). Rust no participa en el tick. |
| Tras la carrera | **Reciclar:** canjear materiales. **Reutilizar:** fabricar una red con materiales recuperados. | La demo local usa su economía existente. En línea Rust valida y aplica canje/fabricación de forma atómica e idempotente, coordinado por Go; el frontend presenta el perfil confirmado. |
| Resultado y ayuda | Relacionar cada acción realizada con su R y distinguir elección educativa, materiales de juego y premio económico. | La interfaz explica hechos de la participación confirmados por Go y operaciones de perfil confirmadas por Rust. No infiere una R que no se realizó ni acredita recursos por mostrar feedback. |

La secuencia conceptual es **prevenir antes de generar un residuo potencial → recoger residuos virtuales presentes en el agua → decidir el destino de los materiales recuperados**. Reducir no requiere que aparezca una botella extra en el agua; la opción desechable tampoco añade basura al recorrido. [B15](educational-goals.md#continuidad) concretará el objetivo y feedback del agua. Aquí no se define una barra de limpieza, calidad del agua ni recuperación ecológica.

## Información conceptual para B17 y E43

Para poder observar y volver a presentar la decisión online, el modelo futuro debe considerar:

- la **opción elegida** por cada participación y si quedó confirmada para la carrera actual;
- la **identidad de participación/carrera** a la que pertenece, de modo que repetir una carrera exija una elección nueva y una reconexión recupere la ya confirmada;
- el **hecho de Reducir realizado o no** derivado de la opción confirmada, para el feedback del resultado individual, incluido un cierre sin premio;
- la separación entre esa decisión educativa, el **resultado de carrera** confirmado por Go y el **perfil/economía** confirmados por Rust.

Esta lista expresa necesidades de producto, **no nombres de campos, DTO, endpoints ni transporte**. En particular, `reduceActionCompleted` es solo una idea conceptual del handoff, no un contrato. [B17](../roadmap.md) cerrará el ciclo de sala/participación y reentrada; **E43** decidirá cómo transportar y recuperar esta información. Rust no tiene que guardar logros ni estadísticas educativas para B14.

## Límites de comunicación

- Los contadores de objetos, materiales y acciones son **métricas virtuales**. Nunca traducirlos a kg retirados, litros salvados, porcentajes de contaminación o impacto físico del Lago de Maracaibo o del Río Orinoco.
- Los mapas son **escenarios estilizados inspirados** en esos cuerpos de agua; no son simulaciones geográficas o ecológicas exactas. El ODS 14 es un marco temático, no evidencia de contribución cuantificada.
- La secuencia **acción → feedback → concepto** satisface trazabilidad de diseño. Afirmar aprendizaje o cambio de hábitos requiere evaluación con usuarios, fuera de B14.
- No recompensar la opción reutilizable con monedas, materiales, impulso o ventaja de ranking. La elección desechable tampoco bloquea la carrera ni resta recursos.

## Continuidad

- **B15:** concretar el papel del agua y su feedback sin métricas ambientales ficticias.
- **B16:** cerrar reglas de carrera y balance, sin convertir Reducir en modificador competitivo.
- **B17/E43:** resolver asociación y recuperación de la elección confirmada en sala/carrera y su representación contractual.
- **B18:** incorporar este diseño al GDD, distinguiendo decisiones cerradas de implementación pendiente.

Fuentes: [B08](frontend-baseline.md), [B12](educational-goals.md), [B13](core-gameplay-loop.md), [B09](multiplayer-decisions.md), [B10](online-player-flow.md), [estado del prototipo](../../apps/web/docs/backend/README.md) y [plan web](../../apps/web/PLAN.md). Los ejemplos económicos históricos de [DESIGN.md](../../apps/web/DESIGN.md) no cambian las operaciones actuales.
