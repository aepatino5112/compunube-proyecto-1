# Pase 04 · acercar la escena a la imagen acordada

La referencia sigue siendo la segunda ilustración de [CONCEPT_SCENE.md](CONCEPT_SCENE.md). Este pase mejora el personaje representativo, el equipo y el encuadre real. `/art-study.html` permite mostrar la ilustración junto a la escena 3D. El resultado todavía tiene menos riqueza de formas, materiales y composición que la imagen elegida.

## Resultado integrado

Amara incorpora shorts más cortos, muslos/pantorrillas continuos con pesos combinados, un chaleco más atlético, brazos con más sección y un afro más amplio. Se retocaron ojos, costuras y cierre frontal. `surfer-amara.blend` conserva la fuente; `amara_geometry.py` la genera con el rig y los clips de `build_surfer.py`. El GLB actual pesa 1 297 304 bytes y mantiene quince huesos, ocho clips y cinco peinados. Nico, Luna y Samuel aún utilizan la familia anterior.

La tabla Coral tiene trazos crema curvos sobre la cubierta. Las tres tablas reciben un apoyo trasero con estrías más discretas. Las siete redes elevan su boca y profundizan la bolsa en U para que su fondo sea visible sobre el agua. Los anclajes de recogida y empuñaduras mantienen sus coordenadas y las variantes siguen siendo cosméticas.

La cámara baja y se acerca en escritorio. Su distancia longitudinal acompaña al surfista directamente: el suavizado anterior añadía distancia al avanzar y hacía pequeño al personaje en la carrera. La respuesta lateral permanece suavizada; el encuadre considera el lado de la red. En vertical se conserva más distancia para incluir tabla, personaje y bolsa. Se proyectaron los vértices de los modelos reales a ambos lados, con salto y posiciones laterales.

La postura añade inclinación del torso y giro hacia la herramienta, conservando los agarres y apoyos. Un solo lote produce espuma de contacto para las cuatro tablas, además de las estelas. Saltar o quedar descalificado retira esa espuma; se limpia al reiniciar y respeta pausa y movimiento reducido.

El agua usa manchas horizontales más pequeñas y un reflejo dorado interrumpido. Conserva las ondas físicas compartidas con los objetos flotantes. Nubes con contorno desigual acompañan el horizonte. El puente mantiene su posición al frente, con más altura y un ligero ángulo en la composición. Las rocas exportadas añaden degradados y bordes gastados más suaves.

## Luz y coste

`visual-lighting.js` comparte sombras del sol (2048 píxeles) y del relleno lateral (1024). Se actualizan una vez por imagen y se reutilizan en la vista trasera. Surfistas, equipo opaco y rocas proyectan sombras; el paisaje del juego las recibe. El estudio también prueba sombras de su pequeña orilla. No todas las hojas del mapa proyectan sombras.

Dos mapas de radiancia de 128 píxeles por cara se generan al iniciar a partir del cielo, uno por paleta. Se reutilizan al elegir destino y aportan reflejos suaves a materiales PBR. El agua conserva su tratamiento propio. Esta implementación sigue la API de [PMREMGenerator](https://threejs.org/docs/pages/PMREMGenerator.html).

El botón «Volumen» del estudio prueba GTAO a un 65 % de la resolución de dibujo. Su profundidad excluye agua animada, cielo y señales transparentes, y restaura los estados de render después del paso. Su mejora es sutil: permanece en el estudio mientras se evalúa el coste en una carrera con dos cámaras. [La documentación de GTAOPass](https://threejs.org/docs/pages/GTAOPass.html) advierte de su mayor coste respecto a SSAO. Los addons se copiaron sin modificaciones desde `three@0.186.1`, ya instalado, comprobando sus hashes; la licencia sigue en `dist/vendor/LICENSE`.

## Diferencias que siguen visibles

| Elemento | Diferencia con la ilustración | Continuación propuesta |
|---|---|---|
| Personaje | Más rigidez y menos riqueza en manos, pies, rostro y prendas | Refinar el modelo representativo y su pose antes de extender el acabado |
| Vegetación | Copas uniformes y repetición de masas | Diseñar ramas, grupos de hojas y siluetas propias con sombras/degradados locales |
| Orillas | Bancos largos y sectores que aún parecen colocados por patrón | Componer árboles próximos, raíces, piedras, porches y planos de fondo |
| Agua y espuma | Manchas difusas y espuma menos expresiva | Trabajar contorno, contraste, contacto y salpicaduras en movimiento |
| Materiales | Menos volumen y detalle localizado | Añadir UV, pintura y oclusión donde aporten algo visible a tamaño de carrera |

El siguiente pase debe trabajar una roca, un manglar y un palafito con materiales cuidados, junto al personaje. Cuando esa pequeña escena dé el resultado deseado, ampliar la composición y extenderlo a Nico, Luna y Samuel. Las fases son revisables y admiten cambiar herramientas o rehacer recursos.

## Herramientas y libertad de motor

El usuario autorizó Unity u otras tecnologías para priorizar la calidad visual. Blender 5.2.1 LTS está disponible y se utilizó para regenerar los modelos mediante Python y CLI. No hay herramientas MCP de Blender/Unity expuestas en esta sesión. No se encontró Unity Hub/Editor en sus rutas habituales ni en las entradas habituales de instalación de Windows.

El flujo actual conserva Blender para recursos y Three.js para escena y efectos, evaluados dentro de la carrera existente. Unity queda como opción para una prueba comparativa si el flujo de arte o el render lo justifican. [URP admite WebGL 2 y tiene diferencias de compatibilidad entre pipelines](https://docs.unity3d.com/6000.0/Documentation/Manual/urp/requirements.html). Una migración trasladaría escenas, shaders, interfaz y comportamiento; la decisión debe apoyarse en una escena representativa y en su coste de integración. Los modelos y materiales requieren trabajo artístico en cualquiera de esos motores.

## Reproducir y comparar

Se conservó el modelo anterior en `surfer-amara-v1.blend` y `surfer-amara-v1.glb`. «Amara anterior» muestra esa versión con la misma luz, cámara y equipo actuales; no representa el primer prototipo completo. La ilustración se carga al abrir su comparación en el estudio y no sustituye el render jugable.

```powershell
& 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe' --background --factory-startup --python art/build_surfer.py -- --amara-study
& 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe' --background --factory-startup --python art/build_equipment.py
& 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe' --background --factory-startup --python art/build_rocks.py
```

Capturas y límites de verificación: [QA-reference-alignment.md](../tests/QA-reference-alignment.md).

El [pase 05 de paisaje pintado](PAINTED_SCENERY.md) continúa este trabajo: atlas de hojas, palafitos y perfiles de roca revisados, además de sombras de las piezas de orilla en la carrera. Los recuentos y tamaños anteriores corresponden al pase 04.

El [pase 06 de personajes y agarres](CHARACTER_FINISH.md) refina Amara y corrige el traslado de las manos y la orientación del mango. En el estudio, «Amara anterior» pasa a representar el modelo del pase 05; el archivo v1 permanece conservado.

El [pase 07 de conjunto](SCENE_REWORK.md) revisa proporciones, postura de surf, cámara, iluminación, pigmentos y estelas. Desde este pase, «Amara anterior» representa el cuerpo del pase 06 con el render actual. Las cifras y comparaciones previas de este documento corresponden a sus entregas históricas.
