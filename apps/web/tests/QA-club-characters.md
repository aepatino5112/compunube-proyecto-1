# QA · pase 08 de personajes del club

Fecha: 13 de octubre de 2026. Fuente y regeneración: [CLUB_CHARACTERS.md](../art/CLUB_CHARACTERS.md).

## Resultado técnico

Después de exportar Nico, Luna y Samuel con Blender 5.2.1 LTS:

- `npm run check`: aprobado, incluido el nuevo revisor de personajes.
- `npm test`: **61 aprobadas, 0 fallidas**.
- Los cuatro recursos conservan 15 huesos, ocho clips, geometría/pintura finitas y pesos normalizados. Las mangas y shorts nuevos incluyen pesos de sus articulaciones.
- Las figuras tienen geometría y materiales propios de ropa; sus dimensiones de silueta son distintas. Sus instancias comparten geometría y conservan materiales/esqueletos independientes.
- Los cinco peinados se activan por separado en cada recurso. Los cambios de piel/cabello de una instancia no alteran las demás.
- Las siete redes mantienen el contacto lógico y agarres con la familia nueva y el modelo histórico, en ambos extremos y posiciones intermedias del gesto.
- Los anclajes y vértices de las plantas reales se apoyan sobre las tres tablas.
- Los cuatro modelos se proyectan dentro de la cámara de carrera en escritorio y proporción vertical, incluyendo red a ambos lados, salto, extremos laterales y desviación del seguimiento.
- Continúan aprobadas economía, vidas, objetos compartidos, impulso, pausa, determinismo del recorrido y efectos de agua.

Las exportaciones guardaron `.blend` y `.glb` correctamente. Blender avisó de la futura retirada de `Material.use_nodes` y de falta de permiso para su caché de miniaturas; no impidió crear los recursos.

## Revisión visual y funcional

Se inspeccionaron los modelos en WebGL nativo. La galería usa un solo renderizador, sin guardado de perfil. Permite vista conjunta, foco en cada figura, frente/espalda y traslado de red. El mismo color coral en los cuatro permite comparar prendas sin basarse únicamente en recolor.

Se comprobó la selección de Nico, Luna y Samuel en **Tienda → Personajes**, con sus retratos y vistas previas. Se volvió a Amara después de la revisión. La página de movimiento cargó los nuevos recursos y se revisó el salto de Luna al 45 % del gesto.

La prueba de carrera con Nico alcanzó 473 m y 00:30 de tiempo de juego sin maniobras de evasión: recogió un plástico y quedó descalificado al perder las tres vidas. El resultado conservó el inventario previo, como establece la regla. Esto acredita avance y funcionamiento de los recursos nuevos en la carrera; no es una prueba de rendimiento ni de llegada a meta.

| Captura | Contenido |
|---|---|
| `preview-personajes-antes-v8.jpg` | Composición del pase 07 con la familia anterior de rivales |
| `preview-personajes-despues-v8.jpg` | Composición de Maracaibo con Nico, Luna y Samuel nuevos |
| `preview-club-espalda-v8.jpg` | Cuatro figuras con ropa propia, mismo color base |
| `preview-club-frente-v8.jpg` | Comparación frontal de la familia |
| `preview-nico-frente-v8.jpg` | Nico: mangas, chaleco y mandíbula |
| `preview-nico-red-izquierda-v8.jpg` | Nico de espalda y agarre izquierdo |
| `preview-luna-frente-v8.jpg`, `preview-luna-espalda-v8.jpg` | Luna: paneles, short y coleta |
| `preview-samuel-frente-v8.jpg`, `preview-samuel-espalda-v8.jpg` | Samuel: lycra, bermudas y rizos |
| `preview-luna-salto-v8.jpg` | Pose aérea reconstruida en el estudio de movimiento |
| `preview-tienda-personajes-v8.jpg` | Selección y vista previa de Samuel dentro de la tienda |
| `preview-carrera-nico-descalificado-v8.jpg` | Resultado de la prueba de carrera a 473 m |
| `preview-inicio-v8.jpg` | Inicio final con Amara y equipo original |

El primer arranque de la galería detectó el alias de módulo `three` ausente; se añadió el import map y las vistas posteriores cargaron correctamente. Las páginas de revisión y juego se dejaron actualizadas para el usuario.

## Perfil y límites

Antes y después de las comprobaciones la UI principal mostró 150 monedas, 36 plásticos y 22 chatarras. Se dejó en Inicio con Amara/Coral/Costero/Red costera y Maracaibo, restaurando la selección inicial. Las elecciones de personaje fueron gratuitas. No hubo compra, canje ni fabricación; la descalificación no otorgó recursos. La consola final de juego, composición y movimiento no registró errores; la galería conserva en su historial el error del primer arranque ya corregido.

La cámara vertical se comprobó mediante proyección automática de la geometría real; no se acredita una revisión visual móvil nueva. No se midieron FPS sostenidos ni tiempos de GPU. El cuadro de recursos de la guía artística cuenta únicamente cada actor y sus variantes de cabello.

Los ocho clips y la lógica de cuerpo siguen compartidos. La ropa y cabello no tienen simulación física, ni existen dedos con apertura individual. Las uniones de hombros/cadera y poses extremas admiten refinamiento; las capturas y pruebas no garantizan ausencia de toda intersección. El siguiente pase prioriza composición de orillas y sigue abierto a ajustar la familia cuando se revise en carrera.
