# Compunube · preparación del front para backend (1.2)

**Estado:** frontera de conexión e interfaz preparadas; servicio de partidas pendiente. **Fecha:** 15 de octubre de 2026.

La v1 local sigue disponible con Maracaibo, Orinoco y sus tres rivales de IA. Esta preparación añade la entrada a salas con amigos y una ruta de presentación para recibir una carrera autoritativa. No incluye un servidor multijugador ni activa partidas entre equipos por sí sola.

El [cierre Front v1](FRONTEND_V1.md) conserva la referencia de la entrega local. El [adaptador para backend](backend/FRONT_ADAPTER.md) documenta la conexión técnica propuesta; los contratos y decisiones compartidas se mantienen en la [entrega backend](backend/README.md).

## Lo que ve el jugador

En Inicio aparece **Jugar con amigos**. Abre un diálogo con crear sala, entrar mediante código y un nombre opcional. Con la configuración entregada, el servicio todavía no está conectado: la interfaz explica «El modo con amigos estará disponible cuando conectemos el servicio de partidas», desactiva crear/unirse y permite **Jugar una carrera local**.

Al conectar el adaptador del equipo backend, la misma interfaz puede mostrar el destino, el código compartible y hasta cuatro plazas. Los participantes, identidades, conexión y estado listo proceden de la sala confirmada. Las plazas vacías se presentan como invitaciones; el front no genera amigos ficticios para rellenarlas. Una señal de listo pendiente se muestra como «Confirmando…» y espera respuesta del servicio.

La salida de una sala pide confirmación; cancelar una conexión descarta la operación pendiente. El diálogo utiliza etiquetas de campos, nombres accesibles, avisos de estado, Escape y restauración del foco. El diseño contempla ventanas estrechas y desplazamiento vertical. La verificación visual y de integración se registra por separado; estas características no equivalen a una prueba de juego online real.

## Piezas preparadas

| Módulo | Responsabilidad |
|---|---|
| `dist/backend-config.js` | Inyección de `backendAdapter` y `profileAdapter`, ambos en `null`; no presupone transporte, proveedor o direcciones de servicio. |
| `dist/online-profile.js` | Perfil confirmado, revisiones, identidad y operaciones pendientes/reintentables con el mismo ID. |
| `dist/profile-panel.js` y `.css` | Selector Mi progreso, estado del servicio y última cartera confirmada. |
| `dist/multiplayer-client.js` | Ciclo de conexión, creación/unión a salas, listo, abandono y envío de entradas; recibe mensajes del servicio y deriva los estados de interfaz. |
| `dist/multiplayer-lobby.js` y `.css` | Diálogo de amigos, código, participantes confirmados, errores y alternativa local. |
| `dist/network-race.js` | Validación y almacenamiento de la carrera recibida; muestreo de estados para presentar el movimiento remoto. |
| `dist/network-presentation.js` | Asociación de identidades a personajes, visibilidad de objetos y efectos a partir de estados/eventos; lectura del resultado confirmado. |
| `dist/game.js` y `dist/app.js` | Selección entre carrera local y presentación online, controles, escena, avisos de conexión y regreso al club. |

No es necesario cambiar de motor ni de recursos visuales para conectar esta frontera. Blender/GLB/Three.js siguen siendo el flujo artístico. La tecnología y el protocolo del servicio se acuerdan con el equipo backend y se adaptan en ese punto de entrada.

## Cómo se separan las partidas

La carrera local conserva su simulación, IA, pausa, economía y guardado. La ruta online se inicia únicamente con una carrera confirmada por el cliente de partidas: usa sus participantes y su recorrido, transmite intención de control y presenta estados recibidos. No ejecuta la simulación local para decidir posiciones, recogidas, daño o resultados, ni añade rivales por su cuenta. Un rival que el servidor confirme como bot se identifica como simulado.

La recogida de un objeto y los contadores esperan al estado autoritativo. Los eventos pueden producir sonidos y animaciones; esos efectos no conceden materiales. La presentación filtra eventos y resultados repetidos para evitar repetir efectos o mostrar dos cierres de la misma carrera, pero la garantía económica debe residir en el servidor.

Los controles de una partida conectada no pausan la sala para todos. Al perder foco se liberan las entradas; la presentación puede avisar que espera conexión. La interfaz permite abandonar y regresar al club. Una desconexión no se transforma en una carrera local ni genera una recompensa de sustitución.

## Perfil y economía: preparación del cliente

El perfil local `compunube.profile.v1` sigue perteneciendo a ese navegador. Su saldo, inventario y resultados son la referencia de la demo offline. La elección de equipo enviada al entrar expresa una preferencia; no prueba que ese usuario posea los objetos en un perfil del servicio.

**Mi progreso** muestra el ámbito activo. Sin proveedor mantiene Local y deshabilita Online, sin inventar cuentas o balances. Con un proveedor válido permite consultar y seleccionar el perfil confirmado. Tienda, taller, canje y apariencia usan ese ámbito y esperan la respuesta del servicio; los botones de cambios quedan bloqueados durante una operación. Si se pierde la respuesta, el panel permite reintentar la misma acción con su mismo ID. Cerrar el panel o elegir Local no borra esa operación.

La carrera local utiliza siempre el perfil offline y acredita sólo su propia cartera. La carrera online muestra el resultado sin calcular premios: espera la actualización del perfil de la misma cuenta. Las respuestas viejas o de otra identidad no reemplazan el saldo confirmado. No se migran monedas ni inventario del navegador al servicio.

La [guía de perfil](backend/PROFILE_ADAPTER.md) detalla `getProfile`, `performAction`, errores, confirmación y límites. Backend debe aportar autenticación, autorización, catálogo/propiedad, transacciones persistentes e idempotencia. Las operaciones inciertas se conservan sólo en memoria; recuperación entre recargas y cambio de cuenta requieren integración adicional. La [verificación de esta preparación](../tests/QA-online-profile.md) separa pruebas de cliente y validación real pendiente.

## Qué falta para jugar entre amigos

El equipo backend debe suministrar un servicio y adaptar su conexión al punto de entrada documentado, confirmar las decisiones de sala y enviar el recorrido, los estados y los resultados compatibles. La implementación actual se ajusta al contenido y las reglas visibles de estos dos mapas; cambios del curso o del contrato requieren coordinación con el front.

Quedan por conectar los proveedores a la identidad autenticada, la política completa de reconexión o reentrada y las pruebas con varios navegadores y un servidor real. El contrato de adaptador permite preparar esa conexión sin imponer endpoints ni un stack concreto. Las pruebas con dobles de transporte y los informes de interfaz validan piezas del cliente; no demuestran sincronización, latencia o seguridad de un backend que aún no está conectado.
