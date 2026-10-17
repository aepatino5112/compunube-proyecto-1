# Kit piloto de Maracaibo

La dirección artística actual y las fases siguientes están en [ART_DIRECTION.md](ART_DIRECTION.md). El puente ahora forma parte del horizonte escénico delante del jugador; se conserva su GLB y ya no se atraviesa durante la carrera.

El [pase piloto de Amara y orilla](AMARA_PILOT.md) traslada la segunda ilustración elegida a modelos reales. La ejecución `build_surfer.py -- --amara-study` genera un recurso separado; `build_shore_study.py` genera las variantes de aldea y manglar. Amara está integrada en el juego. El [acabado ilustrado](ILLUSTRATED_RENDER.md) integra el agua, la luz y los materiales en ambos mapas; el [pase de composición de orillas](SHORE_COMPOSITION.md) lleva los modelos y una costa continua a Maracaibo. La fuente `shore-study.blend` sigue siendo editable y las variantes GLB comparten geometría entre sus emplazamientos.

## Familia de rocas

`build_rocks.py` crea `rock-kit.blend` y cuatro GLB: `rock-basalt`, `rock-sandstone`, `rock-split` y `rock-slab`. Ejecutar Blender en segundo plano con ese script, igual que el comando del kit piloto. Las fuentes mantienen formas separadas y modificadores editables. Se exporta una malla y un material por variante, con colores por vértice para estratos y desgaste. La base está parcialmente sumergida; sus contornos horizontales quedan dentro del radio de colisión existente de 1,8 m.

`dist/rock-kit.js` comparte geometría y materiales mediante cuatro lotes de instancias. El recorrido y cada paisaje reutilizan esa familia; cambiar de mapa solo actualiza matrices. El verificador actual de entorno registra 26 lotes en Maracaibo y 27 en Orinoco. La vista de composición permite comparar modelos cercanos y posiciones del recorrido.

## Kit inicial de puente y palmeras

Fuente editable: `maracaibo-kit.blend`. Generador reproducible: `build_maracaibo.py`.

```powershell
& 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe' --background --factory-startup --python art/build_maracaibo.py
```

Se guarda la fuente con sus piezas separadas; para exportar se agrupan las mallas por material. Los archivos `dist/assets/maracaibo-bridge.glb`, `palm.glb` y `surfboard.glb` no requieren texturas externas. El mapa utiliza el puente y las palmeras; la tabla inicial `surfboard.glb` se conserva como fuente del primer pase, mientras que la carrera actual utiliza el kit de equipamiento descrito abajo.

El puente es una interpretación estilizada de varios tramos atirantados y soportes de hormigón, diseñada para ser legible desde el agua. No es una reconstrucción arquitectónica, geográfica ni estructural. Las columnas quedan fuera del corredor jugable. Referencia documental: [Academia Nacional de la Ingeniería y el Hábitat, declaración sobre el puente Rafael Urdaneta](https://acading.org.ve/wp-content/uploads/2023/02/87_DECLARACION_PUENTE_GENERAL_RAFAEL_URDANETA_SOBRE_EL_LAGO_DE_MARACAIBO.pdf).

El pase ilustrado rehace el puente con columnas macizas de sección variable, cabezales, patas rectangulares biseladas y abanicos de ocho cables a cada lado. Para regenerar solamente ese recurso:

```powershell
& 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe' --background --factory-startup --python art/build_maracaibo.py -- --bridge-only
```

Esta opción guarda `maracaibo-bridge.blend` como fuente independiente y exporta `maracaibo-bridge.glb` (644 084 bytes, tres materiales), sin reemplazar palmeras ni tablas. El archivo `maracaibo-kit.blend` conserva el kit inicial hasta regenerarlo completo.

La escena de Blender se genera en una sesión de fábrica en segundo plano, sin modificar preferencias ni proyectos abiertos. Un aviso de caché de miniaturas puede aparecer por permisos del entorno; no impide guardar el `.blend` ni exportar los GLB.

## Tablas y redes intercambiables

El [pase 04 de comparación con la referencia](REFERENCE_ALIGNMENT.md) regenera Amara, equipamiento y rocas. Conserva la fuente anterior del personaje y añade una comparación directa con la ilustración. El documento registra también el flujo actual Blender/Three.js y la posibilidad autorizada de evaluar otro motor.

El [pase 03 de personajes y crafteo](CHARACTERS_AND_CRAFT.md) contiene cuatro personajes, cinco peinados, tres tablas y siete recogedores completos. El mismo esqueleto admite formas distintas, cinco tonos de piel y seis colores de cabello. `NET_GRIPS` comparte las coordenadas de empuñaduras adelantadas con el IK. El taller muestra los siete modelos reales, incluyendo acero/cobre, uniones, tejido diagonal y bandas emisivas; todos conservan la misma recogida. La documentación inicial siguiente describe el origen del kit, cuyos componentes siguen editables en Blender.

`build_equipment.py` genera `equipment-kit.blend` y diez GLB: `board-coral`, `board-manglar`, `board-sol`, `net-red-base`, `net-red-reuso`, `net-red-marea`, `net-red-cobre`, `net-red-faro`, `net-red-aurora` y `net-red-sol`. Usa Blender en segundo plano igual que los otros generadores. La fuente conserva las piezas separadas; la exportación agrupa por material dentro de cada padre, respetando los anclajes `NetHead-<id>`.

Los modelos se dibujan con Y arriba y frente hacia -Z, convertidos al sistema Z arriba de Blender. Las tablas mantienen el suelo de apoyo en Y=.30 y dejan espacio bajo los pies del esqueleto. Cada cabeza de red se centra en (2.05,.34,-1.4), con el mango y los agarres compartidos por la cinemática inversa. Las bolsas son profundas y abiertas; no llevan una rejilla sobre la boca. Sus siluetas distintas no cambian el alcance de recogida.

`dist/equipment.js` crea instancias del mismo kit para carrera, fotografías y vistas previas. Cada actor posee sus materiales; la geometría pertenece al kit cargado y se comparte. Al sustituir una pieza se liberan sus copias de materiales. Las fotografías reutilizan el renderizador de la vista previa, sin abrir contextos adicionales. La estructura sigue el manejo explícito de recursos explicado por el [manual de Three.js](https://threejs.org/manual/pages/cleanup.html). Los materiales usan Principled BSDF y glTF, según la [documentación del exportador Blender](https://docs.blender.org/manual/en/latest/addons/import_export/scene_gltf2.html).

## Pulpo perseguidor

`build_octopus.py` genera `octopus.blend` y `dist/assets/octopus.glb`. El modelo tiene ocho tentáculos con pivotes animados y un ciclo de natación; Three.js reproduce los clips con `AnimationMixer`. El desplazamiento y la retirada los controla la simulación. La exportación agrupa la geometría estática por material y mantiene los pivotes animados separados. La carga se verificó con el GLTFLoader del proyecto y se comprobó que las rotaciones cambian al avanzar el mezclador.

## Surfista de caricatura

La dirección elegida es una caricatura 3D: cabeza grande, ojos expresivos, pelo por mechones, chaleco redondeado y colores vivos. `build_surfer.py` genera la fuente editable `surfer.blend` y `dist/assets/surfer.glb`. Ejecuta el mismo comando de Blender de arriba cambiando el nombre del script.

La fuente conserva las piezas editables, pesos, objetivos de deformación y un esqueleto de 15 huesos. La exportación del pase 03 contiene cinco peinados (cuatro ocultos por actor), variantes de rostro/cuerpo y ocho clips: `SurfIdle`, `TurnLeft`, `TurnRight`, `Boost`, `Jump`, `Scoop`, `Land` y `Hit`. `OutfitColor` permite cambiar el chaleco; piel, mejillas, cejas y cabello reciben materiales propios por actor. El GLB pesa aproximadamente 2,71 MiB y no necesita texturas externas. El crecimiento corresponde a nuevos peinados y objetivos de deformación; no se duplican cuatro archivos de personaje.

`dist/surfer-animation.js` crea cada personaje con `SkeletonUtils.clone` y su propio `AnimationMixer`. Mezcla los ciclos con transiciones dependientes del tiempo y superpone los gestos de recogida, aterrizaje y golpe. Después aplica cinemática inversa de dos segmentos: mantiene los pies en sus apoyos y dirige las manos a dos puntos del mango. El cambio Z/X y la elevación de la red conservan los agarres; los brazos admiten una extensión estilizada. Los vectores de trabajo se reutilizan para evitar crear objetos 3D en cada fotograma.

El desplazamiento de la tabla, salto y colisiones pertenecen a la simulación; los clips no trasladan al personaje por el recorrido. La red levanta el modelo del residuo recogido dentro de su bolsa y suelta gotas mediante un único lote instanciado de 48 partículas reutilizables. Las partículas respetan pausa, reinicio y movimiento reducido. El menú usa una instancia animada independiente y libera sus materiales, mezclador y esqueletos al cambiar la vista previa, conservando la geometría compartida.

`tests/surfer-animation.test.js` carga el GLB real y verifica esqueletos independientes, geometría compartida, apoyo de pies, agarres en ambos lados, pausa y reinicio. Referencias: [ejemplo oficial de personajes animados en Three.js](https://threejs.org/manual/pages/game.html), [AnimationMixer](https://threejs.org/docs/pages/AnimationMixer.html) y [exportador glTF de Khronos integrado en Blender](https://github.com/KhronosGroup/glTF-Blender-IO/blob/main/README.md). Las opciones de exportación se contrastaron con la API RNA de Blender 5.2 instalada.

El agua actual utiliza pigmentos, trazos deformados y reflejos solares fragmentados, con colores propios de cada destino. Las ondas se animan en la GPU y los detalles ambientales no alteran la semilla del recorrido ni las colisiones. El acabado se evalúa en el juego, junto al pulpo y el puente.

## Orillas, manglares y palafitos

`build_environment.py` genera `shoreline-kit.blend` con piezas separadas y los modelos `palafito.glb`, `mangrove.glb` y `canoe.glb`. Ejecuta Blender en segundo plano con `--factory-startup`. Al exportar se aplican los modificadores y se agrupa por material. Los modelos no usan texturas externas; `HouseColor` y `BoatColor` reciben colores por instancia. Los biseles sencillos y copas de baja resolución mantienen formas legibles sin añadir geometría innecesaria a los objetos lejanos.

`dist/environment.js` compone bancos de arena de contorno irregular, vegetación, casas y canoas. Preserva las transformaciones glTF originales al instanciar cada malla. Las nubes y marcas de superficie también se dibujan por lotes. Se calculan límites después de asignar matrices. El agua extiende `MeshStandardMaterial` con `onBeforeCompile`: pequeñas ondas y trazos se calculan con un uniforme de tiempo, conservando iluminación, niebla y gestión de color del renderizador. El movimiento reducido mantiene estática el agua; la pausa utiliza el tiempo visual congelado del juego.

Las miniaturas del menú fotografían una vez cada paisaje con el renderizador principal, ocultando personajes y pulpo y restaurando visibilidad, tamaño y resolución después. No crean otro contexto WebGL.

Verificación reproducible: `node art/verification/check_environment.mjs`. Carga los GLB reales de los dos mapas, comprueba vértices y matrices finitos, límites de instancias y separación del canal. Registra 26 lotes instanciados en Maracaibo y 27 en Orinoco, y cuenta los triángulos seleccionados en salida, mitad y meta. No incluye personajes, obstáculos, puente, terreno no instanciado ni el segundo pase de cámara. No sustituye una medición de rendimiento en dispositivos físicos.

## Vegetación del Orinoco

`build_orinoco.py` genera `orinoco-kit.blend` y `delta-tree.glb`. La fuente editable conserva tronco curvo, raíces de contrafuerte, ramas y copas redondeadas por lóbulos. La exportación agrupa las piezas en cinco materiales y comparte geometría mediante instancias en Three.js. Las formas representan un bosque tropical estilizado; no identifican una especie botánica concreta.

Ejecutar: `Blender --background --factory-startup --python art/build_orinoco.py`. La escena Orinoco usa el árbol en grupos de orilla y una segunda capa de bosque fuera del canal; comparte palmeras, manglares y canoas del kit existente. La paleta del agua y la niebla se configura por destino. Solo el paisaje elegido es visible; la repetición de partidas no añade nuevos objetos de escenario.

Referencia de contexto: [Reserva de Biosfera Delta del Orinoco, UNESCO](https://www.unesco.org/en/mab/delta-del-orinoco), por sus bosques húmedos, bosques pantanosos, manglares y canales. El pulpo permanece como personaje ficticio del juego.

Referencias técnicas: [InstancedMesh](https://threejs.org/docs/pages/InstancedMesh.html) y [personalización de Material en WebGLRenderer](https://threejs.org/docs/pages/Material.html). Referencias de contexto: [manglares de Los Olivitos, Inparques](https://www.inparques.gob.ve/Refugios/los-olivitos.html) y [Zulia, GeoVenezuela de Fundación Empresas Polar](https://bibliofep.fundacionempresaspolar.org/media/1378337/gv_t7_c59_p490_631_zulia_lres_single_preview.pdf). El kit es una interpretación de caricatura, no una reconstrucción geográfica.
