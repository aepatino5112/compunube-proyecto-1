# Revisión · personaje y siete recogedores

2026-10-13. Pase 02; el acabado artístico queda abierto a la valoración del usuario.

## Entrega comprobada

- Blender 5.2.1 LTS generó `surfer.blend`, `equipment-kit.blend`, surfista GLB y siete redes. El surfista conserva 15 huesos y ocho clips; añade construcción de ropa y tres mallas de peinado seleccionables. La fuente mantiene componentes editables.
- Tienda → Peinados ofrece Al viento, Rizos y Recogido. Equipar Rizos y recargar restauró su selección; al finalizar se volvió a Al viento en el perfil de pruebas. Cambiar de frente/espalda modifica el encuadre.
- Taller muestra siete conjuntos de mango/malla, recetas, modelos reales, estado de fabricación y acabado. Aurora y Sol del puente se previsualizaron sin fabricar ni gastar materiales. El listado tiene desplazamiento propio para mantener cerca los detalles.
- Estudio manual: se revisaron espalda, recogida y traslado intermedio con Rizos/Aurora y Recogido/Sol del puente. La bolsa tiene tejido diagonal y fondo; el mango termina en una unión bifurcada al aro. Las bandas de emisión se ven en los modelos reales.
- Móvil 390 × 844: tienda y taller tienen `clientWidth = scrollWidth = 375` (15 px de barra de desplazamiento); se accedió a la séptima receta. La carrera ocupa los 390 px. Vista trasera y corazones siguen presentes.

## Carrera y cámara

La revisión móvil de Maracaibo avanzó hasta **473 m / 00:30**, recogió un plástico y terminó descalificada al agotar vidas. No se acreditaron recompensas. No fue una carrera completada ni una medición de FPS. Los materiales del perfil de prueba permanecieron en **44 plástico / 27 chatarra**, con Red reutilizada equipada.

Se encontró un fallo al reiniciar y pausar inmediatamente: la cámara podía conservar el lugar de la carrera anterior mientras el personaje volvía a salida. Reset ahora fuerza un dibujo y encuadre nuevos y restablece el FOV; la cámara se coloca al iniciar la cuenta atrás o al pausar ese inicio. Se comprobó la salida pausada con personaje y puente visibles.

## Pruebas

`npm run check` aprobado. `npm test`: **41 pruebas aprobadas**. Las nuevas comprobaciones cubren migración v1, peinados e inventario persistentes, gasto único de las siete recetas, ausencia de modificadores de juego, aislamiento de estilos entre clones y cambio Z/X continuo al invertir/congelar. Las pruebas de los siete GLB verifican anclaje de recogida y agarres de ambas manos; los apoyos de pies y congelación siguen pasando.

Los modelos y las variantes se reutilizan en las vistas. No se midió memoria GPU ni rendimiento sostenido en dispositivos físicos. La ropa mantiene el mismo corte en sus tres paletas; aún no hay mangos/mallas intercambiables por separado ni otros tipos de objetos fabricables.

## Evidencia

- `preview-surfista-espalda.jpg`: pose manual reconstruida con los modelos compartidos, no carrera activa.
- `preview-personalizacion-surfista.jpg`: tienda habitual, tres peinados y Rizos en vista previa; 150 monedas conservadas.
- `preview-traslado-red-mejorado.jpg`: moño y pose intermedia del traslado.
- `preview-taller-siete-redes.jpg`: taller con Aurora previsualizada.
- `preview-peinados-movil.jpg`: tienda a tamaño móvil.
- `preview-surfista-carrera-movil.jpg`: carrera activa a 472 m con pulpo cercano.
- `preview-surfista-salida-movil.jpg`: salida pausada con cámara corregida.

El perfil habitual de `127.0.0.1:4173` conserva sus 150 monedas y equipo. Las pruebas de peinados y carrera se hicieron en `localhost:4173`.
