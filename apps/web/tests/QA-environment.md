# Paisaje de Maracaibo · 12 de octubre de 2026

## Arte y escena

Se exportaron desde Blender los modelos palafito, manglar y canoa, con fuente editable en `art/shoreline-kit.blend`. El entorno añade orillas de contorno irregular, vegetación baja, muelles y colores por instancia. La miniatura de Maracaibo muestra una fotografía del escenario real.

Las ondas del agua se ejecutan en la GPU. La CPU actualiza un uniforme de tiempo, sin recorrer los vértices por fotograma. Se conservan la iluminación, niebla y color del material estándar. Las variaciones decorativas no consumen la semilla del recorrido.

## Validación

- Sintaxis: `npm run check`, sin errores. Las 14 pruebas de economía, supervivencia y animación pasan.
- `node art/verification/check_environment.mjs`: GLB cargados correctamente, coordenadas y matrices finitas, límites de instancias válidos. Se verifican 23 lotes de paisaje y separación de construcciones, vegetación y bancos del canal jugable.
- Escritorio, 1280 × 900: carrera, recogida, impulso, cuatro surfistas, agua, palafitos y manglares visibles. La cámara trasera renderiza el mismo entorno sin otro contexto WebGL.
- Cenital: se detectó que el puente tapaba residuos al pasar por debajo. Se aplicó transparencia en esa cámara; la revisión a 253 m confirma que se distinguen objetos bajo el tablero. Volver a tercera persona recupera el material opaco.
- Móvil, 390 × 844: recorrido y controles visibles, cambio de tamaño correcto y sin desbordamiento horizontal. Consola sin errores ni advertencias durante las pruebas.
- La salida de las partidas de prueba conserva el inventario anterior. No se compró ni canjeó equipo para esta revisión.

Capturas: `preview-maracaibo-orillas.png`, `preview-puente-cenital.png` y `preview-menu-maracaibo.png`.

No se midieron fotogramas por segundo ni consumo de GPU en teléfonos físicos. La instanciación reduce llamadas de dibujo, pero las instancias comparten límites de visibilidad por lote; conviene medir el rendimiento al ampliar los mapas. El movimiento reducido está contemplado para el agua, sin emular esa preferencia durante esta revisión.
