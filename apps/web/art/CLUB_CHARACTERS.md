# Pase 08 · personajes del club

Este pase continúa el acabado de Amara aprobado en el [pase 07](SCENE_REWORK.md). Nico, Luna y Samuel tienen geometría, proporciones y prendas propias construidas en Blender. El diseño de Amara mantiene la base del pase anterior. La segunda ilustración de [CONCEPT_SCENE.md](CONCEPT_SCENE.md) sigue orientando el estilo; estos modelos no dan por cerrado el acabado del juego.

## Diseño de las cuatro figuras

| Personaje | Silueta y ropa | Presentación inicial |
|---|---|---|
| **Nico** | Hombros amplios, torso atlético, mandíbula más cuadrada y cuello continuo. Lycra navy de mangas cortas, chaleco con canesú oscuro y V clara/amarilla, bermudas largas con grandes paneles laterales. | Piel media, cabello castaño, peinado hacia un lado. |
| **Luna** | Hombros más estrechos, cintura y cadera propias, rostro ovalado. Jersey deportivo con paneles lavanda y canesú marfil, mangas raglán cortas y short deportivo. Coleta de volumen continuo con mechones agrupados y punta afinada. | Piel clara, cabello rubio, coleta. |
| **Amara** | Proporciones atléticas, afro de mechones curvos, chaleco con inserciones claras y shorts con dobladillo. Mantiene la postura lateral y pies atravesados del pase 07. | Piel oscura, cabello negro, afro. |
| **Samuel** | Figura esbelta y rostro más estrecho. Lycra teal con hombros ocre, chaleco corto de frente abierto y V amplia en la espalda, bermudas largas con inserciones teal/ocre. Rizos propios de mechones curvos agrupados. | Piel oscura, cabello cobrizo, rizos. |

Las diferencias se concentran en formas grandes que puedan reconocerse desde atrás durante la carrera. Los bordes, cierres, bolsillos y costuras refuerzan la lectura de la ropa. Las mangas y perneras mezclan pesos entre los huesos de torso/cadera y sus extremidades para acompañar la flexión.

Los diseños son cosméticos: no cambian alcance de recogida, velocidad, vidas ni recompensas. La personalización conserva **cinco tonos de piel, seis colores de cabello y cinco peinados** para cada personaje: `swept`, `curls`, `bun`, `ponytail` y `afro`. La coleta de Luna y los rizos de Samuel sustituyen únicamente sus respectivas variantes; las demás siguen disponibles.

## Fuentes y generación

`build_surfer.py` construye la base detallada mediante `amara_geometry.py`, aplica el módulo `character_nico.py`, `character_luna.py` o `character_samuel.py`, pinta la oclusión local con `paint_character.py` y crea el rig y los clips. `character_common.py` comparte remapeo de geometría/anclajes y herramientas de construcción. El archivo `.blend` se guarda antes de agrupar las piezas por material para exportar el GLB.

Todos los modelos usan **15 huesos y ocho clips**: `SurfIdle`, `TurnLeft`, `TurnRight`, `Boost`, `Jump`, `Scoop`, `Land` y `Hit`. El desplazamiento de carrera pertenece al juego. La inversa cinemática de `surfer-animation.js` conserva los apoyos de los pies y alinea las palmas con el mango. Se mantiene el marco de agarre del pase anterior.

Desde la raíz del proyecto, con Blender 5.2 instalado:

```powershell
& 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe' --background --factory-startup --python art/build_surfer.py -- --character nico
& 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe' --background --factory-startup --python art/build_surfer.py -- --character luna
& 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe' --background --factory-startup --python art/build_surfer.py -- --character samuel
```

Amara conserva su comando `-- --amara-study`. Las fuentes editables están en `art/surfer-{id}.blend`; los recursos de ejecución, en `dist/assets/surfer-{id}.glb`. El antiguo `surfer.blend`/`surfer.glb` permanece como historial y recurso para comprobaciones de compatibilidad.

## Materiales y coste del recurso

`OutfitColor` mantiene el color de ropa seleccionado en tienda. Los paneles navy, teal, lavanda, ocre y marfil tienen materiales propios de color fijo, de modo que cambiar el chaleco no borra la identidad de cada diseño. `Skin`, `Cheeks`, `Brows` y los cinco materiales `Hair-*` siguen respondiendo a la apariencia del perfil. La pintura por vértice conserva volumen sin impedir esos cambios.

Lectura directa de los GLB actuales, después de la corrección de deformaciones del pase 09:

| Recurso | Tamaño en bytes | Materiales distintos | Primitivas visibles¹ | Triángulos visibles¹ |
|---|---:|---:|---:|---:|
| `surfer-nico.glb` | 2 326 752 | 16 | 14 | 29 804 |
| `surfer-luna.glb` | 2 534 164 | 18 | 18 | 36 288 |
| `surfer-amara.glb` | 2 288 272 | 15 | 12 | 38 312 |
| `surfer-samuel.glb` | 2 055 360 | 18 | 18 | 34 362 |

¹ Con el peinado inicial de cada personaje; los otros cuatro están presentes en el archivo y ocultos. Estas cifras describen geometría y transferencia, no FPS ni llamadas de dibujo de la escena completa. Sombras, pasadas de revisión y cuatro surfistas juntos añaden trabajo de render que debe medirse en equipos reales.

## Integración y revisión

Carrera, rivales, retratos de tienda y vista previa de equipo seleccionan el recurso por ID mediante `selectSurferAsset`. El estudio de Maracaibo y la revisión de movimiento cargan también los cuatro GLB propios. Se mantienen el perfil, catálogo y reparto de personajes.

- [El club · character-review.html](http://127.0.0.1:4173/character-review.html): comparación conjunta o individual, frente/espalda y cambio de red. Comparte un color coral para comparar la construcción de las prendas.
- [Escena de Maracaibo · art-study.html](http://127.0.0.1:4173/art-study.html): las cuatro figuras bajo la cámara, luz y agua de la composición.
- [Movimiento · animation-review.html](http://127.0.0.1:4173/animation-review.html): personaje, apariencia, equipo y momentos del gesto para inspeccionar poses.

La evidencia y el resultado de las comprobaciones se registran en [QA-club-characters.md](../tests/QA-club-characters.md). Las pruebas estructurales respaldan rig, selección, apoyos y agarres; la revisión visual sigue siendo necesaria para detectar intersecciones de mangas, axilas, cuello, shorts o cabello en poses extremas.

Los ocho clips y la lógica de movimiento todavía se comparten. No hay animación independiente de dedos ni simulación de ropa o cabello. El siguiente refinamiento puede ajustar gestos individuales y deformaciones después de revisar a los cuatro juntos, además de continuar la composición de las orillas. El coste sostenido de una carrera y el parecido con la ilustración requieren valoración propia; no se deducen de una exportación correcta.

## Revisión posterior de prendas y visor

La primera inspección de salto y recogida detectó cortes en el panel lavanda de Luna y roces entre muslos y dobladillos en Nico y Samuel. Se corrigió la topología del panel de Luna y se dio más holgura a las tres perneras, conservando esqueleto y anclajes. Los GLB y `.blend` anteriores se guardaron como baselines `v8` antes de regenerarlos.

El visor de movimiento encuadra ahora la geometría visible de cada pose, incluyendo tabla y red, y coloca la descripción fuera del dibujo. La [revisión de movimiento](../tests/QA-motion-review.md) documenta las capturas, los cuatro gestos revisados y las 62 pruebas aprobadas. Este ajuste de cámara se utiliza únicamente en el visor.

La revisión adicional del [pase 09](CHARACTER_DEFORMATION.md) corrige la inflación de brazos, las sisas invertidas, la continuidad de cintura/extremos y las capas de paneles y dobladillos. Los cuatro recursos se regeneraron; la tabla anterior describe esta versión actual. [QA-character-deformation.md](../tests/QA-character-deformation.md) registra las 65 pruebas y las capturas finales.
