# Revisión de movimiento y prendas · pase 08

Revisión del 13 de octubre de 2026 sobre los cuatro personajes y los modelos reales de equipamiento. El objetivo fue comprobar las poses de cerca y corregir defectos visibles del pase 08.

## Defectos corregidos

- El encuadre fijo de `animation-review.html` recortaba la red y desplazaba el personaje al saltar o aterrizar. `review-camera.js` mide los vértices visibles después de la deformación del esqueleto y ajusta distancia y centro según la pose y el tamaño del visor. Las variantes de cabello ocultas quedan fuera del cálculo. La cámara de carrera conserva su comportamiento.
- El rótulo de la pose tapaba parte de la cabeza. Ahora aparece debajo del visor, fuera del modelo.
- El panel lavanda de Luna mostraba cortes triangulares al flexionar las piernas. Se reconstruyó con columnas y caras alineadas con la pernera, y se aumentó ligeramente la separación respecto a la tela base. Las perneras y sus bordes tienen más holgura respecto al muslo.
- Las vistas laterales mostraron roces similares en los dobladillos de Nico y Samuel. Se ajustaron sus radios y bordes. Los tres modelos se regeneraron en Blender 5.2.1 LTS y se guardaron como fuentes `.blend` y recursos `.glb`.

Los recursos anteriores se conservan en `dist/assets/surfer-{nico,luna,samuel}-v8.glb` y `art/baselines/surfer-{nico,luna,samuel}-v8.blend`. Amara conserva su modelo del pase 07. No se modificaron el rig, los ocho clips, las reglas de carrera ni los precios o recetas.

## Revisión visual en el navegador

Se inspeccionaron los cuatro personajes con sus apariencias iniciales y la red costera:

| Gesto | Momento | Vista | Observación |
|---|---:|---|---|
| Cambio Z / X | 60 % | Frente | Revisión del cruce del mango, manos y torso. |
| Salto y aterrizaje | 45 % | Lateral | Revisión de shorts, rodillas, apoyo de pies y encuadre. |
| Giro e impulso | 40 % | Lateral | Revisión de inclinación, agarres y prendas. |
| Recogida seguida | 40 % | Lateral | Revisión del mango, manos y flexión de piernas tras las correcciones. |

También se comprobó Luna en salto al 45 % desde atrás y Samuel recogiendo con la red más amplia, **Sol del puente**. Las capturas usan el panel real del navegador, de 655 px de ancho; no se impuso un tamaño de móvil. Se observaron visores de 607 × 520 y 607 × 374 durante la revisión, según el espacio disponible.

El juego se recargó con los recursos finales y cargó sin errores de consola. La pantalla de inicio conservó Amara, tabla Coral, ropa Costero, red costera y 150 monedas. Los controles del estudio no modifican el inventario; no se inició ni se acreditó una carrera en esta revisión.

## Evidencia

- [Antes: Luna, salto y encuadre recortado](../preview-revision-movimiento-antes.jpg).
- [Después: misma pose de Luna desde atrás](../preview-revision-luna-salto-despues.jpg).
- [Luna lateral](../preview-revision-luna-lateral.jpg), [Nico lateral](../preview-revision-nico-salto.jpg), [Samuel lateral](../preview-revision-samuel-salto.jpg), [Amara lateral](../preview-revision-amara-salto.jpg).
- [Recogida de Luna](../preview-revision-luna-recogida.jpg), [Nico](../preview-revision-nico-recogida.jpg), [Samuel](../preview-revision-samuel-recogida.jpg), [Amara](../preview-revision-amara-recogida.jpg).
- [Samuel con Sol del puente](../preview-revision-red-sol.jpg).

## Comprobaciones automáticas y límites

`npm run check` pasó. `npm test` terminó con **62 pruebas aprobadas y 0 fallidas** después de las exportaciones finales y el ajuste de cámara.

La nueva prueba `review-camera.test.js` carga los cuatro GLB, la tabla Coral y las redes base/Sol. Comprueba los vértices deformados en salto, cambio de lado y recogida, desde frente, espalda y lateral, con relaciones de aspecto 16:9, 607:520 y 390:772. La última relación es una comprobación automática de proyección; no acredita una sesión visual en un teléfono. Las pruebas existentes siguen comprobando agarres, pies, selección por ID, encuadre de carrera, economía y supervivencia.

Las capturas verifican las poses indicadas, no todas las combinaciones posibles de apariencia o cada instante de animación. Siguen compartiéndose los clips; no hay movimiento independiente de dedos ni simulación de ropa o cabello. Esta revisión no mide FPS sostenidos ni valida el multijugador.
