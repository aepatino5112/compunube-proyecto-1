# B08 · Línea base funcional del frontend Surf Club

**Corte auditado:** `main` en `85bfe7dbbae1323a2a4a286b18c734d235515efe` (17-10-2026). **Alcance:** código y recursos importados en [`apps/web/`](../../apps/web/README.md). Esta es la referencia de lo que el cliente hace hoy para las siguientes decisiones de producto y backend; no congela reglas online ni contratos. Trello conserva el estado operativo y [`docs/roadmap.md`](../roadmap.md) las dependencias.

## Identidad y experiencia vigente

La interfaz se presenta como **«Compunube · Surf Club» / «Surf Club»**. Es la identidad visible del prototipo, sin constancia aquí de una decisión de marca irrevocable. Usa HTML/CSS, JavaScript de módulos ES y Three.js con modelos GLB. `cd apps/web && npm start` sirve la demo en `http://127.0.0.1:4173/` mediante un servidor de archivos local; no inicia un servicio de partidas. La experiencia jugable actual incluye **Lago de Maracaibo** y **Río Orinoco**, cuatro personajes (**Nico, Luna, Amara y Samuel**), tres tablas, tres atuendos, cinco peinados y siete redes. Caroní y Encuentro aparecen como destinos futuros, sin recorrido jugable en esta base. Tablas, atuendos, personajes, peinados y redes son cosméticos en la demo. Fuentes: [`README web`](../../apps/web/README.md), [`economy.js`](../../apps/web/dist/economy.js), [`appearance.js`](../../apps/web/dist/appearance.js), [`maps.js`](../../apps/web/dist/maps.js) y [fixture](../../apps/web/docs/backend/fixtures/current-front.json).

## Matriz de sistemas

| Sistema | Estado comprobado | Límite de la evidencia |
|---|---|---|
| Inicio, selección de mapa, ayuda, Club, personalización, tienda, taller, resultados y carrera | Implementado y jugable **local/offline** | Corre en un navegador; el servidor incluido solo entrega archivos. |
| Carrera con un humano y tres rivales de IA, movimiento, red, salto, impulso, recogida, vidas, salvavidas, pulpo, meta y descalificación | Implementado y probado **local/offline** | La simulación y el resultado se calculan en el cliente; no acreditan autoridad multijugador. |
| Materiales, monedas, canje, compra, fabricación, equipamiento y guardado | Implementado y probado **local/offline** | `localStorage` es editable por el cliente; la idempotencia local no es persistencia de servidor. |
| «Jugar con amigos», lobby, crear/entrar/listo/salir, envío de intenciones y presentación de snapshots, eventos y resultado | **Preparado, desconectado** | Requiere un adaptador inyectado y mensajes confirmados; no hay transporte ni sala real. |
| «Mi progreso», perfil online separado y operaciones de tienda/taller/canje/apariencia con confirmación, timeout y reintento | **Preparado, desconectado** | Se probó con adaptadores controlados; no hay cuenta, proveedor ni saldo online real. |
| Autenticación, partidas humanas entre dispositivos, simulación autoritativa Go, RPC Go→Rust de negocio, persistencia PostgreSQL de perfil/economía, settlement duradero, reentrada completa y segunda interfaz | **No implementado funcionalmente** | El skeleton/health del monorepo y los DTO propuestos no constituyen estas capacidades. |

La frontera de autoridad del proyecto está en [`ARCHITECTURE.md`](../../ARCHITECTURE.md): el cliente envía intención y representa estado confirmado; Go controla salas/carrera y resultados; Rust controla perfil/economía y settlement. Posición, vidas, pickups, ranking, recompensas y saldo enviados por un cliente nunca son verdad del servidor.

## Carrera local: reglas observadas

La carrera empieza con cuenta atrás y termina localmente cuando el humano llega a meta o queda descalificado; por eso el resultado mostrado no resuelve cuándo termina una carrera de cuatro humanos. El orden local usa tiempo de llegada para quienes terminaron, progreso para activos y descalificados al final; recoger más no determina el puesto ni da un premio de ranking. Abandonar o reiniciar no acredita materiales de esa carrera. Los tres rivales son IA del navegador. El pulpo persigue al humano local; su reparto entre humanos reales está abierto.

Los controles locales son giro lateral (flechas/A-D o botones móviles), salto (Espacio), lado de red (Z/X) e impulso (Shift). La red recoge por contacto; los objetos recogidos y salvavidas tienen dueño único dentro de **esa simulación local**. Los obstáculos y el pulpo afectan vidas; la protección temporal evita golpes encadenados y los salvavidas recuperan hasta el máximo. El modo local pausa al perder foco; la ruta online libera controles sin pausar una sala compartida. Fuentes: [`game.js`](../../apps/web/dist/game.js), [`mechanics.js`](../../apps/web/dist/mechanics.js), [`collection.js`](../../apps/web/dist/collection.js), [`survival.js`](../../apps/web/dist/survival.js), [`local-race.test.js`](../../apps/web/tests/local-race.test.js) y [`network-game-bridge.test.js`](../../apps/web/tests/network-game-bridge.test.js).

| Valor observado | Baseline local | Fuente |
|---|---:|---|
| Recorrido y límite lateral | 1800 m desde `surf-mvp-2` (900 m hasta `surf-mvp-1`); desde `surf-mvp-3` los residuos van por tramos de varios carriles; X entre −15 y +15 (ancho total 30) | [`maps.js`](../../apps/web/dist/maps.js) |
| Semillas de Maracaibo / Orinoco | 57 / 819 | [`fixture`](../../apps/web/docs/backend/fixtures/current-front.json) |
| Vidas máximas y protección tras golpe | 3; 2,6 s | [`survival.js`](../../apps/web/dist/survival.js) |
| Energía de impulso por residuo y consumo al usarla | +0,2; −0,25 por segundo | [`mechanics.js`](../../apps/web/dist/mechanics.js) |
| Canje de plástico / metal | 4 / 6 monedas por unidad | [`economy.js`](../../apps/web/dist/economy.js) |

Las coordenadas lógicas usan X lateral y Z negativo hacia la meta; Y es altura visual. Las posiciones, cantidades de objetos, colisiones, velocidades y balance actuales son insumos para B13/B16, no parámetros online definitivos. La [fixture estructurada](../../apps/web/docs/backend/fixtures/current-front.json) registra los recorridos y constantes actuales; sus **17 hashes de fuentes coinciden** con los archivos importados en este corte.

## Economía, personalización y guardado local

[`freshProfile()` y `transact()`](../../apps/web/dist/economy.js) crean y cambian el perfil de la demo: monedas, plástico, metal, total recogido, carreras, artículos propios, equipo, apariencia e IDs de carreras liquidadas. Empieza con saldo cero y artículos base; compra/fabricación y equipamiento son operaciones distintas. Seis redes adicionales requieren materiales (desde 6 plástico + 3 metal hasta 24 + 16); tablas y atuendos no cambian la física. La meta acredita los materiales locales una vez por ID de carrera; descalificación, salida y reinicio no los acreditan. El historial `settled` conserva como máximo 40 IDs en el navegador: no garantiza settlement persistente ni antifraude.

[`app.js`](../../apps/web/dist/app.js) guarda perfil, mapa y sonido en `localStorage` bajo `compunube.profile.v1`, `compunube.map.v1` y `compunube.sound.v1`. La cartera offline no se migra ni se mezcla con una cuenta online. Los valores iniciales, IDs, catálogo, recetas, cosméticos y cursos están en la [fixture](../../apps/web/docs/backend/fixtures/current-front.json); las transacciones locales se cubren en [`economy.test.js`](../../apps/web/tests/economy.test.js). Los precios, recetas y reglas de premio describen esta demo y permanecen sujetos a diseño posterior.

## Preparación online y sus límites

[`backend-config.js`](../../apps/web/dist/backend-config.js) exporta **`backendAdapter = null` y `profileAdapter = null`**. [`multiplayer-client.js`](../../apps/web/dist/multiplayer-client.js) gestiona conexión, sala, listo, entradas, salida y descarte de mensajes de otra sesión; [`multiplayer-lobby.js`](../../apps/web/dist/multiplayer-lobby.js) presenta el estado confirmado. [`network-race.js`](../../apps/web/dist/network-race.js) valida manifiesto y snapshots completos e interpola poses; [`network-presentation.js`](../../apps/web/dist/network-presentation.js) asigna IDs/propiedad, muestra eventos y resultado sin conceder premios locales. [`game.js`](../../apps/web/dist/game.js) expone `enterOnline`, `applySnapshot`, `applyEvent`, `applyResult` y `setConnectionState`, enlazados desde [`app.js`](../../apps/web/dist/app.js). Los controles envían intenciones con límite regular de 20 Hz; no envían posiciones calculadas por el cliente. Sin proveedor, «Con amigos» no fabrica salas.

[`online-profile.js`](../../apps/web/dist/online-profile.js) conserva un perfil confirmado por servidor separado del guardado local. Valida identidad, revisión, catálogo y propiedad; no gasta de forma optimista. Tras una respuesta incierta reintenta la misma acción con el mismo `requestId` (timeout por defecto: 12 s), pero el pendiente vive solo en memoria. El backend deberá resolver idempotencia persistente y recuperación tras recarga. No se envía una acción `finish` ni cantidades de premio desde el cliente. La guía de [salas/carrera](../../apps/web/docs/backend/FRONT_ADAPTER.md) y la de [perfil/economía](../../apps/web/docs/backend/PROFILE_ADAPTER.md) describen el adaptador esperado, no un proveedor ejecutándose.

## Trabajo de integración pendiente

| Frontera | Gap comprobado |
|---|---|
| Go | Identidad de sesión en frontera pública, salas y ciclo de carrera reales, validación de entradas, simulación/tick autoritativos, propiedad de objetos, vidas, resultado y coordinación de settlement. |
| Rust | Perfil, inventario, catálogo, economía y acciones persistentes con validación; settlement transaccional e idempotente por carrera/participante. |
| Realtime | Transporte cliente↔Go, snapshots/eventos, orden/versiones, manejo de desconexión, reconexión/reentrada y prueba con varios navegadores/dispositivos. |
| Contratos | Acordar interfaz pública del cliente y el contrato interno Go↔Rust de [`proto/`](../../proto/); compatibilidad de curso, reglas, perfil, errores e identidad. E43 sigue abierto. |
| Persistencia | PostgreSQL con ownership separado de contexto `match` (Go) y `player` (Rust), operaciones económicas duraderas y deduplicación tras pérdida de respuesta/recarga. |
| Producto/cliente | Acordar flujo de cuenta y sala; adaptar la UX web al servicio real y construir la segunda interfaz requerida. |

Los tipos [`contracts-proposed.ts`](../../apps/web/docs/backend/contracts-proposed.ts) —perfil/catálogo, sala, curso, input, snapshot, evento, resultado, errores y mensajes de protocolo 1— son **propuestas del frontend para discutir en E43**. No son endpoints existentes ni sustituyen `proto/`. Incluso las intenciones concretas de crear/entrar del [adaptador](../../apps/web/docs/backend/FRONT_ADAPTER.md) amplían los DTO iniciales propuestos con nombre y cosméticos; deben reconciliarse antes de conectar un servicio. Ninguna prueba con dobles de transporte demuestra autenticación, sincronización entre clientes o autoridad de servidor.

## Decisiones abiertas que B08 deja para otras tarjetas

| Tarjeta | Decisión pendiente, sin resolver aquí |
|---|---|
| B09 | Condiciones del multijugador, incluidos participantes, equidad, desconexión y desempates. |
| B10 | Recorrido online del jugador: identidad, acceso, sala, progreso y retorno. |
| B13 | Core loop y reparto exacto de autoridad entre cliente y servicio. |
| B14 | Mecánica propia de **Reducir** y balance de las 3R; hoy reciclar = canje, reutilizar = fabricación y reducir = contenido educativo. |
| B16 | Reglas autoritativas, ranking, fin global, daños, pulpo y recompensas. |
| B17 | Modelo multijugador y ciclo de sala, incluida reconexión/reentrada. |
| B18 | Actualización del Game Design Document desde el prototipo y las decisiones cerradas. |

## Evidencia, discrepancia y verificación

Se contrastaron [`README web`](../../apps/web/README.md), [`PLAN.md`](../../apps/web/PLAN.md), [preparación de red](../../apps/web/docs/FRONTEND_NETWORK.md), [handoff backend](../../apps/web/docs/backend/README.md), ambas guías de adaptador, tipos propuestos, fixture, módulos `dist/` y [`tests/`](../../apps/web/tests/). La fixture coincide en sus hashes de fuente. Las QA de [v1 local](../../apps/web/tests/QA-frontend-v1.md), [lobby](../../apps/web/tests/QA-multiplayer-lobby.md), [red](../../apps/web/tests/QA-network-front.md) y [perfil](../../apps/web/tests/QA-online-profile.md) son evidencias de sus pases; las pruebas online usan proveedores controlados y no un backend real.

**Discrepancia documental:** la sección «Puntos actuales de integración» de [`apps/web/docs/backend/README.md`](../../apps/web/docs/backend/README.md) todavía afirma que `game.js` no expone métodos para snapshots ni recibe estado remoto. Esa descripción corresponde a una etapa anterior: el código vigente contiene los métodos online y `app.js` los enlaza. La misma guía y los documentos de adaptación sí describen la preparación 1.2. Se conserva la diferencia como hallazgo de auditoría; la disponibilidad online sigue en **preparado, desconectado**.

En este corte, `npm ci --ignore-scripts --no-audit --no-fund`, `npm run check` y `npm test` pasaron en `apps/web/`: **135 pruebas aprobadas, 0 fallidas** (Node 24.19.0, npm 11.17.0). `npm start` sirvió la página principal con HTTP 200 en `127.0.0.1:4173`. Cubren, entre otras, [`local-race.test.js`](../../apps/web/tests/local-race.test.js), [`economy.test.js`](../../apps/web/tests/economy.test.js), [`multiplayer-client.test.js`](../../apps/web/tests/multiplayer-client.test.js), [`network-race.test.js`](../../apps/web/tests/network-race.test.js), [`network-game-bridge.test.js`](../../apps/web/tests/network-game-bridge.test.js), [`online-profile.test.js`](../../apps/web/tests/online-profile.test.js) y [`profile-app-bridge.test.js`](../../apps/web/tests/profile-app-bridge.test.js). No se ejecutó `make quality`: faltan las toolchains locales de Go y Rust. Las cifras de pruebas de los informes antiguos son cortes históricos; el resultado anterior corresponde a la suite de este commit.
