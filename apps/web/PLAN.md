# Compunube · plan y estado de entrega

## Estado actual · Preparación front para backend (1.2)

El front añade **Jugar con amigos**, una interfaz de sala y una ruta para presentar carreras autoritativas mediante un adaptador de servicio. **Mi progreso** permite separar el guardado local del perfil confirmado por backend; las operaciones online esperan respuesta y conservan su ID ante resultados inciertos. Ambos proveedores siguen desconectados: no hay cuentas ni partidas entre humanos activas. La carrera local sigue disponible. La [preparación 1.2](docs/FRONTEND_NETWORK.md), el [adaptador de carreras](docs/backend/FRONT_ADAPTER.md) y el [adaptador de perfil](docs/backend/PROFILE_ADAPTER.md) documentan las fronteras propuestas.

El siguiente trabajo conjunto es conectar los proveedores de los compañeros, autenticar la misma cuenta en perfil y salas y verificar partidas y transacciones reales entre varios navegadores. La ruta online no ejecuta la IA ni la acreditación de la demo local. Tienda, taller y cartera admiten el perfil confirmado del servicio; el modo local conserva su propio saldo e inventario.

## Base entregada · Front v1.0

La primera versión local del front reúne **Maracaibo y Orinoco**, cuatro personajes, tres tablas y siete redes cosméticas. El ciclo Inicio → Carrera → Resultados → Club incluye tres rivales de IA, recogida de plástico/chatarra, impulso, tres vidas, salvavidas, persecución, canje, tienda, taller y guardado local. El cierre incluye revisión de deformaciones y tablas, contacto con el agua, espuma/estela y estados de interfaz.

El [resumen de Front v1](docs/FRONTEND_V1.md) es la referencia de lo entregado, su arranque con Node.js 24 y el funcionamiento offline con recursos locales. Ver [tests/QA-frontend-v1.md](tests/QA-frontend-v1.md) para las comprobaciones finales y sus límites. Esta entrega no afirma igualdad exacta con la ilustración ni una cifra de rendimiento universal.

**La fase local v1 queda cerrada como entrega del front.** Este bloque conserva su alcance como historial; la preparación de conexión actual está descrita arriba. El servidor incluido sigue sirviendo archivos estáticos. La IA y la economía local permanecen en el cliente; autenticación, datos de negocio y servidor de partidas corresponden a la siguiente integración.

## Siguiente fase · integración con backend

1. Acordar los contratos y decisiones pendientes de la [entrega backend](docs/backend/README.md), usando sus fixtures y propuesta TypeScript como documentación, no como API existente.
2. Integrar identidad y perfil persistente, catálogo/inventario y transacciones con validación en servidor.
3. Conectar el adaptador del front con el servicio de salas y carreras de hasta cuatro humanos, y acordar reconexión y simulación autoritativa. La interfaz de sala, envío de entradas y presentación de estados están preparados en el cliente; necesitan ese servicio real.
4. Validar recogida y salvavidas de dueño único, daño, persecución, meta y acreditación única de resultados con varios clientes.
5. Comprobar el recorrido completo conectado y ajustar balance con partidas reales.

El orden puede adaptarse con el equipo backend. La frontera técnica conserva las reglas visibles del front y ya distingue carga, conexión, error y salida; la recuperación completa depende de acordar e implementar la política del servicio. Las comprobaciones de cliente con transporte de prueba no sustituyen las partidas reales entre equipos.

## Ampliaciones posteriores a la entrega local

Caroní y Encuentro, transiciones entre ríos, nuevos crafteos y una mecánica propia de reducir quedan fuera de la v1. Pueden retomarse después de la integración y de nuevas pruebas con jugadores. No es necesario producir más contenido ni cambiar de motor para utilizar o presentar esta versión.

Las mejoras visuales posteriores pueden partir de las fuentes Blender y los estudios ya incluidos. Los informes históricos conservan observaciones de sus respectivos pases y no convierten esas antiguas prioridades en tareas que bloqueen esta entrega.

## Historial del plan y de la implementación

**Archivo de decisiones y pases anteriores.** Las secciones siguientes conservan la propuesta original, prioridades, pruebas y limitaciones tal como se trabajaron por fases, con aclaraciones sobre las prioridades ya superadas. Expresiones como «siguiente», «provisional» o «pendiente» pertenecen al momento descrito. El estado vigente y el próximo trabajo están en los apartados anteriores; las cifras de pruebas históricas no son el total del cierre v1.

El maquetado 3D local está aceptado como base. Conservamos la vista de tercera persona, la recolección con la red, el cambio de lado con Z/X y el impulso obtenido al recoger basura. Queremos convertirlo en un juego de surf con identidad venezolana y progresión vinculada a las tres R.

Este orden es una guía revisable. Las señales para avanzar sirven para valorar si la experiencia funciona; no son una lista cerrada de requisitos. Podemos ajustar una fase o regresar a otra cuando las pruebas lo aconsejen.

La dirección de la persecución ya está aprobada: conservar la vista trasera. El HUD se hará más discreto, con corazones pequeños sin contenedor y materiales en un bloque compacto. Antes de incorporar los sistemas se revisa el boceto del menú: Inicio, Tienda y Taller; equipamiento y materiales se abren cuando se necesitan. El usuario ha autorizado continuar con este plan por fases.

### Avance de implementación · primera entrega

**Pase 08 de personajes:** [CLUB_CHARACTERS.md](art/CLUB_CHARACTERS.md) extiende el cuidado de Amara a Nico, Luna y Samuel con geometría, siluetas y ropa propias, coleta/rizos agrupados y modelos integrados por ID. La galería del club permite compararlos desde atrás y de frente. La prioridad de aquel pase fue revisar orillas y deformaciones desde la cámara de juego; los pases siguientes y el cierre v1 recogen su continuación.

**Pase 07 de conjunto:** [SCENE_REWORK.md](art/SCENE_REWORK.md) documenta proporciones y postura de surf revisadas, cámara, luz, color, agua y estelas compartidos con la carrera. El estudio reúne los cuatro actores para valorar el conjunto. La prioridad de aquel pase fue modelar prendas y siluetas propias de Nico, Luna y Samuel y revisar las orillas frente a la segunda ilustración. Los personajes propios se integraron en el pase 08; esta nota registra la decisión histórica.

**Pase 05 de paisaje:** [PAINTED_SCENERY.md](art/PAINTED_SCENERY.md) registra el atlas de follaje integrado en Blender/GLB, nuevas copas y raíces, palafitos con tablones, puerta, ventana y escalera, rocas con perfiles distintos y sombras de orilla. El estudio permite inspeccionar esas piezas de cerca. Aquel pase dio paso a los materiales, construcción y ropa de los personajes, revisados en los pases posteriores con la ilustración.

**Acabado ilustrado de aquel momento (historial):** la segunda imagen elegida guía Amara, el agua, la luz y el puente. El pase 03 integró las orillas de Maracaibo. El pase 04 revisa silueta, equipo, postura, cámara real, sombras, nubes y reflejos, con comparación directa en `/art-study.html`. [REFERENCE_ALIGNMENT.md](art/REFERENCE_ALIGNMENT.md) documenta el resultado y las diferencias pendientes. El siguiente foco de aquel momento fue refinar una pequeña escena y extender su acabado; los pases 06–10 registran ese trabajo posterior. La tecnología queda abierta por autorización del usuario; Blender y el motor web siguen siendo el flujo actual, con Unity como opción a evaluar mediante una escena comparativa.

**Pase 02 de personajes y herramientas:** espalda con ropa construida, emblema de olas, tres peinados seleccionables y siete recogedores cosméticos integrados en el taller. Se refinó el traslado Z/X y se adelantó el mango al torso, conservando la recogida. `art/CHARACTERS_AND_CRAFT.md` documenta este pase y deja abiertos otros cortes de ropa, crafteo de tablas/accesorios y personalización por componentes. Ese pase todavía precedía al acabado del personaje y del mapa que se revisó después.

**Prioridad de arte de aquel pase (historial):** el usuario señaló que el acabado seguía demasiado genérico. La nueva guía `art/ART_DIRECTION.md` concentra los siguientes pases en dirección artística, composición, familia de obstáculos, personaje y herramientas, paisaje y acabado. El primer pase reemplaza la posición del puente dentro del recorrido por un hito de fondo que permanece delante, incorpora un cielo con luz cálida y reflejo ilustrado y sustituye las rocas casi esféricas por cuatro modelos de Blender. Ese primer pase precedió al trabajo de personajes y redes de las revisiones posteriores. La vista `/scene-review.html` permite comparar salida, mitad y meta con los recursos del juego.

El boceto ya se ha convertido en una experiencia integrada en `dist/`: Inicio, Tienda, Taller, carrera y resultados. Maracaibo y Orinoco están disponibles; Caroní y Encuentro se presentan como próximos destinos.

Se adelantó una base de progresión para probar el recorrido completo: plástico y chatarra separados, materiales acreditados al terminar, canje por monedas, compra, fabricación y equipamiento con guardado local. Las tablas y redes ya tienen modelos propios, compartidos por carrera y vista previa; la ropa mantiene variantes de color del chaleco. Abandonar o reiniciar no acredita materiales, y la interfaz lo explica antes de salir. Precios y recetas siguen abiertos a balance.

El kit inicial creado con Blender incluye una interpretación estilizada del puente, palmeras y tabla. Se conserva la fuente editable en `art/maracaibo-kit.blend` y se exportan GLB al navegador. La escena incorpora aves y una interfaz de carrera más compacta. Ese kit pertenecía al primer pase artístico, revisado después; el paisaje sigue siendo una interpretación estilizada, sin reproducir el lago a escala.

### Avance de implementación · supervivencia

La carrera incorpora tres vidas para cada surfista, protección temporal después de un golpe y descalificación al quedarse sin vidas. Los salvavidas son compartidos, se recogen al pasar con la tabla y recuperan una vida sin superar tres. Un jugador con salud completa los deja disponibles. Saltar permite esquivar obstáculos, pero no evita al pulpo.

El pulpo ya tiene fuente editable en `art/octopus.blend`, modelo GLB y movimiento de tentáculos exportado desde Blender. Su distancia responde a la velocidad real: los choques permiten que se acerque y el impulso abre espacio. Se aleja después de un contacto, incluso si una protección activa impidió el daño, para evitar pérdidas encadenadas. En esta versión local sigue al jugador humano; el reparto de la amenaza entre jugadores reales se revisará con el multijugador.

La vista trasera usa una segunda cámara de la misma escena. Muestra distancia y aviso de cercanía; los corazones permanecen pequeños y sin contenedor. Hay un aro de protección, señales breves de daño/recuperación, una onda de aterrizaje y ajustes en la postura y el agarre de la red. El personaje ya combina clips propios de Blender con ajustes por código para mantener los apoyos y agarres.

**Decisión provisional de economía:** descalificarse no acredita materiales de esa carrera y conserva el inventario anterior. Se explica en controles y resultados; se puede revisar al equilibrar dificultad y progresión. Llegar a la meta conserva el flujo existente de guardado, tienda y taller.

### Avance de implementación · dirección de caricatura

La dirección elegida es de caricatura 3D: proporciones expresivas, formas redondeadas, colores vivos y detalles legibles desde la cámara de carrera. Se aplica al surfista, la fauna y el paisaje.

El surfista ya tiene cuerpo modelado en Blender, fuente editable y GLB compartido entre menú, tienda y carrera. Incluye cabeza grande, rostro, pelo por mechones, chaleco y pies redondeados. El material del chaleco permite las variantes de ropa existentes. Su esqueleto y los clips animados se complementan con agarres y apoyos calculados en el navegador. El agua incorpora bandas turquesa y espuma dibujada; las colinas y las rocas son más suaves y se añadieron nubes de volúmenes simples.

**Prioridad de aquel pase (historial):** mejorar la sensación de surf y el acabado del agua, residuos y animaciones en Maracaibo y Orinoco antes de producir Caroní. En aquel momento, los dos paisajes y el equipo todavía precedían a los pases de acabado posteriores. Los valores de persecución, protección y recuperación son ajustes iniciales, no criterios cerrados.

### Avance de implementación · agua y lectura de residuos

La revisión detectó tres debilidades visibles: ondas que casi no alteraban la iluminación, una estela triangular pegada a la tabla y el mismo aro fino para todos los residuos. El primer pase de acabado reemplaza esa base por una superficie con ondas e iluminación en movimiento, espuma que conserva el recorrido de cada surfista y señales propias para cada material.

Los plásticos llevan un halo azul transparente con aro continuo; la chatarra, un halo naranja con aro segmentado. La forma complementa el color. Los residuos flotan y se balancean sobre la misma superficie que las tablas, conservando su silueta de botella, envoltorio o tubo oxidado en J. Al recoger aparece una onda breve del color del material. Los objetos y sus señales se retiran juntos, sin dejar otra basura visual que parezca recogible.

Las tablas acompañan la altura y pendiente del agua. Los giros inclinan al surfista, el cuerpo compensa parte de ese movimiento y la cámara se acerca ligeramente para leer mejor el equipo. Las estelas se ensanchan con el impulso, se disipan y dejan de generarse al saltar. Pequeñas salpicaduras al girar/acelerar comparten un conjunto limitado de gotas con el escurrido de la red. Estos efectos se construyen en Three.js; los modelos y clips existentes siguen procediendo de Blender.

**Continuación abierta de esta misma fase:** revisar las transiciones del cuerpo y la red en partidas completas, el contacto y la espuma de orillas/obstáculos, contraste e iluminación entre mapas y rendimiento sostenido en equipos físicos. El pase actual mejora la base, pero no establece todavía el acabado final. Se prioriza esta coherencia antes de sumar escenarios o contenido a la tienda. El ritmo y balance se ajustarán con esa experiencia visual más clara.

El segundo ajuste suaviza la inclinación de la tabla y mueve la compensación del giro al pecho, conservando los pies apoyados. La red sube, sostiene y baja con un ritmo más claro. La espuma mantiene su dibujo sobre el recorrido, acompaña la popa entre muestras y se separa al saltar. Las pruebas de movimiento, agarres, pausa y reinicio pasan; la revisión visual de estas transiciones sigue pendiente por los intervalos largos de dibujo observados en el navegador de pruebas. No se da por resuelto el rendimiento.

### Avance de implementación · diagnóstico y coste de dibujo

Una página sin escena 3D reprodujo los intervalos cercanos a un segundo del navegador de pruebas. Esto permite separar un factor del entorno del coste propio de la escena, pero no da por validada la fluidez en el dispositivo del usuario. Se mantiene la pausa protectora del reloj.

Las 72 boyas ahora comparten dos lotes de instancias. En una muestra equivalente de Maracaibo, ambas cámaras pasaron de 971 a 819 llamadas de dibujo, con aproximadamente un 2 % más de triángulos por el descarte por lote. La escena congelada deja de actualizar y redibujar sus objetos hasta cambiar de cámara, tamaño o estado. La vista trasera reutiliza sus etiquetas y dimensiones. El diagnóstico es opcional y no ocupa el HUD normal.

Las 30 pruebas y la comprobación de sintaxis pasan. El panel confirma que la pausa conserva el contador de dibujos y que cambiar de cámara o reanudar lo incrementa. El informe `tests/QA-performance.md` recoge muestras y límites: sigue pendiente una carrera activa completa y la revisión visual de transiciones. La siguiente prioridad continúa siendo el movimiento del cuerpo/red, el contacto con el agua y la coherencia visual entre los dos mapas; estos ajustes no cierran el arte ni el balance.

### Avance de implementación · continuidad de gestos y aterrizaje

La red ahora amortigua su elevación para evitar una bajada brusca al recoger residuos consecutivos y cruza de lado con una pequeña elevación. Los clips existentes de Blender siguen la fase real de recogida, aterrizaje y golpe; el salto tiene prioridad en el aire. Pecho y mirada acompañan el gesto conservando los apoyos y agarres. La tabla comprime y rebota ligeramente al caer; la onda queda en el punto de contacto y las gotas usan el conjunto de partículas existente.

Una vista manual permite inspeccionar los gestos y sus apoyos con los modelos reales sin modificar partidas. Las 35 pruebas pasan y una sesión recuperada del navegador permitió revisar un tramo activo en Orinoco, incluyendo cambios Z/X y salto. El informe `tests/QA-surf-contact.md` separa las poses reconstruidas del tramo jugado y documenta sus límites. Todavía se deben comparar partidas con recogida e impulso activos, refinar la geometría/expresión de los brazos y pulir espuma de contacto e iluminación. El HUD también necesita contrastarse sobre las superficies claras del agua.

### Avance de implementación · espuma de contacto y lectura de la carrera

Rocas, boyas y bancos de arena reciben espuma irregular animada sobre la misma superficie del agua. Los obstáculos comparten un lote de instancias, y cada paisaje otro para sus orillas. Cambiar de mapa conserva los buffers y la distribución de colisiones. Se mantiene el movimiento congelado en pausa y se respeta la preferencia de movimiento reducido.

El HUD conserva los corazones sin contenedor y las cantidades compactas. Texto más oscuro, botones claros y fondos suaves en las esquinas mejoran la lectura sobre Maracaibo y Orinoco. Pausar actualiza inmediatamente el aviso de impulso para evitar que siga indicando actividad.

Las 36 pruebas y la sintaxis pasan. Una carrera jugada en Maracaibo llegó a 900 m con 4 plásticos, 3 chatarras y una vida, utilizando recogida, cambio de lado e impulso. La revisión móvil de Orinoco a 390 × 844 confirmó los controles, la lectura de materiales y la pausa sin desbordamiento horizontal. El informe `tests/QA-contact-foam-hud.md` registra capturas y límites. Continúan abiertos el ritmo de recogida frente a rivales, la expresión de brazos/personaje, la iluminación y el rendimiento sostenido en equipos físicos; este pase no da por terminado el arte.

### Avance de implementación · paisaje de Maracaibo

El recorrido incorpora bancos de arena irregulares, vegetación baja, manglares con raíces expuestas y palmeras. Palafitos de colores con muelles y canoas aportan identidad a las orillas. Los tres modelos nuevos tienen fuente editable en `art/shoreline-kit.blend` y se generan con `art/build_environment.py`. Son una interpretación estilizada de elementos del entorno zuliano, sin representar una ruta geográfica a escala.

El agua tiene colores de profundidad y pequeñas ondas animadas en la GPU. Los elementos repetidos se agrupan con instancias y comparten geometría y materiales. El paisaje usa variaciones independientes de la semilla de obstáculos y residuos; conserva el recorrido y sus colisiones. Se verificaron límites de las instancias para mantener despejado el canal central. La miniatura de Maracaibo se obtiene del propio escenario y reutiliza el renderizador existente. El puente se vuelve semitransparente en la cámara cenital para poder ver el recorrido bajo su tablero.

Las formas propias de tablas y redes ya se integran sobre la base animada actual. El rendimiento deberá seguir evaluándose en equipos físicos al añadir detalles o nuevos mapas.

### Avance de implementación · equipamiento con identidad

El kit editable `art/equipment-kit.blend`, generado con `art/build_equipment.py`, contiene seis modelos. Coral conserva la tabla clásica; Manglar incorpora cola de pez, madera recuperada y dos quillas; Sol del lago tiene contorno redondeado, rayos y líneas crema. Las redes comparten la bolsa abierta en U: Costera lleva aro circular, Reutilizada usa un marco cuadrado redondeado y mango de madera con uniones, y Marea incorpora óvalo de doble aro y bolsa más profunda.

Tienda y Taller muestran fotografías de sus modelos reales. Seleccionar un objeto muestra su geometría sin comprarlo ni cambiar el equipo de carrera; equiparlo aplica esa misma pieza. Se conservan los identificadores del guardado existente. Los diseños mantienen velocidad, colisiones y alcance compartidos en esta etapa. Los rivales locales también usan variantes del kit.

Las pruebas cargan los seis GLB y comprueban apoyos sobre las tablas, anclajes de recogida, agarres a ambos lados y materiales independientes entre instancias. Cambiar de equipo libera sus materiales propios y mantiene la geometría reutilizable. La primera revisión tuvo problemas de captura y avance de fotogramas; el pase posterior de reloj y sonido recuperó las capturas y completó carreras con el kit. Los detalles están en `tests/QA-equipment.md` y `tests/QA-race-clock-audio.md`.

Ya se completó un primer pase de carreras completas y sonido, descrito abajo. Densidad de residuos, impulso, persecución y precios siguen abiertos a comparar más partidas antes de ampliar mapas.

### Avance de implementación · ritmo y sonido

Se sustituyó el recorte de tiempo por fotograma por una simulación de pasos fijos de 1/60 s. A velocidades de dibujo bajas el tiempo disponible se reparte en varios pasos; una interrupción superior a medio segundo pausa la carrera. Ocultar la página o perder el foco pausa también la cuenta atrás y la reanuda donde estaba. Pausa, diálogos y reinicio descartan tiempo pendiente. La animación de recogida consume tiempo de simulación.

Se completaron dos carreras de 900 m en el navegador, usando un perfil de prueba en `localhost` separado del perfil real de `127.0.0.1`. La primera terminó en 53 s con 6 de plástico y 3 de chatarra: permitió fabricar y equipar Red reutilizada, con gasto y persistencia comprobados. La segunda terminó en 57 s, con choques, recuperación mediante salvavidas y un contacto del pulpo. Los resultados distintos muestran la influencia del trayecto y de que los rivales retiren residuos compartidos; no bastan para cerrar el balance de dificultad o recompensas. Los precios, alcance y valores de impulso se conservan por ahora.

Se añadieron sonidos procedurales originales de recogida de plástico/chatarra, impulso, salto, golpe, salvavidas, cercanía del pulpo y resultado, con un fondo suave de agua. Un único contexto Web Audio se inicia mediante interacción. Menú y carrera comparten control de silencio con guardado independiente del inventario; pausa y diálogos silencian la escena. El sonido no impide jugar cuando la API falta o está bloqueada. Su mezcla y carácter podrán pulirse con una revisión auditiva en los dispositivos finales.

La revisión en escritorio y móvil confirma que el control nuevo cabe en el HUD. Las 24 pruebas incluyen reloj a distintas frecuencias, pausa, interrupciones, finalización y audio no disponible. El informe y las capturas están en `tests/QA-race-clock-audio.md`. El fallo de captura del pase de equipamiento no se reprodujo y se pudo revisar la escena completa.

El siguiente pase puede comparar estrategias de recogida y la dificultad para principiantes, pulir la mezcla de sonido y preparar la dirección de arte del próximo recorrido venezolano sobre esta base. No se considera cerrado el equilibrio con solo dos carreras.

### Avance de implementación · animación y recogida

El surfista tiene 15 huesos y ocho clips exportados de Blender para postura de surf, giros, impulso, salto, recogida, aterrizaje y golpe. Cada rival y la vista previa poseen su propio esqueleto y mezclador. Las transiciones son suaves; los pies conservan sus apoyos y las manos siguen el mango a derecha e izquierda mediante cinemática inversa. Al recoger, la malla se eleva con el residuo visible dentro y deja caer gotas. Estos detalles visuales conservan el alcance, las colisiones y el balance existentes.

Se mantienen fuentes editables y generadores reproducibles. Las comprobaciones automáticas cargan el GLB real para verificar independencia de personajes, agarres, apoyos, pausa y reinicio. El acabado de los gestos podrá refinarse junto al diseño de nuevas herramientas; esta base permite hacerlo sin sustituir el sistema de animación.

### Avance de implementación · objetos reconocibles y canje

La estación de reciclaje conecta visualmente los objetos del agua con la progresión. Plástico y chatarra se eligen mediante tarjetas con imágenes generadas desde las mismas mallas de la carrera. La vista previa los muestra flotando; antes del canje se ven cantidad entregada, monedas recibidas y saldo resultante. Un recibo confirma la operación y el inventario vacío explica cómo conseguir materiales. El taller reutiliza esas imágenes en las recetas.

La red incorpora una bolsa abierta con fondo curvo en U y entramado visible. Este cambio de forma mantiene los controles y el alcance existente. Se debe seguir evaluando cómo se lee al sumergirse y al levantar residuos.

La chatarra cambió de lata a tubo en J por decisión del usuario. Su acabado incluye óxido irregular, metal expuesto, bocas huecas, acople y abolladuras. Los objetos recogidos usan sus propios modelos dentro de la bolsa durante la animación de recogida.

Referencias consultadas para esta iteración: [fabricación con materiales en Animal Crossing](https://animalcrossing.nintendo.com/new-horizons/create/) como referencia conceptual de objetos y progresión, y [Game Accessibility Guidelines](https://gameaccessibilityguidelines.com/give-a-clear-indication-that-interactive-elements-are-interactive/) para distinguir selección, interacción y estados mediante forma, marcas y contraste. Las imágenes y los modelos usados son del propio proyecto.

La nube y el multijugador real permanecen para una fase posterior. La mecánica propia de «reducir» aún debe diseñarse; el menú la presenta como hábito educativo, sin simular un sistema ya implementado.

### Herramientas y flujo de arte

La recomendación es **Blender + Three.js**, conservando el front-end del proyecto. Blender servirá para crear los modelos, materiales, esqueletos y animaciones; Three.js compondrá los recorridos y manejará cámara, controles, agua, espuma, estelas y efectos durante la partida. No hace falta cambiar de motor para desarrollar esta dirección visual.

Se verificó la instalación local de **Blender 5.2.1 LTS**. No hay un plugin de Blender disponible entre las conexiones de este chat, pero el acceso mediante scripts Python funciona. Una prueba creó un modelo con material y animación, guardó su fuente `.blend`, exportó un `.glb` y comprobó que el Three.js del proyecto lo carga y reproduce su animación. Los archivos de `art/verification/` son diagnósticos, no recursos finales del juego. Si después se incorpora un conector interactivo, será una comodidad adicional; este flujo ya puede usarse.

Los `.blend` conservarán las fuentes editables y los `.glb` serán los recursos que use el navegador. Se priorizará una estética 3D estilizada, con siluetas legibles, personajes expresivos y colores coherentes con el agua y el paisaje. El nivel de detalle se ajustará viendo el resultado dentro de la carrera, sin fijar presupuestos rígidos antes de medir.

### Dar coherencia a la experiencia

**Objetivo:** acordar cómo se relacionan carrera, limpieza, supervivencia y progresión. Preparar propuestas visuales para el menú, los resultados, la tienda y el taller, junto con la lectura del peligro durante la carrera.

El nuevo maquetado de estas ideas será conceptual y estará separado del juego. Permitirá revisar distribución, ambiente y comportamiento esperado antes de incorporar las funciones.

#### Organización del boceto del menú

El inicio dará protagonismo a la vista previa del personaje, su tabla y su red, junto al botón «Jugar». La navegación principal será breve: Inicio, Tienda y Taller. Las monedas estarán visibles en la parte superior; el detalle de materiales se podrá desplegar cuando se necesite, sin ocupar permanentemente la pantalla.

La selección de mapa mostrará Maracaibo, Orinoco, Caroní y «Encuentro» como nombre provisional para la ruta por la confluencia. Desde «Cambiar equipo» se podrá revisar el equipamiento que ya se posee y elegir qué llevar a la carrera.

La tienda agrupará Tablas, Ropa y Canjear. El taller mostrará recetas con una vista previa del objeto y una comparación sencilla entre los materiales que tienes y los que necesitas. Los controles y la explicación de las tres R tendrán accesos discretos al pie del menú.

La tienda y el taller del boceto son navegables y simulan compra, canje, fabricación y equipamiento. Sus precios y saldos son ejemplos; la economía persistente de la carrera se incorporará en la fase de progresión. Se distinguirán los estados de comprar, poseer y equipar, se explicará qué materiales se consumen y se mostrarán respuestas claras cuando no alcance el saldo. Las vistas previas del menú utilizarán los mismos modelos que luego aparecen equipados en el agua.

La dirección artística comenzará con un tramo representativo de Maracaibo, para ver personaje, agua, vegetación y puente juntos antes de producir todos los recorridos. El resultado se revisará dentro del navegador, no solo en un render de Blender.

En carrera, los corazones serán pequeños y sin contenedor, el indicador de materiales será compacto y se conservará la vista trasera aprobada para la persecución. Estos bocetos definen una dirección visual; la distribución y el contenido podrán ajustarse al probarlos.

**Señal para avanzar:** el recorrido entre jugar, recoger, terminar y usar los materiales se entiende, y la dirección visual resulta atractiva.

### Afinar la carrera y la supervivencia

**Objetivo:** mejorar conducción, cámara, recogida y animaciones de la red; probar cómo el pulpo aporta presión sin impedir disfrutar de la limpieza.

La propuesta contempla tres vidas iniciales, con máximo de tres. Un choque o contacto con el pulpo resta una vida, seguido de una breve protección para evitar golpes repetidos. El pulpo se separa después de alcanzarte para permitir escapar. Al llegar a cero, el jugador queda descalificado. Los salvavidas del recorrido permiten recuperar una vida; cada uno se recoge una sola vez y no se consume cuando las vidas están completas.

El personaje base se preparará en Blender para compartir esqueleto entre sus variantes de ropa y usar tablas, mangos y redes intercambiables. Se trabajarán postura de surf, giros, cambio de lado de la red, recogida, salto, aterrizaje, golpe e impulso. Los agarres y las transiciones se probarán dentro de la carrera; los ajustes por código podrán complementar las animaciones para que las manos acompañen las distintas herramientas.

El pulpo tendrá una silueta reconocible y animaciones de tentáculos y persecución que se lean desde la vista trasera aprobada. Espuma, sombra y señales de cercanía reforzarán el peligro sin tapar el recorrido. Las aves aportarán ambiente a distancia y su presencia se ajustará para que no compita con los objetos que hay que recoger.

El avance automático y la basura finita, recogible una sola vez por carrera, evitan generar recursos simplemente esperando. La cercanía del pulpo puede comunicarse mediante un indicador, espuma y tentáculos visibles desde la cámara habitual. Los pájaros pueden enriquecer el ambiente.

**Señal para avanzar:** recoger, esquivar y usar el impulso producen decisiones entretenidas; el peligro se reconoce y las pérdidas de vida se sienten comprensibles.

### Construir la progresión y las tres R

**Objetivo:** distinguir residuos, guardar materiales y equipamiento entre partidas, y dar sentido a monedas, canje y fabricación.

Plástico y chatarra pueden iniciar la clasificación. Cada material empleado se consume en su destino: canjearlo por monedas o usarlo en una receta; no puede financiar ambas operaciones. La tienda ofrecerá tablas, ropa y apariencias. El taller permitirá crear mangos, redes u otras herramientas mediante una interfaz atractiva, con vistas previas y elecciones claras.

Reciclar y reutilizar deben expresarse mediante acciones y transformaciones comprensibles. Para representar reducir, una posibilidad es cuidar y reparar el equipamiento para alargar su vida útil; es una propuesta por explorar, todavía sin implementar. También quedan abiertas las diferencias entre herramientas y el equilibrio de precios. La decisión actual de no acreditar materiales al descalificarse se revisará al equilibrar la progresión.

Los precios y recompensas de DESIGN.md son ejemplos previos, no valores definitivos.

**Señal para avanzar:** jugar permite progresar de forma satisfactoria, las elecciones tienen sentido y se entiende cómo se relacionan con las tres R.

### Desarrollar un mapa piloto con mejor acabado

**Objetivo:** concentrar la mejora gráfica y de animación en un entorno que establezca la calidad del juego: agua, iluminación, personajes, tabla, red, pulpo, paisaje y sonido.

Maracaibo, con el puente al fondo, es un candidato para el mapa piloto. La estilización y los detalles se ajustarán a la legibilidad de la carrera y al rendimiento de los equipos de prueba.

Blender aportará un kit de piezas reutilizables: personajes, herramientas, tablas, pulpo, vegetación, rocas, boyas, estructuras del puente y objetos flotantes. El recorrido se compondrá con esas piezas en Three.js, evitando depender de un único modelo enorme de todo el mapa. El agua, la luz, la atmósfera, la espuma y las estelas se pulirán en el navegador; el aspecto final no dependerá solamente de mejorar las mallas.

Los obstáculos conservarán formas de colisión sencillas independientes del modelo visible. Las referencias del puente y del paisaje se verificarán antes de modelar detalles reconocibles. Se revisarán escala, materiales y animaciones al importar, y se ajustarán luces, sombras, texturas y partículas según el rendimiento observado. Los niveles de calidad podrán añadirse si las pruebas lo requieren.

**Señal para avanzar:** el mapa tiene personalidad reconocible y el conjunto visual acompaña una partida fluida.

### Ampliar los recorridos venezolanos

**Primer paso implementado:** Orinoco ya se puede elegir y jugar. Se tomó el delta como referencia visual, a partir de su combinación de bosques, manglares, caños y ambientes acuáticos descrita por [UNESCO](https://www.unesco.org/en/mab/delta-del-orinoco). Es una interpretación de caricatura, no una ruta geográfica a escala. La vegetación de copa ancha se modeló y exportó con Blender; el agua recibe una paleta verde dorada y el puente solo se muestra en Maracaibo.

Los destinos comparten el motor de carrera, la economía y los modelos de basura/equipo. La distribución de obstáculos y objetos depende de cada mapa. Se mantienen las tres vidas, los salvavidas finitos, el impulso y el pulpo ficticio. Las miniaturas del menú muestran las escenas que se juegan; el destino se recuerda sin migrar ni reemplazar el perfil. Cambiar de mapa reutiliza los objetos del recorrido, evitando reconstruir mallas en cada selección.

**Continuación abierta:** revisar el equilibrio entre recoger y esquivar en ambos mapas, mejorar el ritmo y la variedad de sus tramos y desarrollar la identidad visual de Caroní antes de implementar Encuentro. Puede profundizarse el delta con curvas o cambios de paisaje si las pruebas de conducción lo aconsejan. Aún no existe una transición entre ríos durante una misma carrera.

**Objetivo:** desarrollar Maracaibo, Orinoco, Caroní y una posible ruta por su confluencia, con variaciones de paisaje y conducción. La geografía y las referencias de cada lugar se verificarán al diseñarlo.

Los siguientes mapas aprovecharán el kit de Blender y el acabado establecido por el piloto, variando composición, paleta, vegetación e hitos para darles personalidad propia. La revisión incluirá coherencia con las miniaturas del menú y claridad del recorrido con varios surfistas en pantalla.

**Señal para avanzar:** cambiar de mapa aporta variedad reconocible y mantiene coherencia con el juego y su identidad.

### Preparar el multijugador real

**Objetivo:** llevar la experiencia local a partidas de hasta cuatro jugadores. La nube y la conexión real se abordarán después, fuera del trabajo actual.

Como punto de partida, las vidas serían individuales y la basura compartida tendría un único recolector. La recuperación de vida, el comportamiento del pulpo y la continuidad de la carrera tras una descalificación se revisarán pensando en la equidad entre participantes.

**Señal para avanzar:** las partidas conectadas conservan la claridad y diversión de la versión local, y resultados, materiales y recompensas se registran de forma fiable.

### Referencias del flujo técnico

**Avance visual, pases 06–10:** [Amara y sus agarres](art/CHARACTER_FINISH.md) incorporan prendas y pintura local. La [revisión del conjunto](art/SCENE_REWORK.md) trabaja postura, cámara, luz y agua. [Los personajes del club](art/CLUB_CHARACTERS.md) extienden las prendas/siluetas propias a los otros tres surfistas. El [pase de deformaciones](art/CHARACTER_DEFORMATION.md) corrige inflación de brazos, sisas invertidas y discontinuidades de tela y articulaciones en los cuatro recursos. El [acabado de tablas](art/BOARD_FINISH.md) corrige cubierta, gráficos, goma y quillas. La continuación de ese pase fue el contacto con el agua, giro, espuma y estela durante la carrera, incorporados al cierre v1. Los estudios y fuentes quedan disponibles para mejoras posteriores.

- [Carga de modelos 3D en Three.js](https://threejs.org/manual/pages/loading-3d-models.html).
- [Integración de animaciones exportadas desde Blender](https://threejs.org/manual/pages/animation-system.html).
- [Exportador glTF mantenido por Khronos](https://github.com/KhronosGroup/glTF-Blender-IO/blob/main/README.md).
