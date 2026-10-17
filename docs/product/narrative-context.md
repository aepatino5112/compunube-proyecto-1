# B11 · Narrativa y contexto educativo del MVP

**Estado:** marco narrativo cerrado para el GDD y futuros textos de interfaz; **no añade contenido jugable**. La identidad visible **«Surf Club»** sirve como club/comunidad que organiza retos de surf en recorridos estilizados inspirados en cuerpos de agua venezolanos. En el prototipo se pueden jugar **Maracaibo y Orinoco**. No se afirma que esos mapas reproduzcan con exactitud su geografía o ecología.

## Premisa breve

Cada participante surfea, esquiva obstáculos y busca llegar a meta. **Llegar primero** es la meta competitiva; **retirar residuos virtuales del recorrido** es el objetivo compartido de cuidado del agua. Ambos avances se leen por separado, conforme a [B09](multiplayer-decisions.md) y [B15](water-objective.md). La recogida de otra persona también contribuye al grupo, incluso si esa participación no recibe materiales al final. El juego no moraliza por el puesto obtenido ni convierte la cantidad recogida en desempate de carrera.

La secuencia educativa del club sigue las decisiones cerradas en [B14](three-r-design.md): **Reducir antes** de la carrera mediante la elección de botella reutilizable o desechable; **recoger durante** la carrera residuos virtuales presentes en el agua representada; y **Reciclar o Reutilizar después** cuando el perfil haya acreditado materiales, mediante **Canjear** o el **Taller**. Reducir es prevención y no altera la física ni los objetos del recorrido. El canje y la fabricación son representaciones lúdicas de las R, no procesos industriales simulados.

El **pulpo** es una amenaza ficticia de gameplay que persigue al surfista. No se presenta como especie real, diagnóstico ambiental ni consecuencia comprobada de contaminación. Personajes, equipo y mapas apoyan la presentación del club; no requieren biografías, antagonistas o una trama adicional para explicar las acciones.

## Mensajes guía para la interfaz

| Momento | Texto o criterio editorial |
| --- | --- |
| Inicio | «**Surfea, esquiva y recoge residuos virtuales mientras cuidas el recorrido.**» Mantener visibles la meta competitiva y el objetivo común sin prometer limpieza física. |
| Preparación · Reducir | Usar la pregunta cerrada en B14, «**¿Qué llevas para hidratarte?**», con **Botella reutilizable** y **Botella desechable**. Ambas permiten correr; al final se explica la elección confirmada. |
| Antes de salir · agua | «**Objetivo de agua: retira residuos virtuales del recorrido mientras llegas a la meta.**» |
| Durante | Mostrar el avance de carrera y **«Cuidado del agua»** como lecturas separadas: objetos propios y total compartido confirmado, sin medir contaminación. |
| Resultado | Presentar por separado **estado/puesto competitivo**, **contribución personal y del grupo** y **materiales acreditados o pendientes**. Quien queda `disqualified`, `left` o DNF puede haber contribuido, aunque reciba 0 materiales de esa carrera. |
| Después | Si hay materiales acreditados, orientar a **Canjear = Reciclar** o **Taller = Reutilizar**. Si no hay premio, conservar el feedback de Reducir y del recorrido sin inventar saldo ni castigar con un mensaje moralizante. |

Estos textos son guía para implementación posterior: la [línea base B08](frontend-baseline.md) confirma el prototipo local, mientras que la decisión jugable de Reducir de B14, el HUD compartido de B15 y el modo online autoritativo **todavía no están implementados**. [B12](educational-goals.md) define la audiencia y la trazabilidad **acción → feedback → concepto**, no una eficacia educativa medida.

## Límites y continuidad

- Decir **«inspirado en»** al referirse a Maracaibo y Orinoco. No afirmar que el club limpia físicamente un río/lago, restaura ecosistemas, retira kg, salva litros o reduce un porcentaje de contaminación.
- Usar **ODS 14** solo como marco temático. No atribuir al juego contribución cuantificada ni cambios de conocimiento, conciencia o conducta sin evaluación con usuarios.
- Mantener el relato ligero: **sin campaña, capítulos, quests, misiones persistentes, NPC, cinemáticas obligatorias, diálogos ramificados ni progreso narrativo en backend**. El pulpo sigue siendo una regla de carrera ficticia, no un personaje con historia necesaria.
- **B18** incorporará esta premisa y los mensajes al GDD junto con B12–B17. **D28/E43** desarrollarán runtime y contratos sin requerir una capa narrativa nueva. B11 no cambia reglas, economía, ranking ni multijugador.

Fuentes de producto: [B08](frontend-baseline.md), [B09](multiplayer-decisions.md), [B10](online-player-flow.md), [B12](educational-goals.md), [B13](core-gameplay-loop.md), [B14](three-r-design.md) y [B15](water-objective.md).
