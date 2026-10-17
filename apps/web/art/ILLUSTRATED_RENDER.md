# Acabado ilustrado · pase 02

La segunda imagen de `CONCEPT_SCENE.md` continúa como referencia. Este pase trabaja valores, luz, materiales y agua en la escena piloto y las carreras reales. El modelado del resto de personajes y escenarios sigue abierto; el acabado de la imagen aún es más elaborado.

## Cambios integrados

`illustrated-water.js` conserva las ondas físicas de `water-surface.js`, pero cambia el tratamiento de superficie: manchas de pigmento, trazos deformados por ruido y reflejos solares fragmentados. La paleta depende del destino: Maracaibo mantiene azul turquesa; Orinoco conserva sus verdes dorados. El mismo tiempo visual alimenta ondas, espuma, basura y tablas. La pausa y movimiento reducido conservan sus comportamientos anteriores.

`illustrated-materials.js` añade degradados amplios, variación muy sutil y un borde cálido a los materiales glTF. Conserva colores elegidos, emisiones, sombras, rig e instancias. Las zonas de piel y cabello reciben un pequeño relleno de su propio color para mantener lectura en sombra. Los personajes y equipo poseen y liberan sus copias; los materiales de paisaje comparten una copia por fuente. Los colores y acabados cosméticos no cambian estadísticas.

La luz solar llega desde el sector del puente con una elevación mayor, el sol tiene un disco más amplio y el puente gana presencia vertical. Su posición sigue a 430 metros delante del jugador y permanece fuera de las colisiones. Blender sustituye sus soportes de varillas por pilares macizos con cabezales, vigas biseladas y abanicos de cables. Se guarda una fuente independiente `maracaibo-bridge.blend`; el recurso de ejecución conserva tres materiales y mide 644 084 bytes. La cámara de carrera es más cercana y baja; las etiquetas de surfistas son menores. La vista trasera y los corazones aprobados se conservan.

La estela gana anchura, manchas interiores y contraste. La espuma de contacto tiene bordes más irregulares y mayor presencia. Ambos efectos reutilizan geometría y buffers existentes; no se añade una luz ni un emisor independiente por residuo.

## Orilla piloto de Blender

La fuente `shore-study.blend` incorpora tres palmeras, siete manglares de distintas alturas, siete plantas bajas y dos casas con porches, barandas y escalones. Los degradados se pintan por vértice en sus componentes editables; el nodo Vertex Color asegura que el GLB exporte esos colores. El archivo final conserva diez materiales y mide 1 526 036 bytes. El paisaje completo del juego aún usa su composición existente; esta nueva orilla continúa en la vista piloto antes de extenderla al recorrido.

Amara usa Oscuro como apariencia inicial para acercarse al tono de la referencia. Los cinco tonos siguen disponibles y los colores guardados se conservan; escoger otro personaje aplica su apariencia inicial como antes.

## Revisión y coste

Las operaciones de material ocurren al crear actores o paisajes. No se recrean geometrías para animar; las manchas del agua y reflejos se calculan en el shader. La orilla conserva los lotes por material y comparte geometría entre sus dos copias. El shader del agua tiene más trabajo por píxel: esta decisión exige medir rendimiento en dispositivos físicos antes de fijar ajustes de calidad. No se acredita una cifra de FPS con las pruebas de funcionamiento.

La compilación real en WebGL forma parte de la revisión. Se corrigió un identificador reservado de GLSL que impedía dibujar el agua y se añadió una comprobación de regresión. Las pruebas automatizadas también cubren color por vértice, reutilización/restauración de materiales y sombreado de geometrías con rig o instancias.

## Referencias técnicas consultadas

- [Material de Three.js](https://threejs.org/docs/pages/Material.html): personalización de compilación y claves de programas de shader.
- [Manual de sombras de Three.js](https://threejs.org/manual/pages/shadows.html): cámara de sombras de DirectionalLight y alcance de sus límites.

Los fragmentos de shader se contrastaron además con la versión de Three.js incluida en `dist/vendor`, y la exportación de colores se verificó con Blender y GLTFLoader del proyecto.

Las capturas, tamaños de pantalla y límites de la comprobación están en [QA-illustrated-render.md](../tests/QA-illustrated-render.md).

Este documento registra el pase 02. El [pase 03 de orillas](SHORE_COMPOSITION.md) integra después la familia de vegetación en Maracaibo, regenera sus modelos y añade terreno continuo y selección de tramos cercanos; allí se registran los tamaños y costes actuales.
