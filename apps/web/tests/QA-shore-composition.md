# Revisión de orillas · pase 03 · 2026-10-13

Implementación descrita en [SHORE_COMPOSITION.md](../art/SHORE_COMPOSITION.md). Las capturas corresponden al render 3D del proyecto; el acabado artístico sigue en revisión.

## Comprobaciones automatizadas

- `npm run check`: correcto, incluidos los cuatro módulos nuevos.
- `npm test`: 49 pruebas aprobadas, ninguna fallida u omitida.
- Blender 5.2.1 guardó `shore-study.blend` con sus componentes y exportó aldea/manglar: 1 571 564 y 1 042 512 bytes, respectivamente.
- `node art/verification/check_environment.mjs`: ambos destinos tienen geometría y matrices finitas. Maracaibo conserva una separación de banco de 24 m y 26 lotes instanciados; Orinoco registra 33,19 m y 27 lotes.

La prueba nueva carga los GLB reales y comprueba ausencia de casas en el manglar, colores/normales finitos, geometría compartida, composición determinista y sin modificar el recorrido, profundidad en ambas orillas, posición fuera del canal y reutilización de matrices al volver a salida. La espuma de costa usa las ondas compartidas y el tiempo se mantiene al pausar; movimiento reducido lleva ese tiempo a cero.

El paisaje completo de Maracaibo suma 1 208 144 triángulos instanciados. La selección por cámara registra 539 888 en salida, 749 112 a 450 m y 522 824 a 900 m. Es un recuento del paisaje instanciado, no de una imagen completa ni una medida de GPU. Excluye agua, terreno no instanciado, actores, obstáculos, puente y el segundo dibujo de cámara.

## Navegador integrado

En escritorio, con viewport de 1280 × 720, se revisaron salida, mitad y meta desde `scene-review.html`. Se vio costa continua, grupos de palafitos/manglares, rocas y plantas, y la continuación de vegetación después de la meta. El puente permaneció delante. Cambiar a Orinoco mostró su agua verde dorada y vegetación del delta, con el puente oculto. La consola consultada de paisaje no presentó errores ni advertencias.

Se abrió una carrera real de Maracaibo con Amara y Red reutilizada. Una prueba sin conducir llegó a una descalificación a 473 m / 00:30; indicó que el residuo recogido no se acreditaba. Una nueva carrera con el paisaje final se capturó activa a 84 m / 00:05: tres vidas, un plástico y 20 % de impulso. Se pausó y se abandonó. Se vieron estelas, señales de recogida y la costa desde ambas cámaras. La consola consultada de esa carrera no presentó errores ni advertencias.

La prueba vertical usó un viewport efectivo de 390 × 844. Se abrió Maracaibo, se pasó la red a la izquierda con Z y se pausó a 170 m / 00:10: tres vidas, cero residuos e impulso vacío. Controles táctiles, vista trasera, puente y recolección quedaron dentro de la pantalla. La consola consultada no mostró errores ni advertencias. La carrera se abandonó y se retiró el tamaño temporal.

El perfil de prueba de localhost conservó 0 monedas, 44 plásticos y 27 chatarras; se restauró Nico y quedó Maracaibo. No se compraron ni canjearon objetos. La pestaña habitual de 127.0.0.1 se recargó y conservó 150 monedas, Nico, Coral, Costero, Red costera y su destino Orinoco. Se cerraron las pestañas temporales y quedaron el juego, el estudio de paisaje, el de movimiento y la escena piloto.

## Capturas

- `preview-maracaibo-orillas-v3.jpg`: carrera activa, versión final del paisaje.
- `preview-maracaibo-meta-orillas-v3.jpg`: composición a 900 m con el paisaje continuado al fondo.
- `preview-movil-orillas-v3.jpg`: formato vertical pausado, red izquierda y costa visible.

## Límites y siguiente iteración

La carrera real no llegó a la meta en este pase; la vista estática y las pruebas de datos verifican la composición a 900 m. Se consultó el panel de diagnóstico durante una versión intermedia, pero no se acredita una cifra de FPS de la versión final ni se midió tiempo de GPU. La emulación de tamaño no sustituye probar un teléfono físico.

El paisaje mantiene dos familias repetidas con variaciones de orientación y escala. Admite más variedad de edificios, follaje y terreno. El siguiente pase se centra en la familia de Nico, Luna y Samuel, cuyos modelos siguen siendo más simples que Amara. La ilustración aceptada continúa siendo una referencia de cuidado y composición.
