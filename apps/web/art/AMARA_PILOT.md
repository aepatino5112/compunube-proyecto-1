# Escena piloto · primer traslado del concepto

La segunda ilustración de `CONCEPT_SCENE.md` es la referencia elegida. Este pase produce modelos reales y una vista interactiva de comparación; el acabado de la ilustración sigue siendo más elaborado que la escena implementada.

## Personaje

`surfer-amara.blend` conserva piezas, pesos y ocho clips. El [pase 04](REFERENCE_ALIGNMENT.md) revisa chaleco con cierre frontal, shorts cortos, muslos/pantorrillas continuos y afro amplio. Brazos y cuello usan superficies con pesos combinados; hombros y shorts también mezclan pesos. Se conservan quince huesos, cinco peinados y los puntos de manos/pies del juego.

El nuevo GLB de Amara se selecciona en carrera, retratos y vista previa, incluyendo a la rival simulada. Nico, Luna y Samuel conservan su familia anterior. Cambiar entre estas familias sustituye y libera el actor, sin alterar inventario, alcance o estadísticas. La piel, colores y peinados siguen siendo personalizables.

## Orilla y agua de estudio

`shore-study.blend` contiene un banco de arena alargado, tres palmeras con hojas amplias, siete manglares con raíces y distintas alturas, plantas bajas y dos casas sobre pilotes con porches orientados hacia el canal. El GLB reúne esa geometría y sus colores por vértice en diez materiales. La vista usa dos copias del banco y las rocas existentes. La composición todavía repite parte de esa familia y debe seguir refinándose.

`art-study.html` comparte modelos, agarres, movimiento, señales de residuos, ondas y estelas con el juego. El agua ilustrada y las nubes se refinan en el pase 04. La cámara de composición comparte el encuadre actual de carrera, cuyas distancias se revisaron. Sombras del sol/relleno y radiancia del cielo también se comparten. El botón «Volumen» ensaya GTAO adicional en este estudio; la carrera aún no usa ese efecto.

El [pase 02](ILLUSTRATED_RENDER.md) integró agua, luz, estela y materiales. El [pase 03](SHORE_COMPOSITION.md) extendió vegetación y palafitos. El [pase 04](REFERENCE_ALIGNMENT.md) revisa el conjunto y añade la comparación con la ilustración. La página no modifica perfiles ni acredita materiales. «Amara anterior» muestra el GLB del pase previo, conservando encuadre, equipo, luz y tiempo visual.

Al mover el control manual se reconstruye la pose en pasos de 1/120 s. Al animar, la pose avanza incrementalmente; no se reconstruye toda la secuencia en cada fotograma. Ocultar la pestaña congela el tiempo de estudio. Esta vista no sirve como medición de rendimiento de una carrera.

## Regeneración

```powershell
& 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe' --background --factory-startup --python art/build_surfer.py -- --amara-study
& 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe' --background --factory-startup --python art/build_shore_study.py
```

`amara_geometry.py` construye la silueta piloto; `build_surfer.py` comparte rig y clips. Ejecutar el generador sin la opción piloto regenera la familia anterior. Las fuentes son sesiones independientes de Blender y no modifican proyectos abiertos.

## Qué sigue en este acabado

Revisar proporciones, rostro y manos con la cámara real; mejorar materiales, sombra de contacto y espuma; dar más variedad a la vegetación y estructuras; después extender el diseño a los demás personajes y a los mapas. El concepto orienta estas decisiones, sin garantizar una reproducción idéntica ni FPS antes de medirlos en dispositivos físicos.

Estado actualizado: el [pase 07](SCENE_REWORK.md) reúne cuatro actores y comparte con la carrera una nueva postura, cámara, iluminación y tratamiento del agua. La prioridad siguiente son las prendas/siluetas de los otros tres surfistas y la composición de las orillas.
