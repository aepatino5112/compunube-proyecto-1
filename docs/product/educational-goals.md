# B12 · Audiencia y objetivos educativos

Este documento fija a quién se dirige Compunube y qué debe poder observarse en el juego para sostener su intención educativa. Es una **decisión de diseño**, no una medición de aprendizaje ni una afirmación de impacto ambiental. La [línea base B08](frontend-baseline.md) describe el prototipo local actual; el juego en línea y su autoridad siguen en diseño.

## Audiencia y contexto de uso

La audiencia principal son **adolescentes de educación secundaria, aproximadamente de 12 a 17 años**. Se prevén sesiones breves en clase o laboratorio, demostraciones educativas y sesiones individuales guiadas. No se presupone conocimiento previo de sostenibilidad, programación o ciencias ambientales. Las instrucciones y respuestas del juego deben usar palabras concretas, explicar las tres R con ejemplos visibles y permitir entender el objetivo sin una exposición larga del docente.

Docentes y facilitadores son audiencia secundaria: pueden presentar la actividad y conversar después sobre las decisiones del jugador. Observadores universitarios pueden revisar el prototipo y su trazabilidad educativa. Estas funciones no convierten el juego en una evaluación escolar ni acreditan resultados de aprendizaje.

## Objetivos y evidencia observable

| Objetivo | Qué debería poder hacer o reconocer el jugador | Evidencia observable en el juego | Estado |
| --- | --- | --- | --- |
| **OE1 · Distinguir las tres R** | Relacionar **Reducir**, **Reutilizar** y **Reciclar** con una decisión concreta, y explicar que no son la misma acción. | Elegir una acción correspondiente a cada R y recibir una respuesta que nombre la decisión y su consecuencia dentro del juego. | **Parcial**: canje y fabricación existen; falta una acción jugable de Reducir y feedback educativo explícito para las tres. |
| **OE2 · Relacionar residuos y agua** | Reconocer que el juego representa residuos **virtuales** en cuerpos de agua y que gestionarlos y evitar que lleguen allí son decisiones distintas. Los recorridos se inspiran en el Lago de Maracaibo y el Río Orinoco. | Ver la recogida y el cambio de contadores del juego, vinculados en la interfaz con el objetivo de cuidar el agua representada; la prevención deberá tener una decisión visible cuando B14 la defina. | **Parcial**: mapas y recogida existen; B14 debe abordar la prevención y B15 hacer explícito el vínculo con el agua y su feedback. |
| **OE3 · Decidir el destino de materiales** | Identificar que un material obtenido en la carrera puede canjearse o destinarse a fabricar una red, y que gastarlo en una opción impide usar la misma unidad en la otra. | Comparar el material disponible antes y después de canjear o fabricar; recibir una explicación breve de la elección y del recurso consumido. | **Parcial**: la economía local descuenta recursos; B14 debe reforzar la explicación de Reciclar y Reutilizar. |
| **OE4 · Practicar Reducir** | Tomar una decisión jugable de prevención o menor consumo **antes de generar o usar recursos**, cuya consecuencia se pueda comprobar en el estado de la partida. | Acción, estado resultante y feedback que explique cómo esa decisión representa Reducir. | **Brecha explícita**: hoy Reducir aparece como contenido educativo, sin mecánica propia. B14 debe diseñarla e implementarla; este documento no presupone una solución concreta. |
| **OE5 · Interpretar las cifras** | Leer HUD y resultado como cantidades y progreso **del juego**, sin convertirlos en medidas del ambiente real. | Distinguir materiales, monedas, tiempos o resultados virtuales de cualquier medida física o de contaminación; textos de interfaz coherentes con esa distinción. | **Parcial**: hay contadores y resultados locales; su explicación educativa debe revisarse con B14/B15. |

“Evidencia observable” significa que una persona puede ver la secuencia **acción → respuesta del juego → concepto**. No equivale a demostrar que el jugador aprendió, cambió hábitos o mejoró su conocimiento. Eso requeriría una evaluación con participantes y criterios definidos por separado. No se exige aquí un cuestionario ni un sistema nuevo de seguimiento.

## Trazabilidad entre concepto y mecánica

| Concepto | Acción y feedback de la base actual | Estado educativo y trabajo siguiente |
| --- | --- | --- |
| **Reciclar** | Canjear plástico o metal obtenido en la carrera por monedas; el inventario baja y se confirma el canje. | **Parcial**. El canje existe en local; B14 debe explicar claramente por qué se usa como representación lúdica de Reciclar, sin equipararlo a un proceso real de reciclaje. |
| **Reutilizar** | Gastar materiales en el taller para fabricar redes; la receta consume recursos y muestra el objeto. | **Parcial**. La fabricación existe en local; B14 debe conectar la elección y su feedback con Reutilizar. |
| **Reducir** | El menú menciona el hábito; no hay decisión jugable ni consecuencia verificable. | **Pendiente, B14**. OE1 y OE4 no se cumplen por completo con texto informativo. |
| **Cuidado del agua** | La red recoge residuos virtuales en los mapas jugables de Maracaibo y Orinoco, y el HUD/resultado muestran cantidades de juego. | **Parcial, B15**. Explicitar el objetivo y el feedback sin presentar el recorrido como limpieza de agua real. |
| **Recursos finitos y elección** | Los objetos recogibles y materiales son limitados; una unidad gastada en canje ya no está disponible para fabricar, y viceversa. | **Parcial, B14**. Hacer comprensible ese intercambio en la explicación de las tres R. |

Las acciones descritas corresponden al **prototipo local**. Los adaptadores de sala y perfil en línea todavía no conectan con servicios; sus resultados, materiales y saldos no se deben describir como confirmados por un backend. Véanse la [guía del frontend](../../apps/web/README.md), el [estado de integración](../../apps/web/docs/backend/README.md) y la [separación de autoridad B13](core-gameplay-loop.md).

## Límites de los mensajes educativos

- Usar expresiones como «recogiste 4 objetos virtuales» o «gastaste 2 unidades de plástico del inventario». Los números del HUD, la tienda y el resultado son **métricas del juego**.
- No afirmar «retiraste X kg de residuos», «ahorraste X litros de agua», «redujiste X % de contaminación» ni inferir equivalentes físicos a partir de contadores virtuales.
- Presentar Lago de Maracaibo y Río Orinoco como **escenarios estilizados inspirados en esos lugares**, sin atribuir al juego una representación geográfica o ecológica exacta.
- Tratar las tres R como conceptos practicados mediante decisiones lúdicas. El canje y la fabricación no simulan cadenas reales de reciclaje o reutilización.
- Describir la relación con el **ODS 14** como temática educativa; no afirmar una contribución ambiental cuantificada.
- No afirmar aprendizaje, cambio de conducta ni eficacia pedagógica sin un estudio con usuarios. Las observaciones de uso del prototipo solo mostrarían qué hizo el jugador y qué feedback recibió.

## Continuidad

- **B14**: definir y verificar una mecánica de Reducir, y reforzar el vínculo acción–feedback–concepto de las tres R y del gasto de materiales.
- **B15**: hacer explícito el objetivo de cuidado del agua y revisar el feedback de recogida y las cifras visibles.
- **B18**: incorporar estos objetivos, audiencia, estados y límites al GDD sin convertir los pendientes en funciones ya entregadas.

Fuentes de estado: [B08](frontend-baseline.md), [plan del frontend](../../apps/web/PLAN.md), [guía de integración](../../apps/web/docs/backend/README.md) y [B13](core-gameplay-loop.md). Los bocetos y cifras históricas del frontend no sustituyen el estado actual descrito en B08.
