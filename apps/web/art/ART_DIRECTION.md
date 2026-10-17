# Compunube · Dirección artística

Versión 1 · 2026-10-13 · guía revisable para mejorar el juego existente.

## Intención

Un juego de surf venezolano con personajes de caricatura, agua luminosa y escenarios que se reconocen por su composición. La imagen debe transmitir una mañana cálida, movimiento y ganas de explorar. Se busca cuidado en formas, materiales, luz y animación, conservando la claridad de una carrera con recogida de residuos.

La base jugable ya está construida. El siguiente trabajo concentra el esfuerzo en su presentación: transformar modelos y escenas de prototipo en un conjunto con identidad. Las fases se revisan comparando imágenes y jugando; pueden ampliarse, repetirse o cambiar de orden cuando el resultado lo requiera.

## Diagnóstico de partida

La captura `preview-diagnostico-artistico.jpg` registra el aspecto previo, pausado. Las rocas repiten un volumen casi esférico; personajes, herramientas y vegetación comparten demasiadas formas simples. El agua, la niebla y los objetos tienen valores próximos, por lo que cuesta separar profundidad y protagonismo. El puente estaba a 260 m de la salida dentro de una carrera de 900 m y quedaba detrás al pasarlo. La vista trasera ocupa parte del horizonte central. La espuma mejoró el contacto, pero por sí sola no resuelve estos problemas de diseño.

## Referencia e interpretación

[Wavetale, galería oficial de Thunderful](https://thunderfulgames.com/games/wavetale/) aporta una referencia útil de agua, siluetas y organización del paisaje. La [captura oficial elegida](https://thunderfulgames.com/wp-content/uploads/2021/11/Wavetale_Screenshot_01_1920x1080.jpg) muestra un personaje con presencia, masas de fondo distintas y una paleta que relaciona cielo y agua. Estas son observaciones visuales para orientar nuestro trabajo; no implican reproducir sus modelos, personajes, efectos ni nivel de producción.

Compunube conserva sus propios elementos: puente Rafael Urdaneta estilizado, palafitos, manglares, tablas, recogedores y residuos. Maracaibo y Orinoco tendrán familias de color relacionadas, pero una identidad ambiental diferente. Las futuras referencias de Caroní y confluencia se investigarán antes de producir sus recursos.

## Composición y jerarquía

El personaje, la tabla y la boca de la red deben leerse juntos en primer plano. Las siluetas de obstáculos y residuos guían las decisiones en el plano medio. El puente caracteriza el fondo de Maracaibo durante toda la carrera; el sol nace visualmente desde ese sector del horizonte y deja una trayectoria de luz sobre el agua.

El puente pasa a ser un elemento escénico lejano, separado de la distribución de colisiones y del avance hacia la meta. En el primer pase acompaña el avance desde una distancia constante de 430 m delante del jugador. Esto es una decisión de composición para el juego, no una representación geográfica a escala. La cámara trasera sigue mirando atrás al pulpo; el puente queda delante, en su posición escénica.

La iluminación principal será cálida desde delante y el relleno lateral tendrá el tono necesario para separar los volúmenes. Agua y vegetación necesitan valores suficientemente distintos para separar superficies. Los reflejos deben dar dirección y ambiente sin tapar basura, salvavidas o amenazas. Se revisarán reflejo, halos y espuma simultáneamente, en movimiento y a tamaño de juego. El [pase 04](REFERENCE_ALIGNMENT.md) incorpora relleno cálido, sombras y radiancia del cielo; el acabado sigue en revisión.

El HUD conserva corazones pequeños sin contenedor y materiales compactos. La vista trasera aprobada se mantiene; en escritorio se coloca bajo los indicadores de la izquierda para dejar libre el horizonte central. En móvil conserva la posición lateral existente y la cámara se retrasa ligeramente, mirando más hacia el horizonte para separar el puente de los indicadores superiores. La cámara cenital es una alternativa de conducción y tendrá su propia revisión: su encuadre no muestra el horizonte como la cámara principal.

## Paleta inicial

| Función | Maracaibo | Uso |
|---|---|---|
| Agua profunda | `#168D9A` | Masa principal, profundidad y contraste |
| Agua de orilla | `#57CFB5` | Transición de bancos y agua baja |
| Cielo | `#55ACEB` | Aire y distancia |
| Horizonte cálido | `#FFD8AC` | Dirección solar y atmósfera |
| Piedra azul gris | `#536B73` | Obstáculos de tono frío |
| Arenisca | `#AA8966` | Variación cálida de piedra |
| Coral del jugador | `#EF795E` | Punto de atención y vínculo con la interfaz |

Estos colores describen la base, no el resultado exacto de cada píxel: iluminación, gestión de color y tone mapping cambian su apariencia. En Orinoco se utilizan verdes dorados, bosque más denso y horizonte cálido; el puente de Maracaibo permanece oculto.

## Lenguaje de formas y materiales

**Rocas:** masas asimétricas con planos grandes, esquinas gastadas, coronas inclinadas y zonas oscuras en contacto con el agua. La variedad incluye una forma alta, arenisca baja, roca fracturada y laja. Rotación y tamaño complementan modelos diferentes. Una variación de color no reemplaza una variación de silueta. Las piedras de orilla usan la misma familia en escalas menores.

**Personaje:** rostro visible, cabello con mechones diseñados, torso y extremidades con mejor transición y ropa que tenga grosor, costuras y volúmenes. El siguiente pase debe explorar una silueta más expresiva de espalda y de frente, manteniendo el carácter animado. Los apoyos sobre la tabla y el alcance del recogedor se revisarán con las proporciones nuevas.

**Redes:** boca abierta, aro con grosor, bolsa en U con fondo y profundidad, mango con uniones, empuñadura y materiales diferenciados. Los detalles deben seguir viéndose desde la cámara de carrera. Evitar una bolsa tan densa que parezca una pieza maciza o una malla tan fina que desaparezca. Las variantes deben comunicar su diseño mediante forma y construcción, conservando los agarres y el punto de recogida.

**Paisaje:** alternar grupos y espacios abiertos. Dar a palafitos, muelles, canoas, raíces y copas una organización intencional. El recorrido debe sentirse compuesto por tramos reconocibles, con profundidad y variación de escala, sin llenar cada hueco con adornos. Nubes y aves acompañan la escena, sin competir con las señales de recogida.

**Materiales:** distinguir piedra mate, madera, tela, metal y plástico mediante color, rugosidad y geometría. Desgaste localizado en lugares plausibles. Usar texturas cuando aporten algo visible a tamaño de juego; se priorizan materiales y colores por vértice cuando bastan.

## Fases de trabajo

| Fase | Resultado para revisar | Estado |
|---|---|---|
| Dirección y composición | Guía, paleta, puente al frente, cielo y luz solar coherentes | Primer pase integrado |
| Familia de obstáculos | Cuatro rocas de Blender, siluetas distintas en carrera y orillas | Primer pase integrado |
| Personaje y herramientas | Propuestas de proporción, ropa y red; después modelos y agarres | Pase 03 integrado: cuatro personajes, cinco tonos de piel, seis colores de cabello, cinco peinados y siete recogedores cosméticos; revisión abierta |
| Paisaje y atmósfera | Vegetación, nubes, estructuras y tramos con mejor composición | Orillas ilustradas integradas en Maracaibo; profundidad, costa continua y espuma. Revisión artística abierta |
| Movimiento y acabado | Animaciones con los nuevos volúmenes, espuma, reflejos y señales ajustados juntos | Iteración continua |
| Consolidación | Comparación entre mapas, pantallas y equipos; ajustes de calidad según medición | Abierta |

El [pase 05](PAINTED_SCENERY.md) añade follaje pintado sobre superficies curvas, palafitos más construidos, raíces, perfiles de roca y sombras de orilla. La revisión cercana permite valorar esas piezas antes de ampliar su variedad. La comparación con la ilustración y el cuidado de personajes/ropa siguen siendo prioridades.

Para personaje y redes se empieza por una propuesta de silueta y un modelo representativo. Se compara dentro de la cámara real antes de producir todas las variantes. La ropa no se reducirá permanentemente a cambios de color; su geometría se desarrollará después de estabilizar el personaje base.

Estas fases son una guía de producción, con señales amplias para decidir cómo seguir. El contenido puede crecer y los criterios se ajustan al jugar. El objetivo de cada revisión es que el conjunto resulte más atractivo, legible y coherente; pasar pruebas técnicas no acredita por sí solo calidad artística.

La segunda imagen de [CONCEPT_SCENE.md](CONCEPT_SCENE.md) es la dirección elegida. El [pase piloto de Amara](AMARA_PILOT.md) comienza su traslado a 3D: un modelo específico integrado y una escena de comparación con pequeña orilla, agua y luz. El parecido y acabado siguen abiertos a revisión; esta escena es una primera iteración.

El [pase 02 de acabado ilustrado](ILLUSTRATED_RENDER.md) integra luz, materiales, agua y espuma en los dos destinos, y rehace el puente con pilares sólidos y abanicos de cables. La composición de las orillas y el modelado de los otros personajes continúan en la siguiente iteración; el aspecto se revisa tanto en la escena piloto como jugando.

El [pase 03 de composición de orillas](SHORE_COMPOSITION.md) lleva la familia de la escena piloto a Maracaibo, con aldeas, manglares y profundidad por ambos lados. La costa continua une los grupos; espuma y plantas acompañan el borde. La selección por tramos limita los bancos que se dibujan. El modelado de los demás personajes sigue siendo el próximo foco de trabajo.

## Producción y revisión

Blender 5.2.1 LTS se usa mediante scripts locales en segundo plano. Las fuentes `.blend` permanecen editables; los `.glb` son recursos de ejecución. Los scripts utilizan una sesión de fábrica independiente de los proyectos abiertos. Se registran cambios por familias de modelos para poder revisar y regenerar una pieza sin rehacer toda la escena.

La nueva familia de piedra se genera con `build_rocks.py` y conserva `rock-kit.blend`. Cada GLB tiene una malla, colores por vértice y un material. El navegador usa cuatro lotes compartidos para los obstáculos y cuatro por paisaje para sus piedras. Cambiar de mapa conserva geometría, materiales y buffers. La composición actual de Maracaibo y sus costes se registran en `SHORE_COMPOSITION.md`.

`dist/art-direction.js` comparte la dirección solar entre cielo, luz y agua. El reflejo del primer pase es una interpretación mediante shader, con destellos fragmentados; no refleja todos los objetos del entorno. Se conservan las ondas compartidas con tablas, basura y espuma, la pausa y la preferencia de movimiento reducido.

El [estudio de paisaje](http://127.0.0.1:4173/scene-review.html) usa los modelos y shaders reales para inspeccionar salida, mitad y meta, comparar las rocas y cambiar de mapa. Es una vista estática, separada del perfil y de la simulación. Complementa las capturas de partidas; no sustituye jugar ni sirve para acreditar fluidez.

Cada pase incluye una captura antes/después desde un encuadre comparable, inspección de los modelos cercanos, revisión en móvil y una partida cuando el entorno permita evaluar el movimiento. Las pruebas comprueban invariantes relevantes: colisiones, agarres, matrices, guardado y congelación. El rendimiento se medirá en equipos físicos antes de fijar niveles de calidad; aumentar detalle exige revisar también coste de dibujo, memoria y transparencia.

## Referencias técnicas

- [Three.js, DirectionalLight](https://threejs.org/docs/pages/DirectionalLight.html): dirección determinada por posición y objetivo.
- [Three.js, ShaderMaterial](https://threejs.org/docs/pages/ShaderMaterial.html): uniformes, shaders y gestión de color.
- [Three.js, InstancedMesh](https://threejs.org/docs/pages/InstancedMesh.html): geometría compartida y límites por lote.
- [Blender, exportación glTF](https://docs.blender.org/manual/en/latest/addons/import_export/scene_gltf2.html): fuente y formato de intercambio del flujo ya existente.

## Pendientes expresos

El pase 01 cambia composición, luz, agua y rocas. El [pase 02 de surfistas y crafteo](CHARACTERS_AND_CRAFT.md) añade cabello, construcción de ropa, recogedores y movimiento de traslado; no da por terminado el acabado. Siguen abiertos cortes de prendas, personalización por componentes y el arte del puente, vegetación, nubes y mapas. La referencia elegida establece una dirección de cuidado visual, sin prometer una reproducción exacta ni un salto de calidad uniforme en una sola entrega.
