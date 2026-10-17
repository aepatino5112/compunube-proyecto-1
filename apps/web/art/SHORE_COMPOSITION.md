# Maracaibo · composición de las orillas · pase 03

La escena piloto tenía más detalle que las orillas del recorrido, pero sus pequeños bancos separados seguían dejando una costa sin continuidad. Este pase integra la familia de Blender en Maracaibo y conecta sus grupos con terreno, plantas bajas y espuma. La segunda ilustración aceptada sigue orientando el acabado; la composición y el diseño de personajes continúan abiertos.

## Modelos y composición

`build_shore_study.py` guarda las piezas editables en `shore-study.blend` y exporta dos variantes. La aldea usa tres palmeras, siete manglares de distintas alturas, plantas y dos palafitos con porches. La variante de manglar conserva tres palmeras y cinco manglares, deja zonas abiertas y elimina las casas. Las copas usan lóbulos de contorno irregular, más amplios y con ramas bajas en árboles altos; los colores por vértice dan variación amplia al follaje, madera y paredes.

| Recurso | Materiales | Tamaño |
|---|---:|---:|
| `shore-study.glb` · aldea | 10 | 1 571 564 bytes |
| `shore-mangrove.glb` · manglar | 5 | 1 042 512 bytes |

La exportación trabaja sobre copias, aplica modificadores por pieza y agrupa por material. Mantiene la fuente sin combinar para volver a editarla o producir variantes.

`shore-layout.js` organiza los 24 grupos próximos de Maracaibo: ocho aldeas y dieciséis manglares. Una segunda capa de veinticuatro manglares aporta profundidad por ambos lados. Ocho grupos adicionales continúan el paisaje después de la meta, de modo que el horizonte conserve vegetación hasta el final. Sus variaciones son deterministas y separadas de la distribución de residuos y obstáculos.

La escala horizontal y la orientación respetan los límites de los GLB reales. El frente de las casas mira al agua. El extremo más cercano de cada banco queda a 24 m del centro del canal; rocas y canoas complementan las orillas. El recorrido jugable conserva sus objetos y reglas.

`coastal-ribbon.js` conecta esos grupos mediante dos costas de contorno ondulado, con transición de arena a vegetación, 160 plantas pequeñas de hojas plegadas y una tira de espuma irregular. La espuma utiliza las mismas ondas físicas que el agua y se congela con la pausa. El movimiento reducido conserva una superficie estática.

## Dibujo y recursos

`scenery-instancing.js` conserva las transformaciones glTF y comparte geometrías entre todos los emplazamientos. Cada variante se dibuja en sus lotes por material; el terreno y las plantas se construyen una sola vez. Cambiar de destino activa el paisaje ya creado.

Las matrices originales de los bancos se guardan una vez. Al avanzar a otro tramo de 24 m, se copian al buffer existente solamente los bancos cercanos. La ventana cubre 430 m delante y 200 m detrás, con margen para la longitud de cada banco. Atiende a la cámara principal y a la vista trasera aprobada. Los límites conservadores calculados para el conjunto completo siguen conteniendo todos los emplazamientos; los bancos conservan sus posiciones al entrar y salir de la ventana. Se usa `DynamicDrawUsage` en esas matrices.

El verificador registra 26 lotes instanciados en Maracaibo y 27 en Orinoco. El paisaje completo de Maracaibo contiene 1 208 144 triángulos instanciados; la selección visible baja a 539 888 en salida, 749 112 a 450 m y 522 824 a 900 m. Estas cifras excluyen agua, costas no instanciadas, actores, obstáculos, puente y el segundo dibujo de cámara. El detalle añade coste respecto al paisaje anterior: estas cifras describen la selección, no garantizan FPS ni el coste final de GPU.

Las pruebas comprueban los recursos reales, geometría finita, separación del canal, ausencia de casas en el manglar, variación determinista, profundidad en ambos lados, reutilización de geometrías y buffers, y actualización de la ventana en salida, mitad, meta y regreso a salida.

## Revisión

`scene-review.html` muestra el paisaje integrado en salida, mitad y meta. `art-study.html` continúa mostrando dos bancos de cerca y el personaje de Amara para revisar el acabado. Las miniaturas del menú se generan con la nueva escena real. La comprobación del navegador y sus límites están en [QA-shore-composition.md](../tests/QA-shore-composition.md).

El siguiente pase de personaje trasladará a Nico, Luna y Samuel el cuidado de silueta, ropa y articulaciones que comenzó con Amara. El follaje, la variedad arquitectónica y el acabado de Orinoco admiten nuevas iteraciones.

## Referencias técnicas

- [Three.js · InstancedMesh](https://threejs.org/docs/pages/InstancedMesh.html): geometría compartida, actualización de matrices y límites de los lotes.
- [Three.js · gestión de recursos](https://threejs.org/manual/pages/cleanup.html): propiedad y liberación de recursos WebGL.

Se contrastó este manejo con la versión incluida en `dist/vendor`. Los paisajes permanecen cargados durante la sesión; los materiales del pase ilustrado conservan su propiedad explícita.
