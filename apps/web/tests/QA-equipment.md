# Equipamiento · 12 de octubre de 2026

**Revisión posterior:** el pase de reloj y audio recuperó las capturas y completó dos carreras con el kit. Ver `QA-race-clock-audio.md`. Las limitaciones al final de este informe describen el estado de la comprobación anterior.

## Verificación automática

- Blender 5.2.1 LTS ejecutó `art/build_equipment.py`; fuente editable guardada y seis GLB exportados.
- `npm run check` y `npm test`: 18 pruebas aprobadas, incluidas cuatro que cargan el equipamiento real.
- Compra, fabricación, equipamiento y restauración del guardado v1 conservan sus identificadores y gasto único de recursos.
- Raycasts bajo los pies del surfista intersectan el tablero de los tres modelos a la altura esperada.
- Los anclajes de las tres redes coinciden con el punto de recogida; ambas manos mantienen menos de .012 unidades de error durante recogida a ambos lados.
- Las piezas comparten geometría y mantienen materiales independientes. Disponer una instancia no dispone geometría ni materiales de otra.

## Navegador · localhost:4173

- Tienda: Coral, Manglar y Sol del lago cambian selección, nombre, descripción y tarjeta activa. Manglar sigue bloqueada con 8 monedas y faltan 52, sin gastar recursos al previsualizar.
- Taller: tres fotografías del kit cargadas con resolución 300×200; Red reutilizada muestra 7/6 de plástico, 2/3 de chatarra y fabricación deshabilitada. Marea ya estaba fabricada en el perfil real.
- Se equipó Marea, se verificó su nombre en Inicio y se inició una carrera de prueba. Los botones de lado Z/X actualizaron `aria-pressed` correctamente. Después se abandonó, se restauró Red costera y se dejó Marea seleccionada como vista previa del Taller.
- Inventario final conserva 8 monedas, 7 de plástico y 2 de chatarra; no se compró, fabricó ni acreditó material de prueba en el perfil real.
- Anchos 1280×900 y 390×844: sin desbordamiento horizontal. En móvil las tres tarjetas de recetas caben en el panel y sus imágenes cargan.
- Consola: sin errores ni advertencias. Tamaño de revisión temporal restablecido al finalizar.

## Límite de la revisión visual

La API de captura del navegador devolvió «Unable to capture screenshot» tanto para viewport como página completa. Se inspeccionaron y guardaron las fotografías PNG que el propio renderizador produjo para las tarjetas: `preview-tabla-manglar.png` y `preview-red-marea.png`. Estas son imágenes reales de los modelos, no capturas de la interfaz completa.

La cuenta atrás avanzó muy lentamente durante la prueba pese al tiempo real transcurrido; no se completó una carrera ni se validó fluidez o FPS en este pase. No aparecieron errores en consola. No se atribuye todavía una causa al problema de fotogramas. Queda pendiente revisar visualmente el menú, las poses en movimiento y la carrera completa en una ventana que esté renderizando con normalidad, antes de considerar terminado el acabado de este kit.
