# Revisión del acabado ilustrado · 2026-10-13

Pase de `art/ILLUSTRATED_RENDER.md`, tomando la segunda imagen aceptada como dirección. Esta revisión acredita carga, funcionamiento y composición observada; el parecido con la ilustración continúa abierto.

## Comprobaciones automatizadas

- `npm run check`: correcto.
- `npm test`: 48 pruebas, 48 aprobadas, ninguna omitida.
- Blender 5.2.1 exportó el nuevo puente mediante `build_maracaibo.py -- --bridge-only`: fuente independiente guardada y GLB de 644 084 bytes.
- `node art/verification/check_environment.mjs`: ambos destinos mantienen 27 lotes de paisaje, matrices y vértices finitos. Maracaibo: 195 244 triángulos instanciados y separación mínima de orilla 26,94 m; Orinoco: 430 732 y 33,19 m. No incluye actores, obstáculos, puente ni la cámara trasera.

Los tests cargan los GLB reales. Cubren colores por vértice de la orilla, límites, programas de agua distintos, materiales propios sin alterar otras instancias y la posición del puente/sol en las cámaras de escritorio y vertical. Continúan pasando economía, vidas, persecución, agua compartida, recogida, pausa, reinicio, clips, agarres y apoyos.

## Navegador

Se revisó el render WebGL real en el navegador integrado. La primera compilación del agua falló por un nombre reservado de GLSL; se corrigió antes de estas capturas. Las vistas recargadas de escena piloto, paisaje y carrera de Maracaibo no mostraron errores ni advertencias en los registros de consola consultados.

En escritorio, con viewport de 1280 × 720, se observó la carrera de Maracaibo con Amara, reflejo dorado, pigmentos turquesa, estelas de los cuatro participantes, halos y el puente reconstruido. La captura actual registra 262 m / 00:16, tres vidas, un plástico y 20 % de impulso. Se comprobó pausa y continuación. En Orinoco se observó agua verde dorada, espuma y recogida; su captura registra 271 m / 00:17 y la pausa se hizo a 275 m. El puente permaneció oculto allí.

La prueba vertical usó un viewport efectivo de 390 × 844. Se abrió Maracaibo, se cambió la red con Z y se pausó a 83 m / 00:05, con tres vidas, un plástico y 20 % de impulso. Los botones táctiles, recolección, vista trasera y progreso permanecieron dentro de la pantalla; el puente quedó visible al frente. El encuadre vertical todavía reduce el espacio disponible en el horizonte y merece otra revisión artística. La consola consultada no presentó errores ni advertencias. Se retiró el tamaño temporal al terminar.

En la escena piloto se revisaron composición, frente y espalda, incluido el final del cambio de lado con la red a la izquierda. Se dejó la composición a 35 % del movimiento. La vegetación piloto conserva piezas editables y color por vértice; aún no reemplaza las orillas de las carreras.

Las carreras de prueba se abandonaron antes de la meta. El perfil de prueba de localhost conservó 0 monedas, 44 plásticos y 27 chatarras; volvió a Nico y Maracaibo. En la pestaña habitual de 127.0.0.1, la recarga conservó 150 monedas, Nico, Coral, Costero, Red costera y Orinoco. No se compraron ni canjearon objetos en este pase. Se cerraron las pestañas temporales; quedaron juego y vistas de revisión.

## Capturas

- `preview-escena-ilustrada-v2.jpg`: composición del piloto, puente nuevo y orillas en revisión.
- `preview-maracaibo-ilustrado-v2.jpg`: carrera real activa con el nuevo puente.
- `preview-orinoco-ilustrado-v2.jpg`: carrera real, verde dorado.
- `preview-movil-ilustrado-v2.jpg`: carrera vertical pausada, red izquierda y controles táctiles.

## Límites y siguiente pase

No se completó una carrera en este pase ni se midieron FPS sostenidos o tiempo de GPU. Las carreras completas de revisiones anteriores y las pruebas de simulación no sustituyen medir este shader en dispositivos físicos. No se acredita compatibilidad con un teléfono real a partir de un viewport emulado.

El paisaje completo conserva su distribución anterior. Nico, Luna y Samuel todavía utilizan su modelo previo; reciben los nuevos materiales, pero no el rediseño de proporciones de Amara. Sigue pendiente enriquecer y extender la vegetación, dar volumen y personalidad a los demás personajes, trabajar nubes y ajustar el equilibrio entre reflejo y señales. La imagen aceptada conserva un acabado más elaborado que el juego actual.
