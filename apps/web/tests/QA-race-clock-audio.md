# Reloj y sonido · 12 de octubre de 2026

## Problema y cambios

El avance anterior usaba `min(delta, .05)`: por debajo de 20 FPS descartaba tiempo y ralentizaba la carrera. La simulación ahora consume pasos fijos de 1/60 s, conserva el resto entre dibujos y pausa cuando hay más de .5 s entre fotogramas. La pausa cubre la cuenta atrás, pérdida de foco, página oculta y diálogos; reanudar/reiniciar no recupera tiempo de la interrupción. El temporizador de recogida pasó a la simulación.

El fallo de captura de la revisión anterior dejó de reproducirse. Esto permitió observar modelos, poses, cambios de lado y orillas en carreras completas. La causa concreta de la captura fallida anterior sigue sin confirmarse; el cambio del reloj corrige un problema independiente demostrado en el código.

## Pruebas automáticas

`npm run check` y `npm test`: 24 aprobadas.

- Reloj alimentado con 10, 15, 30, 60 y 120 FPS: mismo tiempo, integración controlada de movimiento, recogida con las funciones reales de contacto y distancia de persecución. Esto valida el reloj y esas funciones, no sustituye una medición de FPS de toda la escena.
- Pausa descarta el resto pendiente; una interrupción larga solicita pausa sin ejecutar pasos; terminar corta los pasos restantes de ese fotograma.
- Audio ausente o bloqueado no impide iniciar. Silenciar evita crear un contexto mediante `unlock`.
- Se conservaron pruebas de economía, supervivencia, animaciones, agarres y equipamiento.

## Navegador y perfil de prueba

Se abrió `http://localhost:4173/`, cuyo almacenamiento es distinto del sitio habitual `http://127.0.0.1:4173/`. No se sembraron recursos ficticios. La pestaña real se encontró inicialmente pausada a 34 m; la automatización no controló esa partida ni gastó sus materiales. Al cerrar la prueba, la pestaña real estaba en Tienda con 150 monedas; ese cambio se produjo fuera de las acciones de la prueba. Solo entonces se recargó desde el menú para mostrar la versión nueva, comprobando las 150 monedas restauradas y el control de sonido visible.

1. Carrera completa: 900 m, 53 s, segundo puesto, 9 residuos (6 plástico, 3 chatarra), 2 vidas y pulpo a 27 m al terminar. Recogida, cambio Z/X, impulso y un choque funcionaron. Guardado confirmado por la pantalla final.
2. Taller: se fabricó Red reutilizada usando exactamente los 6/3 de esa carrera. Se equipó y recargó: el modelo equipado persistió. No se canjearon los mismos materiales.
3. Sonido: el control de menú guardó silencio tras recargar; activar actualizó los controles. En móvil se pausó la cuenta atrás, se reanudó y comenzó la carrera sin saltarla.
4. Segunda carrera completa con Red reutilizada y sonido integrado: 900 m, 57 s, cuarto puesto, 1 plástico, 1 vida al terminar. Hubo choques, recogida de salvavidas y contacto del pulpo seguido de retirada. Menor recolección al quedar detrás de los rivales es coherente con residuos compartidos finitos. Son dos recorridos distintos, no una comparación controlada entre redes.
5. Consola sin errores ni advertencias tras los eventos y la meta. Se verificó el control de silencio y la ausencia de fallos de la API; la calidad perceptiva del audio necesita escucha en los dispositivos finales.
6. Tamaños escritorio y móvil 390×844: controles caben, sin desbordamiento horizontal. Se restauró el tamaño al terminar.

## Evidencia

- `preview-carrera-reloj.png`: 360 m, 8 residuos, red a la izquierda.
- `preview-carrera-completada.png`: primera meta y materiales acreditados.
- `preview-carrera-sonido-movil.png`: HUD móvil con audio y pausa de cuenta atrás.
- `preview-carrera-completada-sonido.png`: segunda meta con audio integrado y red fabricada.

## Decisiones pendientes

Se conserva por ahora +20% de carga por residuo, gasto de 25%/s, multiplicador de velocidad 1.4, persecución y precios. Una carrera observada permitió fabricar la primera red; otra dejó pocos materiales al perder ritmo. Harán falta trayectos variados y jugadores principiantes para decidir si ajustar densidad, recompensas o presión del pulpo. No se afirma un rendimiento mínimo de hardware a partir de estas pruebas.

## Documentación consultada

- [Pasos fijos y acumulación de tiempo, Glenn Fiedler](https://gafferongames.com/post/fix_your_timestep/).
- [Tiempos y suspensión en segundo plano de requestAnimationFrame, MDN](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame).
- [Web Audio: interacción, controles y programación de parámetros, MDN](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices).
