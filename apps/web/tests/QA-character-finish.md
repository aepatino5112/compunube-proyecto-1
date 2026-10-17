# QA · pase 06 de personajes y agarres

## Comprobaciones automáticas

`npm run check` y `npm test`: **58 pruebas correctas** con los archivos GLB finales.

- Modelo de Amara: 15 huesos, 8 clips, pesos normalizados, atributos de pintura finitos y variantes de cabello independientes.
- Las palmas orientan su eje sobre el mango, incluidos recogida, cambios de lado, inversión y pausa. El traslado intercambia los agarres próximos/lejanos y mantiene separación entre manos.
- Las **siete redes reales**, con Amara y el modelo anterior, conservan la boca de recogida en ambos extremos y tres posiciones intermedias, también con inclinación del gesto. Los pies siguen sus apoyos y los cambios de lado mantienen los objetivos de manos.
- Los vértices deformados reales de Amara, tabla y red se proyectan dentro del encuadre de escritorio y vertical, en ambos lados, extremos del canal, salto y desviación lateral de cámara.
- Cada elección de personaje produce cuatro identidades distintas. Siguen pasando las comprobaciones anteriores de inventario, vida, impulso, recogida, pausa, recursos compartidos y determinismo.

El GLB final pesa 2 054 380 bytes. Tiene 15 mallas/materiales y 49 272 triángulos incluyendo los cinco peinados; con afro hay **11 mallas visibles y 32 328 triángulos**. Estos datos describen solo el actor, no toda la carrera ni sus sombras. El modelo del pase 05 y su Blender editable se conservan para comparar.

## Revisión visual

Se revisó el GLB con WebGL nativo, tanto en la carrera como en las páginas de estudio. La captura de carrera intermedia corresponde al nuevo modelo antes de la última corrección del cambio de mano; **no demuestra el gesto final**. La revisión final del gesto usa la misma implementación de `applyNetPose`, `netHandGrip`, sombras y actor que la carrera.

| Vista | Evidencia final |
|---|---|
| Composición, modelo del pase 05, gesto 35 % | `preview-amara-comparacion-antes-v6.jpg` |
| Misma composición y gesto, Amara actual | `preview-amara-comparacion-despues-v6.jpg` |
| Composición con red a la izquierda, gesto 100 % | `preview-amara-agarre-izquierdo-v6.jpg` |
| Frente del modelo y agarre | `preview-amara-frente-v6.jpg` |
| Piel clara, coleta azul y Sol del puente | `preview-amara-variantes-v6.jpg` |
| Composición vertical, red a la izquierda | `preview-amara-movil-v6.jpg` |

En el estudio de movimiento se seleccionaron los cinco peinados y las siete redes. Las opciones permanecen disponibles y no aparecieron errores/avisos de consola en las vistas finales. Se restauró Amara con su apariencia predeterminada para la revisión.

Se probó el viewport de escritorio de 1280 × 720 y el vertical de 390 × 844. En vertical, el ancho útil de documento fue 375 px por la barra de desplazamiento; el ancho de contenido también fue 375 px. El surfista, tabla y red permanecen en la escena y no hay desbordamiento horizontal. Los tamaños temporales se restablecieron al terminar.

La pestaña principal de `127.0.0.1` se actualizó desde Inicio; mantiene 150 monedas y su elección de Nico/Coral/Costero/Red costera. La pestaña de carrera `localhost` tuvo cambios de controles, reinicios y destino durante la revisión, por lo que se dejó disponible sin atribuir esas acciones al pase ni afirmar que su perfil terminó idéntico. No se realizaron compras, canjes o fabricación mediante las comprobaciones.

## Límites y siguiente trabajo

La comparación evidencia una mejora de prendas, manos/pies y contorno, pero todavía menos riqueza visual que la ilustración aprobada. Los dedos se modelaron cerrados alrededor del mango: no tienen controles individuales para abrir durante el cambio de mano. El personaje admite más trabajo en deformación de hombros, caderas, cabellos secundarios y expresividad.

Nico, Luna y Samuel conservan sus mallas anteriores, aunque comparten la postura y el cambio de mano mejorados. Todavía hace falta darles prendas y anatomías propias. La pintura local aumenta el tamaño del archivo, y **no se midieron FPS sostenidos ni tiempo de GPU**. El estudio con GTAO sigue siendo una vista de revisión, no una prueba de rendimiento de las dos cámaras de carrera. No se ensayó de nuevo una carrera completa hasta meta después de la última corrección visual.
