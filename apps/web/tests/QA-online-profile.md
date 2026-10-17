# Perfil y economía online · preparación 1.2

15 de octubre de 2026. Node.js 24.11, navegador integrado Chromium y servidor estático local. Los proveedores de producción continúan en `null`.

## Resultado

`npm run check` aprobado. Suite completa `node --test tests/*.test.js`: **135 aprobadas, 0 fallidas**, sin omitidas. Incluye 17 pruebas del almacén online, 7 del enlace de funciones reales de `app.js` y 11 del cliente de sala, además de la base local y visual existente.

El almacén comprueba identidad, revisiones, catálogo, propiedad y forma del perfil. Pruebas con adaptadores controlados cubren confirmación sin cambios anticipados, bloqueo de doble envío, rechazo, timeout, reintento del mismo ID, eventos anteriores a la respuesta, respuestas obsoletas o inválidas, reset y cancelación con callbacks tardíos. Las pruebas de aplicación ejecutan las funciones reales de commit, selección de ámbito, guardado, canje, recepción de perfil y liquidación de carreras mediante un entorno DOM controlado; no simulan WebGL ni una sesión de usuario autenticada.

## Navegador real

- «Mi progreso» abre el diálogo desde el menú; local seleccionado, online deshabilitado, sin balances online inventados y sin botón de consulta al faltar proveedor.
- Cierre mediante «Volver al club» y Escape devuelve el foco a `profile-open`.
- En 320 × 568 el panel mide 300 px, conserva márgenes y permite scroll vertical hasta la acción de regreso. Se corrigieron doble barra de scroll y opacidad heredada en la opción deshabilitada.
- En 1280 × 800 el panel mide 600 × 574 px y muestra sus controles completos, sin scroll interno necesario. Se restauró el viewport normal tras la comprobación.
- Canje local probado en `localhost:4173`, separado del perfil principal en `127.0.0.1`: 1 plástico entregado, recibo de +4 monedas y saldo guardado al recargar. No se gastaron recursos del perfil principal.

Capturas: [escritorio](../preview-perfil-local-online.png) y [móvil](../preview-perfil-mobile.png).

## Límites y siguiente validación

No hay un backend, autenticación ni multijugador real conectados. Los estados online con proveedor se verificaron con pruebas de código, no con una cuenta o servidor reales en el navegador. La idempotencia persistente, recuperación entre recargas, login/logout, cambio de cuenta y conciliación de catálogo necesitan implementación y pruebas conjuntas. El cliente conserva las operaciones inciertas sólo durante la sesión en memoria.

La guía de integración está en [PROFILE_ADAPTER.md](../docs/backend/PROFILE_ADAPTER.md). Esta entrega prepara el frontend; no demuestra seguridad, sincronización entre dispositivos ni rendimiento de red de un servicio todavía ausente.
