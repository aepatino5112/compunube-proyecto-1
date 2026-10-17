# Movimiento y contacto · 12 de octubre de 2026

## Ajuste aplicado

La elevación de la red dependía directamente del contador de recogida. Otro residuo reiniciaba ese contador y podía devolver la red de golpe a su posición baja. `surf-motion.js` añade una respuesta amortiguada con estado propio por surfista, manteniendo continuidad al recoger repetidamente. El traslado Z/X tiene una pequeña elevación al cruzar; la rotación horizontal y el alcance de recogida siguen perteneciendo a la simulación.

El pecho compensa el giro y la cabeza acompaña el gesto de recogida. Se guarda la pose original de ambos huesos antes de esos ajustes para no acumularlos al pausar. Durante el salto, el clip de salto tiene prioridad sobre los de giro e impulso. Los clips de Blender de recogida, aterrizaje y golpe se muestrean según sus contadores de juego: 0,75 s, 0,55 s y 1,15 s. Esto evita que el gesto de cuerpo siga un reloj distinto al de la red o al contacto.

Al caer, la tabla tiene un hundimiento breve de hasta 5,5 cm y un rebote de hasta 2,2 cm; la inclinación acompaña la subida y bajada. Son ajustes de presentación. La física del salto, dirección, colisiones y recogida conserva sus valores.

La onda de aterrizaje ahora queda anclada en el punto donde la tabla tocó el agua y sigue la altura de esa superficie. No se desplaza con el surfista. Un pequeño abanico de diez gotas utiliza el conjunto existente de 48 partículas; el evento se consume una vez y respeta la preferencia de movimiento reducido. La pausa conserva las poses y los efectos; reiniciar limpia el movimiento, onda y evento pendiente.

Se reutilizaron los ocho clips y modelos existentes de Blender. No se generó un GLB nuevo en este pase ni se añadió un contexto WebGL a la carrera.

## Pruebas

`npm run check`: aprobado. `npm test`: **35 pruebas aprobadas**. Las cinco comprobaciones añadidas cubren continuidad tras recoger de nuevo, traslado de la red, respuesta estable a diferentes frecuencias para un objetivo constante, pausa/reinicio, compresión y rebote sin mutar el estado de juego, onda anclada/expiración y sincronización de clips con los agarres y apoyos durante una secuencia de gestos.

Las pruebas cargan el GLB real y verifican manos y pies durante cambios de lado y recogidas interrumpidas, con un error inferior a 0,012 unidades de mundo. Repetir una actualización con tiempo cero no acumula los ajustes de pecho/cabeza. Las pruebas existentes de economía, seis equipos, reloj y supervivencia siguen pasando.

## Revisión en navegador

`animation-review.html` permite reconstruir manualmente cada gesto con pasos de 1/120 s. Incluye recogida seguida, cambio de red, salto/aterrizaje y giro/impulso, con vistas frontal, trasera y lateral. Utiliza los mismos modelos, mezclador, agarres, respuesta de movimiento y onda de la carrera. Su superficie sencilla sirve para inspección; no representa el mapa completo ni mide su rendimiento. No lee ni modifica el perfil.

Se revisaron la recogida, el traslado y el contacto lateral tras caer. `preview-movimiento.png`, `preview-cambio-red.png` y `preview-aterrizaje.png` conservan capturas de esas poses. La vista manual evita depender del avance de la cuenta atrás para inspeccionar el equipo. Una comprobación de descarga bloqueó la herramienta del navegador; se recuperó la sesión y se retiró esa función auxiliar. La revisión final conserva controles de pose y vista, sin descarga.

La sesión recuperada permitió jugar Orinoco de forma continua: giro con A/D, red izquierda con Z y derecha con X, y salto con espacio. El panel mostró muestras de intervalos cercanos a 7 ms durante este tramo; no constituye un promedio de fps ni una medición separada de GPU. `preview-movimiento-carrera.png` muestra el juego activo a 18 s/282 m, y `preview-salto-carrera.png` muestra el salto a unos 42 s/652 m. No se detectaron errores ni advertencias de consola en la carga y el tramo revisado. El jugador no había recogido materiales en estas capturas, por lo que mantener Shift no valida aquí un impulso con carga.

La carrera terminó por descalificación a los 44 s/693 m, tras perder las tres vidas. El resultado indicó que no se guardaban materiales; el pulpo todavía estaba a 31 m en ese momento. Se revisó el estado final sin errores de consola. Esta partida prueba el tramo activo y la transición al resultado, pero no es una llegada a meta ni una prueba de recogida con impulso.

Se usó `localhost:4173` para la carrera de prueba. El menú habitual de `127.0.0.1:4173` cargó el equipo previo y sus 150 monedas. Las capturas del estudio son poses reconstruidas, y las de carrera corresponden a juego activo: ninguna se presenta como una validación completa del acabado final.

## Continuación

Comparar estas transiciones durante más partidas con recogida e impulso activos. Pulir contacto con orillas y obstáculos, la legibilidad del HUD sobre el agua y el equilibrio de contraste entre mapas. La geometría de los brazos y los gestos expresivos todavía pueden refinarse en Blender. Los cambios de este pase no cierran el arte ni el balance de dificultad.

Referencias consultadas: [AnimationAction](https://threejs.org/docs/pages/AnimationAction.html) y [AnimationMixer](https://threejs.org/docs/pages/AnimationMixer.html).
