# Pase 10 · cubierta y apoyo de las tablas

El dibujo de Coral parecía quebrado porque su superficie decorativa se cruzaba con la cubierta y salía de la silueta cerca de la punta. La cubierta anterior cerraba su parte superior con un único abanico de triángulos desde el centro; esa interpolación no coincidía con la curva usada para colocar los adornos.

Las tres cubiertas conservan su contorno, dimensiones y altura de apoyo, con anillos interiores que muestrean la curvatura de la punta. Los dibujos se proyectan sobre la malla real mediante rayos, con 1,5 mm de separación, y permanecen dentro de ella. En Coral las bandas se estrechan hacia la punta. Manglar conserva sus tres inserciones de madera y Sol del lago su emblema solar y líneas laterales, ahora como superficies planas.

La goma trasera tenía su superficie a 0,339 m, por encima de las plantas de los pies a aproximadamente 0,305 m. El nuevo pad redondeado termina en 0,304 m y el dibujo de espiga en 0,3042 m. Los apoyos y la animación del personaje mantienen sus coordenadas. Las quillas tienen un contorno curvo inclinado hacia atrás y bordes suaves.

## Fuentes y exportación

`build_equipment.py` guarda el kit editable completo en `equipment-kit.blend`. Para regenerar solamente los tres GLB de tabla:

```powershell
& 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe' --background --factory-startup --python art/build_equipment.py -- --boards-only
```

Sin `--boards-only` se exporta también el resto del kit. Los modelos de redes no se reexportaron en este pase. Los recursos anteriores están en `dist/assets/board-{id}-v9.glb`, con fuente y generador conservados en `art/baselines/equipment-kit-v9.blend` y `art/baselines/build_equipment-v9.py`.

Los grupos `DeckArtwork-{id}` y `TractionPad-{id}` permiten inspeccionar las piezas conservando lotes por material. Carrera, tienda y vista previa siguen cargando los mismos identificadores de tabla y los mismos GLB; el catálogo, precios y estadísticas no cambian.

| Tabla | Bytes | Triángulos | Primitivas |
|---|---:|---:|---:|
| Coral | 42 180 | 1 884 | 5 |
| Manglar | 49 192 | 2 172 | 6 |
| Sol del lago | 45 368 | 1 948 | 6 |

El estudio de movimiento permite elegir las tres tablas sin equiparlas ni tocar el inventario. [QA-board-finish.md](../tests/QA-board-finish.md) registra las capturas y las 67 pruebas aprobadas.

## Continuación

El siguiente pase debe revisar el contacto de la tabla con el agua durante una carrera: apoyo, inclinación al girar, espuma en los bordes, continuidad de estela y salpicaduras al aterrizar. La lectura del conjunto debe evaluarse a velocidad normal y con impulso, antes de añadir más diseños de tabla.
