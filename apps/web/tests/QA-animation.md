# Surfista animado · 12 de octubre de 2026

La fuente de Blender contiene un esqueleto de 15 huesos, pesos por pieza y ocho acciones. El GLB exportado contiene siete mallas con skin y los ocho clips esperados; pesa 787 512 bytes. Se carga con el GLTFLoader incluido en el proyecto.

## Comprobaciones automáticas

`npm run check` y `npm test` pasan: 14 pruebas. Las nuevas pruebas cargan el GLB real y verifican pesos normalizados, índices de huesos válidos, esqueletos/materiales independientes, geometría compartida, agarres a izquierda y derecha, apoyos de pies durante las distintas poses, equivalencia temporal a 30/120 actualizaciones por segundo, pausa y reinicio. Economía y supervivencia conservan sus comprobaciones.

## Revisión en navegador

- Escritorio, 1280 × 900: menú con personaje completo y postura flexionada; selección de ropa Brisa actualiza el chaleco de la vista previa sin comprar ni modificar el equipo actual.
- Carrera: cuatro surfistas visibles, recogida real de plástico y aumento a 20 % de impulso; cambio Z a la izquierda y giro; salto e impulso consumen carga; pausa conserva la pose. También se observó un rival con un residuo visible dentro de la red elevada.
- Móvil, 390 × 844: menú sin desbordamiento horizontal; carrera con controles táctiles y resultado de descalificación. Reiniciar devuelve tres vidas, cero residuos, red derecha y persecución inicial.
- La consola del navegador no muestra errores ni advertencias durante estas operaciones. Las vistas previas se revisaron al cambiar entre menú, tabla y ropa.

La revisión no mide rendimiento en teléfonos físicos ni valida todos los gestos desde todos los ángulos. El movimiento reducido se contempla en el código para la vista previa y las gotas; no se emuló esa preferencia del sistema durante esta revisión. El refinamiento artístico de las animaciones sigue abierto al probar nuevos diseños de equipo.
