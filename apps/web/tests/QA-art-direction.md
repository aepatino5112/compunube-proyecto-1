# Dirección artística · primer pase

2026-10-13. Implementación de composición, luz, agua y familia de rocas. Guía de producción: `art/ART_DIRECTION.md`.

## Qué se verificó

- Blender 5.2.1 LTS generó `rock-kit.blend` y cuatro GLB de 11–15 KiB. Cada variante exporta una malla con colores por vértice y un material. Las fuentes conservan modificadores; las normales apuntan hacia el exterior. El aviso de caché de miniaturas del entorno no impidió guardar ni exportar.
- Las cuatro geometrías son diferentes y sus vértices horizontales quedan dentro del radio de colisión de 1,8 m. El recorrido continúa usando sus colisiones anteriores. Los modelos se dibujan en cuatro lotes, conservando buffers al cambiar de destino.
- El puente se representa en un horizonte escénico a 430 m delante del jugador. La prueba con el GLB real comprueba que su caja queda delante y corta el frustum de la cámara en salida, 250, 450, 700 y 900 m, con conducción a izquierda, centro y derecha, tanto en escritorio como en retrato. Se conserva el aspecto al congelar la posición. En Orinoco el puente se oculta.
- Sol del cielo, luz direccional y destellos del agua comparten la misma dirección. Una prueba comprueba que el disco solar cabe en los encuadres de escritorio y retrato. El reflejo es una interpretación mediante shader; no refleja edificios ni personajes.
- Se revisaron visualmente salida, mitad y meta, las cuatro rocas y ambos destinos con la vista estática `/scene-review.html`, que usa modelos y shaders compartidos con el juego. Esta vista no ejecuta la simulación, no recoge objetos y no toca el perfil.
- La carrera móvil se abrió a 390 × 844. `clientWidth = scrollWidth = 390`; vidas, materiales, controles y cámara trasera son visibles. Se ajustó el encuadre para mostrar el puente bajo los indicadores superiores y el sol entre los bloques del HUD. La vista trasera de escritorio pasa a la columna izquierda; la de móvil conserva su posición.

## Pruebas y coste

`npm run check` y `npm test`: 38 pruebas pasan. Las dos nuevas cubren el horizonte y los recursos reales de Blender, incluyendo conservación de cursos y buffers. También pasan los casos existentes de ondas, recogida, impulso, supervivencia, animación, agarres y guardado.

`node art/verification/check_environment.mjs`: ambos paisajes pasan. Maracaibo: 27 lotes, 195244 triángulos y holgura de canal 26,94. Orinoco: 27 lotes, 430732 triángulos y holgura 33,19. El agua se extendió para cubrir el fondo delante del jugador al acercarse a la meta. Estos valores describen instancias del paisaje; no incluyen todo el juego ni acreditan FPS.

No aparecieron errores ni avisos de compilación de shaders en las revisiones del navegador. Se restauró el tamaño de pantalla después de las pruebas móviles y se cerraron las pestañas temporales de carrera.

## Capturas

- `preview-diagnostico-artistico.jpg`: aspecto previo, pausado.
- `preview-arte-paisaje.jpg`: composición estática con el primer pase de arte. El rótulo indica la posición que se está revisando.
- `preview-arte-horizonte-meta.jpg`: vista estática de la posición de meta, con el puente delante.
- `preview-arte-rocas.jpg`: cuatro modelos de Blender dentro de la iluminación del juego.
- `preview-arte-movil.jpg`: carrera real pausada en la salida, a 390 × 844, con encuadre móvil actualizado.

Las capturas están en la raíz del proyecto. Las imágenes del estudio son revisiones de composición, no partidas completadas.

## Límite de la prueba de movimiento

Los intentos de carrera en este pase volvieron a activar la pausa protectora al recibir intervalos largos de fotogramas en el navegador de pruebas, antes de avanzar. No se completó una nueva partida con este arte ni se acreditan fluidez o rendimiento sostenidos. Se conserva la protección del reloj y se registra este límite; la carrera completa documentada en el pase anterior pertenece al arte anterior.

## Continuación

Personaje y redes conservan sus modelos anteriores. La siguiente fase debe diseñar y probar su nueva silueta, ropa, volumen de la bolsa y materiales, preservando los apoyos y agarres. También se mantienen abiertos la composición de vegetación, nubes, acabado del puente y equilibrio de iluminación entre mapas. Este pase establece una primera dirección y no acredita el acabado final del proyecto.
