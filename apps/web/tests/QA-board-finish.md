# Acabado de tablas · 14 de octubre de 2026

Se corrigieron los tres recursos Blender y se añadió selección de tabla al estudio de movimiento. El problema se revisó sobre Coral: fragmentos del dibujo estaban ocultos por la cubierta y otros salían del contorno de la punta. También se detectó que la goma trasera atravesaba la planta de los pies.

## Comprobaciones

Blender 5.2.1 LTS guardó `equipment-kit.blend` y exportó los tres GLB, finalizando con `COMPUNUBE_EQUIPMENT_READY`. `--boards-only` conserva los GLB de redes. La caché externa de miniaturas no pudo escribirse; las fuentes y exportaciones se guardaron correctamente.

`npm run check` pasó. `npm test` terminó con **67 pruebas aprobadas y 0 fallidas** después de la última exportación. Las dos pruebas nuevas en `board-finish.test.js`:

- Comprueban por rayos todos los vértices de los dibujos contra la cubierta real de las tres tablas: dentro de su silueta y con separación entre 1 y 2 mm.
- Comprueban el apoyo de las plantas de los cuatro personajes contra la tabla completa, incluidos goma y adornos, para detectar piezas que atraviesen el pie.

Las pruebas existentes siguen verificando apoyos en tablas, materiales propios de instancias, liberación de recursos, agarres de redes, encuadre, animaciones y economía.

## Navegador

Se revisaron los tres diseños con Luna, red costera, salto al 45 % desde atrás. Coral se inspeccionó también de perfil para ver la quilla. El selector de tabla cambia el modelo del visor y permite volver a Coral; no equipa ni compra objetos.

- [Coral antes](../preview-tabla-coral-antes.jpg).
- [Coral después](../preview-tabla-coral-despues.jpg), [Manglar después](../preview-tabla-manglar-despues.jpg), [Sol después](../preview-tabla-sol-despues.jpg).
- [Coral de perfil](../preview-tabla-coral-lateral.jpg).

La pose de comparación es la misma. El antes se conserva de la captura anterior de 655 px; las capturas nuevas usan un panel de navegador de 1264 px. No se impuso un tamaño temporal ni se presenta esto como una comparación exacta de píxeles.

El estudio cargó sin errores de consola. La recarga del menú principal se confirmó mediante captura: la vista previa mostraba Coral con el dibujo continuo y el saldo seguía en 150 monedas. La última lectura DOM del menú agotó el tiempo de la herramienta; la captura permitió completar esa comprobación visual. No se compraron ni equiparon objetos.

## Límites y continuación

El estudio reconstruye poses manualmente. No se ha jugado una carrera completa ni medido FPS sostenidos en este pase. Las comprobaciones de plantas evalúan los modelos y las pruebas anteriores evalúan los objetivos de IK; no sustituyen la revisión de movimiento en una partida.

Continúa abierto el acabado del contacto con el agua, el giro, la estela y el aterrizaje durante una carrera. Los personajes y redes mantienen el estado del pase anterior.
