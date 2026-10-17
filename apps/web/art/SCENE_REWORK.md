# Pase 07 · postura, color y composición

La segunda ilustración de [CONCEPT_SCENE.md](CONCEPT_SCENE.md) continúa como referencia. Este pase trabaja las formas grandes y el conjunto visible desde la cámara de carrera. El resultado tiene más contraste y una postura más propia de surf, pero aún requiere mejorar los otros personajes y la composición del paisaje.

## Personaje y movimiento

Amara tiene piernas más largas, torso más compacto, hombros más anchos y una cabeza/cabellera menores respecto al cuerpo. Se ajustaron esqueleto, brazos y objetivos de apoyo junto con la geometría. La cadera mantiene una orientación lateral sobre la tabla; el torso se contragesta al cambiar la herramienta de lado. Se corrigió el signo del giro para que cabeza y cuerpo miren hacia la red.

Los pies se acercan al centro de la cubierta y se orientan atravesados: aproximadamente 60° delante y 43° detrás. Las rodillas acompañan esa dirección. Los apoyos conservan su altura y separación longitudinal, y se comprobaron sobre las tres tablas con los vértices deformados de las plantas. Los agarres mantienen el intercambio del pase 06 y la boca de recogida conserva su trayectoria.

El GLB conserva **15 huesos, 8 clips y 5 peinados**, con 11 mallas visibles y 32 328 triángulos al llevar afro. Su tamaño final es **2 054 092 bytes**; la fuente `surfer-amara.blend` pesa 893 146 bytes. El tamaño describe el recurso, no su rendimiento en una partida.

Fuentes: `amara_geometry.py`, `build_surfer.py` y `paint_character.py`. El modelo del pase 06 se conserva en `dist/assets/surfer-amara-v6.glb` y `art/baselines/surfer-amara-v6.blend`. También se guardaron sus generadores y módulos de dirección artística, agua y materiales en `art/baselines/`.

## Cámara, luz y materiales

La cámara de escritorio baja y se desplaza ligeramente a un lado. La tabla aparece en diagonal y se lee mejor el perfil del cuerpo. El encuadre vertical mantiene más distancia para incluir la bolsa de la red. Carrera y estudio comparten `composeSurfCamera`; los ensayos proyectan los modelos reales en ambos lados, extremos del canal y salto.

`configureSurfRenderer` establece salida sRGB, `NeutralToneMapping` y exposición 1.0 en carrera, vista previa y páginas de estudio. La luz cálida procede del horizonte del puente; un relleno cálido desde atrás permite leer al surfista de espalda. El ambiente y la radiancia se comparten entre escena piloto y carrera. El flujo se apoya en la [gestión de color de Three.js](https://threejs.org/manual/en/color-management.html) y las opciones de [WebGLRenderer](https://threejs.org/docs/pages/WebGLRenderer.html).

Los materiales agrupan la iluminación difusa en valores de sombra, medio tono y luz, con tintes cálidos/fríos según la familia. Conservan sombras, pintura por vértice, especular y emisión de los materiales existentes. La luz de borde depende de la dirección solar. Se mantiene el material PBR compartido y sus propiedades de piel, ropa, cabello y metal.

## Agua, espuma y horizonte

El agua de Maracaibo recibe una base turquesa más intensa y manchas de pigmento con bordes suavizados mediante derivadas de pantalla. El reflejo dorado es más ancho y continuo, con fragmentos horizontales. El desplazamiento sigue usando las mismas ondas que tablas y objetos flotantes.

La estela blanca tiene bordes más presentes, se ensancha y conserva más fuerza antes de desaparecer. Reutiliza buffers e historial del recorrido; sigue congelándose en pausa y deja de generarse al saltar. La espuma de contacto continúa compartida por las cuatro tablas.

El puente permanece delante y el sol aparece por encima de su silueta. Tres pequeños grupos de edificios suavizados añaden profundidad detrás; son una interpretación escénica, no una representación geográfica exacta. Usan un único lote de instancias y solo aparecen en Maracaibo.

## Revisión de la escena

[/art-study.html](http://127.0.0.1:4173/art-study.html) añade tres rivales con los modelos, equipo, poses y estelas del juego. Se muestran en «Composición» y se retiran en las vistas de detalle. Los controles reconstruyen todos los actores con el mismo tiempo de gesto; la escena no modifica el perfil.

«Amara anterior» compara la **geometría del pase 06 bajo la luz, cámara y postura actuales**. Para comparar el conjunto anterior completo se conservó `preview-escena-antes-v7.jpg`. La captura final del conjunto es `preview-escena-despues-v7.jpg`. El efecto GTAO del botón «Volumen» sigue siendo un ensayo exclusivo del estudio.

## Continuación

1. Construir prendas, anatomías y siluetas propias de Nico, Luna y Samuel, revisadas de espalda junto a Amara en carrera.
2. Componer primeros planos de orilla: árboles, raíces, rocas, porches y espacios abiertos con menos repetición de masas.
3. Afinar hombros, caderas, manos, peinados y cambio de herramienta, con las cuatro figuras bajo la misma luz.
4. Medir el coste del conjunto en equipos reales antes de extender efectos o producir los siguientes mapas.

Este orden admite cambios después de revisar el resultado. La dirección artística no se considera cerrada por haber superado pruebas técnicas.

## Regenerar

Desde la raíz del proyecto:

```powershell
& 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe' --background --factory-startup --python art/build_surfer.py -- --amara-study
```

La integración continúa con Blender y Three.js. No se cambió de motor en este pase. Evidencia y límites: [QA-scene-rework.md](../tests/QA-scene-rework.md).

El [pase 08 de personajes](CLUB_CHARACTERS.md) completa la primera continuación de esta guía: Nico, Luna y Samuel tienen modelos/prendas propios y se utilizan en la composición. Los datos y capturas del pase 07 permanecen como historial.
