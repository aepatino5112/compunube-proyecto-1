# Pase 09 · continuidad del cuerpo y las prendas

La revisión anterior había corregido el encuadre y algunos roces del short, pero dejó pasar defectos que hacían que los personajes parecieran piezas separadas al moverse. Este pase conserva sus diseños y trabaja la construcción y deformación de los cuatro modelos.

## Correcciones

**Alcance sin ensanchar el brazo.** La IK aplicaba escala uniforme al brazo para llegar al mango: en poses sostenidas llegaba a aumentar su grosor aproximadamente entre un 15 % y un 25 %. La extensión se resuelve ahora desplazando las articulaciones, con escala unitaria, manteniendo los objetivos de las palmas. No se cambia el contacto lógico de recogida.

**Sisas sin caras invertidas.** El último anillo del chaleco tenía una curva de sisa más baja que el anillo anterior. La superficie se doblaba hacia atrás y generaba solapas en los hombros. Los anillos completos se distribuyen ahora entre cintura y borde superior según cada ángulo, manteniendo su orden. La prueba de orientación de las paredes detectaba caras invertidas en los cuatro recursos anteriores; los recursos actuales pasan esa comprobación.

**Una superficie por panel de tela.** Los paneles de color y dobladillos de los shorts pertenecen ahora a las caras de la pernera. Los paneles del jersey de Luna y los hombros de Samuel también comparten su superficie con la prenda. Luna tiene bucles colocados sobre las fronteras del panel marfil, para conservar una V continua en vez de colorear una cuadrícula dentada. Cada frontera comparte posición, normales y pesos aunque glTF la separe en primitivas por material.

**Transiciones de cintura, muñeca y tobillo.** El borde inferior del torso sigue la pelvis y pasa gradualmente al pecho. Los extremos de piel y sus puños comparten la transición hacia mano o pie. Se retiraron planos que cerraban prendas atravesando las extremidades y partes del torso ocultas por ropa opaca. Una subdivisión aplicada en las superficies seleccionadas añade bucles para repartir la flexión; dedos y cabellos conservan su construcción.

## Flujo editable

`build_surfer.py` llama a `finish_deformation` de `character_deformation.py` después de construir la variante y antes de pintar, crear el rig y exportar. `sew_tube_panel` de `character_common.py` asigna materiales a caras de la tela. `paint_character.py` prepara todos los materiales de los objetos, incluidos los de las prendas con varios paneles.

Los cuatro `.blend` y GLB se regeneraron en Blender 5.2.1 LTS. Los recursos anteriores están en `art/baselines/surfer-{id}-v8-review.blend` y `dist/assets/surfer-{id}-v8-review.glb`. Se mantienen los 15 huesos, ocho clips, cinco peinados, apariencias del perfil, catálogo y anclajes de equipamiento.

## Coste de los recursos actuales

| Personaje | Bytes del GLB | Materiales | Primitivas visibles¹ | Triángulos visibles¹ |
|---|---:|---:|---:|---:|
| Nico | 2 326 752 | 16 | 14 | 29 804 |
| Luna | 2 534 164 | 18 | 18 | 36 288 |
| Amara | 2 288 272 | 15 | 12 | 38 312 |
| Samuel | 2 055 360 | 18 | 18 | 34 362 |

¹ Con el peinado inicial. Los bucles adicionales aumentan el coste de geometría y los paneles integrados se exportan por material. Estas cifras no acreditan FPS sostenidos; el rendimiento debe evaluarse con cuatro surfistas y efectos en una carrera real.

La [revisión de deformaciones](../tests/QA-character-deformation.md) registra las poses, capturas y comprobaciones. El pase corrige estos fallos concretos; no da por terminado el diseño de manos, cabello, gestos ni el parecido global con la ilustración.
