# Panel de progreso — 15 de octubre de 2026

## Alcance

`dist/profile-panel.js` y `dist/profile-panel.css` presentan el selector de progreso local/online. El panel no consulta al abrirse, no escribe en almacenamiento, no ejecuta transacciones, no acredita recompensas y no reinicia el store al cerrar o cambiar de modo. El perfil online sólo se puede seleccionar cuando existe un perfil confirmado y el store está `ready`.

## Comprobaciones de código

- Diálogo nativo con título y descripción asociados. Apertura enfoca el título; Escape y ambos botones de cierre devuelven el foco al elemento de apertura. Cerrar no cancela una operación.
- Dos botones con `aria-pressed` reflejan `getMode()`. Cada opción indica su ámbito. Local permanece disponible al cargar, fallar o esperar confirmación online.
- Sin adaptador: Online está deshabilitado, no se muestran cifras ni se inventa una cuenta, y no aparece el botón de consulta.
- `loading` y `pending` anuncian el estado y deshabilitan la consulta para evitar duplicados. El propio handler tiene bloqueo mientras espera la promesa.
- `uncertain` explica que se consultará la misma operación; sólo llama a `store.retry()`. Nunca llama a `reset()` o vuelve a ejecutar la compra/canje.
- Si hay un perfil anterior durante un error u operación pendiente, sus cifras se identifican como «Última confirmación recibida». No habilitan Online hasta volver a `ready`.
- Errores del servicio se traducen con un mapa cerrado. Los valores de perfil y estados se asignan con `textContent`; mensajes, IDs, revisiones y excepciones del servicio no se interpolan en HTML ni se muestran como detalle técnico.
- El panel restaura el foco y elimina suscripciones al destruirse. Una promesa resuelta después de `dispose()` no reconstruye el diálogo.
- Todos los botones tienen altura mínima de 44 px. El ancho se limita al viewport, las columnas usan `minmax(0,1fr)` y los números largos se ajustan. El diálogo permite scroll vertical en ventanas bajas.

## Revisión de integración

La apertura/cierre, foco, estado sin proveedor y composición en 320 × 568 y 1280 × 800 se comprobaron en navegador real. Resultados y capturas: [QA-online-profile.md](QA-online-profile.md). Los estados conectados de la siguiente lista se comprobaron a nivel de almacén y enlace de aplicación con adaptadores controlados; su recorrido visual con un servicio real queda pendiente.

1. Abrir «Mi progreso» con teclado, recorrer controles, cerrar con Escape y verificar el foco en el botón de apertura.
2. En 320 × 568 y escritorio: sin overflow horizontal; botón de vuelta accesible al hacer scroll; ningún elemento de la cabecera invade el cierre.
3. Sin servicio: perfil local activo, Online deshabilitado y sin saldo online inventado.
4. Con store de prueba fuera de producción: recorrer `idle → loading → ready`, seleccionar Online y verificar ámbitos en tienda/taller.
5. Recorrer `pending → uncertain → ready`; cambiar a Local durante la espera no elimina la operación. Reintentar consulta su mismo ID y no crea otra compra.
6. Tras un error: cifras previas marcadas como última confirmación, error legible y posibilidad de consultar de nuevo.
