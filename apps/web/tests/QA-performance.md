# Rendimiento · 12 de octubre de 2026

## Diagnóstico del intervalo de fotogramas

La carrera se pausaba con intervalos cercanos a un segundo, aunque el documento figuraba visible. Para separar ese intervalo del coste del juego se creó `dist/frame-probe.html`: solo actualiza un texto con `requestAnimationFrame`, sin Three.js, modelos, efectos ni audio. En esta sesión empezó con una mediana de 16,4 ms (aproximadamente 61 fps), pero después registró 21 fotogramas en 13,2 segundos y una mediana de 1.010,8 ms (aproximadamente 1 fps).

Esto demuestra que el entorno de prueba también entrega fotogramas separados sin la escena 3D. No identifica qué componente del navegador provoca esa limitación ni descarta costes adicionales del juego. La respuesta del usuario fue que no sabía si su propia partida se pausaba; no se considera una confirmación de funcionamiento normal en su dispositivo.

Se conserva el reloj de pasos fijos y la pausa ante interrupciones superiores a 500 ms. No se alteraron velocidad, impulso, recogida, colisiones o recompensas para ocultar el síntoma.

## Cambios aplicados

- Las 72 boyas conservan posiciones, tamaños, colores y geometría, pero sus cuatro componentes se combinan por material y se dibujan mediante dos lotes de instancias. Las matrices se sincronizan al cambiar de destino; los obstáculos mantienen sus posiciones lógicas.
- Una escena pausada o terminada se actualiza y dibuja una vez. Después conserva el fotograma hasta cambiar de cámara, redimensionar o reanudar. El bucle recibe fotogramas, pero evita recorrer efectos, personajes y residuos cuando la escena permanece congelada.
- Cambiar de cámara en pausa invalida el dibujo y aplica la nueva posición sin consumir tiempo de simulación.
- La vista trasera conserva la misma escena y renderizador. Reutiliza referencias a sus etiquetas, modifica el texto cuando cambia y utiliza dimensiones guardadas por su observador de tamaño, evitando lecturas de dimensiones en cada dibujo.
- El panel `?rendimiento=1` muestra intervalos, tiempos de CPU del último dibujo y contadores de ambas cámaras. No aparece en la ruta habitual ni mide la GPU por separado.

## Medición observada

Las muestras corresponden al comienzo de Maracaibo con tercera persona y cámara trasera, en el mismo navegador de prueba. Son fotogramas individuales, no una media de una carrera ni una medición fiable de fps sostenidos.

| Medida | Antes | Después |
| --- | ---: | ---: |
| Llamadas de dibujo, ambas cámaras | 971 | 819 |
| Triángulos, ambas cámaras | 596.886 | 609.066 |
| Actualización JS | 4,3 ms | 3,1 ms |
| Llamada de dibujo principal | 31,0 ms | 30,1 ms |
| Llamada de dibujo trasero | 3,9 ms | 3,4 ms |

Se redujeron 152 llamadas (15,7 %). La agrupación incrementó los triángulos dibujados aproximadamente un 2 % porque el descarte fuera de cámara se hace por lote. La reducción de llamadas no equivale a prometer un porcentaje de mejora de fps; si en equipos físicos el coste de vértices resulta relevante, habrá que comparar lotes por tramos del recorrido.

En pausa, los fotogramas recibidos aumentaron de 141 a 153 mientras los dibujados permanecían en **2**. Pulsar C generó un único dibujo adicional (**3**), con 182 llamadas en la vista cenital. Volver a tercera persona y reanudar aumentó el contador a **6**, mostrando que la invalidación no deja el juego bloqueado en el fotograma congelado. La prueba volvió a pausar por el intervalo largo del navegador.

Orinoco pudo seleccionarse e iniciar su escena después de Maracaibo sin errores ni advertencias de consola. Su lectura inicial fue 818 llamadas y 1.075.906 triángulos; no existe una muestra anterior equivalente para compararla. La limitación de fotogramas impidió una revisión visual en movimiento. El redimensionamiento invalida el dibujo en código, pero no se realizó un nuevo pase de tamaños en esta sesión.

## Verificación y límites

`npm run check`: aprobado. `npm test`: **30 pruebas aprobadas**. La nueva prueba compara los límites precisos de la geometría anterior y la agrupada, comprueba color, transformaciones entre destinos, buffers finitos, geometría reutilizada y 72 instancias repartidas entre dos lotes. Economía, equipamiento, animaciones, supervivencia, reloj y efectos siguen pasando.

La prueba se hizo en `localhost:4173`, con un perfil separado de `127.0.0.1:4173`. No se acreditaron ni gastaron materiales. El menú habitual se recargó al comprobar que no había una carrera activa; conserva sus 150 monedas y equipo. La consola de la prueba no registró errores ni advertencias.

Las capturas de pantalla fallaron en carrera y menú con el mecanismo del navegador. No se presenta una imagen anterior como evidencia de estos cambios. Los valores anteriores se leyeron del panel visible en la página. Sigue pendiente jugar una carrera completa en una sesión activa normal y observar fluidez, giros, espuma y recogida; esta entrega no declara resuelto el rendimiento sostenido ni el arte final.

Para repetir el diagnóstico local: `http://localhost:4173/?rendimiento=1`. Para comprobar el intervalo sin el juego: `http://localhost:4173/frame-probe.html`. El panel conserva los tiempos del último dibujo cuando está pausado; el contador de dibujos permite distinguir ese dato histórico de trabajo nuevo.

Referencia técnica consultada: [WebGLRenderer, contadores y renderizado](https://threejs.org/docs/pages/WebGLRenderer.html).
