# Pase 06 · surfista, ropa y agarres

La segunda ilustración de [CONCEPT_SCENE.md](CONCEPT_SCENE.md) sigue siendo la referencia. Este pase refina **Amara** como personaje representativo; no da por alcanzado el acabado completo de la imagen. Nico, Luna y Samuel conservan sus modelos anteriores y son el siguiente trabajo de modelado.

## Modelo real y materiales

`amara_geometry.py` construye un torso continuo bajo un chaleco abierto: curva de axila, cuello, bordes enrollados, paneles laterales, cierre, costuras y parche bordado del club. Shorts con cintura y dobladillos, piernas con secciones musculares, talón/empeine y cinco dedos por pie. Puños y tobilleras de neopreno distinguen las uniones. El arranque del brazo se entierra en el torso y mezcla pesos para evitar el borde cortado que aparecía al girar.

El rostro incorpora párpados, iris, cejas más pequeñas, nariz con puente, labios y aros discretos. El afro usa grupos de mechones curvos con grosores y terminaciones diferentes. Los otros cuatro peinados continúan disponibles, junto a los cinco tonos de piel y seis colores de cabello. El detalle fino se aprecia mejor en la revisión cercana que en la cámara de carrera.

`paint_character.py` calcula oclusión local con doce rayos por vértice y alcance de 0,28 unidades. La guarda en el atributo editable «Painted character», junto a variaciones amplias de color. Cada peinado se calcula con su propia geometría: los cuatro estilos ocultos no proyectan oclusión sobre el activo. La pintura multiplica el color de material, permitiendo conservar la personalización. El archivo Blender incluye los nodos de mezcla compatibles con el exportador instalado; el GLB conserva sus factores de color y `COLOR_0`. No se añadieron texturas raster al personaje.

El modelo final conserva **15 huesos y 8 clips**, agrupado en 15 materiales/mallas. Con afro son 11 mallas visibles; cambiar peinado reutiliza la geometría. `surfer-amara.glb` pesa **2 054 380 bytes**, frente a 1 297 304 del pase 05. Se amplía por la geometría y pintura por vértice. Ese tamaño no equivale a una medición de GPU ni FPS sostenidos.

Fuentes editables: `surfer-amara.blend`, `amara_geometry.py`, `paint_character.py` y el rig/animaciones compartidos en `build_surfer.py`. El pase 05 se conserva en `art/baselines/surfer-amara-v5.blend` y `dist/assets/surfer-amara-v5.glb`. Los archivos `surfer-amara-v1.*` permanecen como historial anterior.

## Postura y cambio de mano

El torso gira hacia la herramienta, las caderas acompañan ligeramente y la cabeza sigue el gesto. Pies e inversa cinemática continúan sujetos a sus objetivos. Las palmas nuevas se modelaron alrededor del eje X y el runtime alinea ese eje con el mango, incluyendo su inclinación durante la recogida.

Al cambiar a la izquierda, conservar los mismos agarres para cada mano alargaba demasiado el brazo derecho. `netHandGrip` intercambia suavemente el agarre próximo y el lejano. Una mano se levanta brevemente para pasar sobre la otra. Es una transición de palmas y muñecas; **los dedos aún no tienen animación individual de apertura**.

El eje del mango no pasa por el origen de la tabla. `applyNetPose` compensa su orientación al cruzar, manteniendo exactamente la trayectoria anterior de la boca de la red, incluida la inclinación del gesto. Así los agarres a la izquierda recuperan un alcance similar al derecho sin desplazar la recogida ni alterar estadísticas. Se comparte en carrera y páginas de revisión. Las siete herramientas mantienen sus anclajes de Blender.

Elegir cualquiera de los cuatro personajes deja a los otros tres como rivales, actualizando sus modelos y etiquetas. Seleccionar Amara ya no duplica su identidad en otra tabla. Cambiar el reparto libera los materiales, esqueletos y etiquetas sustituidos.

La documentación oficial de [SkinnedMesh](https://threejs.org/docs/pages/SkinnedMesh.html) respalda el flujo de índices/pesos de piel y la inspección de vértices deformados. La compatibilidad de la mezcla de color y exportación se comprobó contra el exportador Khronos instalado con Blender 5.2.

## Comparación y continuación

`/art-study.html` muestra el pase actual y «Amara anterior» (pase 05), con la misma cámara, iluminación, equipo y tiempo del gesto. Permite comparar la composición con la ilustración y revisar frente/espalda. `/animation-review.html` comparte el cambio de agarre y admite los siete recogedores.

La escena todavía tiene menos riqueza de anatomía, ropa, expresividad, luz y espuma que la referencia. La siguiente fase debe dar prendas y siluetas propias a **Nico, Luna y Samuel**, con revisión desde atrás en carrera; después revisar iluminación, agua y personajes como conjunto. Los peinados secundarios y la deformación de hombros/caderas también admiten refinamiento. No se considera cerrada la dirección artística por haber pasado las comprobaciones técnicas.

Regenerar:

```powershell
& 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe' --background --factory-startup --python art/build_surfer.py -- --amara-study
```

Revisión y límites: [QA-character-finish.md](../tests/QA-character-finish.md).

El [pase 07](SCENE_REWORK.md) continúa con proporciones más atléticas, orientación transversal de pies y rodillas, cadera estable y giro del torso hacia la herramienta. También cambia el render del conjunto. «Amara anterior» compara desde entonces el modelo del pase 06; las cifras anteriores de este documento describen ese pase histórico.
