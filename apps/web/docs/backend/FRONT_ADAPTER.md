# Conectar el front al servicio de partidas

**15 de octubre de 2026.** El front ya contiene lobby, cliente de sesión y presentación de una carrera autoritativa. El proveedor continúa en `null`: esta entrega no incluye servidor, transporte de red, autenticación ni partidas online disponibles. El protocolo 1 de [contracts-proposed.ts](contracts-proposed.ts) sigue siendo una propuesta para acordar con el equipo backend.

**Implementación G59 (26 de octubre de 2026):** [`src/net/realtime.ts`](../../src/net/realtime.ts) implementa `createRoom`/`joinRoom` con `POST /v1/rooms` y `POST /v1/rooms/{roomId}/memberships`, y abre `/v1/realtime` con el subprotocolo `compunube.realtime.v1` (un servidor que no lo acepta se trata como versión incompatible). La sesión se resuelve cuando llega el primer `room.state` de esa sala. [`src/net/translate.ts`](../../src/net/translate.ts) convierte E43 a los DTO de esta guía: estados `LOBBY/COUNTDOWN/RACING/RESULTS` → `waiting/countdown/running/ended`; `CLOSED` cierra la sesión con `ROOM_CLOSED`; `race.start.roster` → `members`; `lengthUnits`/`lateralLimitUnits` → `lengthMeters`/`lateralLimitMeters`; `bottle/pipe/wrapper` → `0/1/2`; milisegundos → segundos; `lifesaver.collected` → `life.collected`. Go publica el `playerId` opaco como `displayName`; el cliente muestra el nombre del personaje. `room.ready` con `ready: true` lleva la `profileRevision` confirmada por el perfil online y la elección de Reducir; Go la verifica y la confirma por `room.state`. `race.ended` muestra `settlementState`; un `race.ended` posterior con `confirmed` solo actualiza ese estado y recarga el perfil confirmado. E45 no transporta nombre de sala, así que el lobby ya no lo pide. Las secciones siguientes describen la interfaz original del adaptador y siguen vigentes salvo esas precisiones.

**Reentrada G60/G61 (26 de octubre de 2026):** si el WebSocket se cae con una sala confirmada, el adaptador lo reabre con la misma cookie durante la ventana de 15 s de B17/E43 y notifica `reconnecting`/`live` al cliente (tercer argumento de `subscribe`). Mientras reconecta, el cliente no envía entradas ni Listo; la carrera sigue en Go y los demás jugadores no se pausan. Go reata la identidad y repite `room.state` más un snapshot completo (`RACING`) o el último `race.ended` (`RESULTS`); el cliente sincroniza `seq`/`jumpSeq` por encima de `lastProcessed*`. Si no hay `room.state` tras reabrir, la sesión termina con `NOT_A_MEMBER`; si vence la ventana, con `DISCONNECTED`; `CLOSED` termina con `ROOM_CLOSED`. Al recargar la página, `pagehide` solo cierra el canal (`detach`, sin `room.leave`) y `resume()` recupera la sala si la sesión sigue siendo válida: sin cookie no crea una sesión nueva. En `RACING`, E43 no repite `race.start`, así que el cliente reconstruye la presentación con el manifiesto versionado `dist/courses/<courseVersion>.json`, copia byte a byte de `services/match-service-go/internal/race/courses/` que CI Web verifica. En `LOBBY`/`COUNTDOWN`, Go elimina al miembro al desconectarse, por lo que una recarga allí vuelve al flujo de entrada. Limitación: la recarga solo recupera la carrera si la página vuelve a cargar dentro de esos 15 s.

**Contrato vigente:** [OpenAPI HTTP E45](../../../../contracts/http/README.md) define sesión y crear/entrar sala; [WebSocket E43](../../../../contracts/realtime/events.md) define preparación, salida y carrera. Los tipos y la interfaz del adaptador siguientes describen el estado actual del front y requieren traducción a esos contratos; no sustituyen sus rutas ni mensajes normativos.

El adaptador permite traducir el servicio que construya backend a esta frontera. No obliga a elegir una biblioteca, protocolo de transporte o arquitectura de servidor.

## Archivos y responsabilidad

| Archivo | Responsabilidad |
|---|---|
| `dist/backend-config.js` | Exporta `backendAdapter = null`; punto donde se conectará el proveedor acordado. |
| `dist/multiplayer-client.js` | Crear/entrar/salir de sala, estados de conexión, entradas permitidas y filtrado de mensajes de otra sesión/carrera. |
| `dist/multiplayer-lobby.js` | Formulario, miembros confirmados, estado Listo, errores y salida. |
| `dist/network-race.js` | Validación del manifiesto y snapshots completos; historial de interpolación. |
| `dist/network-presentation.js` | Relaciona IDs de servidor con modelos, objetos, efectos y resultado. |
| `dist/game.js` | Elige simulación local o presentación online; publica los métodos de recepción y las intenciones del jugador. |
| `dist/app.js` | Conecta esos módulos; conserva el perfil offline separado. |

Con proveedor `null`, «Con amigos» explica que falta el servicio y no fabrica salas, miembros, códigos ni conexiones. La carrera local sigue disponible.

## Contrato del adaptador inyectado

```ts
interface BackendAdapter {
  createRoom(request: CreateIntent, options: {signal: AbortSignal}): Promise<Session>;
  joinRoom(request: JoinIntent, options: {signal: AbortSignal}): Promise<Session>;
}

interface CreateIntent {
  requestId: string;
  mapId: 'maracaibo' | 'orinoco';
  displayName: string;
  equipment: Equipment;
  appearance: Appearance;
}
interface JoinIntent {
  requestId: string;
  roomId: string;
  displayName: string;
  equipment: Equipment;
  appearance: Appearance;
}
interface Session {
  selfPlayerId: string;
  room: RoomState;
  send(message: ClientMessage): void | false | Promise<void>;
  subscribe(
    onMessage: (message: ServerMessage) => void,
    onDisconnect: () => void
  ): () => void;
  close(): void;
}
```

`Equipment`, `Appearance`, `RoomState`, `ClientMessage` y `ServerMessage` están descritos en el archivo de contratos. Las intenciones `CreateIntent`/`JoinIntent` amplían los DTO iniciales de esa propuesta: incluyen nombre y cosméticos seleccionados; `JoinIntent` lleva también el código de sala. El adaptador puede traducirlos a las operaciones finalmente acordadas. Estos datos expresan una solicitud: el servidor debe confirmar identidad, pertenencia y equipamiento permitido.

El nombre solicitado se recorta en sus extremos y admite entre 1 y 24 caracteres. Los mapas y cosméticos se contrastan con el catálogo que este front conoce. La respuesta debe contener una sala real, con ID, versión de reglas/recorrido, capacidad 4, entre uno y cuatro miembros con IDs únicos y el participante `selfPlayerId` incluido. Una creación debe confirmar el mapa solicitado; una entrada debe confirmar el código solicitado.

Antes de `race.start`, el servidor debe haber confirmado la lista actual de miembros. El inicio debe coincidir con sus IDs y con las versiones de reglas/recorrido de la sala; no se acepta un inicio con versiones o participantes diferentes de los confirmados.

Obligaciones del adaptador:

- Resolver la promesa sólo cuando el servicio haya confirmado la entrada. Rechazarla con `{code}` para errores conocidos, por ejemplo `ROOM_FULL` o `ROOM_NOT_FOUND`.
- Respetar `signal` para cancelar trabajo pendiente. Si llega una respuesta después de salir, el cliente la descarta y cierra esa sesión.
- Conservar los mensajes recibidos antes de `subscribe` y entregarlos al suscribirse, para no perder un `race.start` temprano. La suscripción puede emitir sincrónicamente y debe devolver una función de limpieza.
- Avisar mediante `onDisconnect` cuando la sesión deje de ser utilizable. `send` debe lanzar, devolver `false` o rechazar su promesa cuando no pueda aceptar un envío; no simular éxito.
- Hacer que `close` y la función de limpieza liberen sus recursos. El cliente invalida callbacks anteriores y limpia incluso una respuesta tardía.

Ejemplo de envoltura, pendiente de implementar el transporte real:

```js
// Este módulo recibe el transporte del equipo backend; no abre conexiones ni
// devuelve salas ficticias por su cuenta. Se exige un servicio real inyectado.
export function makeBackendAdapter(transport) {
  if (typeof transport?.openRoom !== 'function') {
    throw new TypeError('Falta implementar el transporte de partidas.');
  }
  async function open(operation, request, {signal}) {
    const confirmed = await transport.openRoom({operation, request, signal});
    return {
      selfPlayerId: confirmed.selfPlayerId,
      room: confirmed.room,
      send: message => confirmed.send(message),
      subscribe: (onMessage, onDisconnect) =>
        confirmed.subscribe(onMessage, onDisconnect),
      close: () => confirmed.close(),
    };
  }
  return {
    createRoom: (request, options) => open('create', request, options),
    joinRoom: (request, options) => open('join', request, options),
  };
}
```

`transport.openRoom` es una dependencia por desarrollar. Después de acordar e implementar esa dependencia se podrá exportar su adaptador desde `dist/backend-config.js`; el archivo entregado mantiene `null`.

## API del cliente y flujo de mensajes

`createMultiplayerClient({adapter, callbacks})` expone:

| API | Comportamiento |
|---|---|
| `client.state` | Snapshot inmutable `{status,selfPlayerId,room,error}`. `error` es `null` u objeto `{code,message}` con texto de interfaz traducido. |
| `subscribe(listener)` | Notificación inmediata y siguientes actualizaciones; devuelve `unsubscribe`. |
| `createRoom(values)` / `joinRoom(values)` | `Promise<boolean>`; confirman únicamente con una respuesta válida del adaptador. |
| `setReady(boolean)` | Envía `room.ready` sólo en una sala `waiting`; devuelve si el transporte aceptó el envío. No cambia el miembro local de forma optimista. |
| `sendInput(input)` | Envía una intención válida de la carrera actual; descarta campos extra y secuencias inválidas. |
| `leave()` | Envía `room.leave` si existe sesión, cancela/limpia y vacía sala e identidad. |
| `dispose()` | Limpieza definitiva; ignora respuestas posteriores y nuevas operaciones. |

Estados: `unconfigured`, `idle`, `connecting`, `room`, `racing`, `disconnected`, `error`. El flujo normal es `idle → connecting → room → racing → room`. Un error corriente del servidor puede actualizar `error` sin destruir una sala válida; errores de sesión, versión, contrato o ejecución de callbacks cierran la sesión de forma segura. Las excepciones internas y textos arbitrarios del transporte no se muestran en la interfaz.

Todos los mensajes del protocolo propuesto incluyen `protocolVersion: 1`:

| Mensaje recibido | Callback | Conexión existente en `app.js` |
|---|---|---|
| `room.state` | Actualiza `client.state.room`. | El lobby muestra miembros y estados Listo confirmados. |
| `race.start` | `onStart({start,selfPlayerId})` | `game.enterOnline(...)` valida antes de cambiar la escena. |
| `race.snapshot` | `onSnapshot(snapshot)` | `game.applySnapshot(...)`. |
| `race.event` | `onEvent(event)` | `game.applyEvent(...)`; efecto visual, sin reclamar objetos localmente. |
| `race.ended` | `onResult(result)` | `game.applyResult(...)`; resultado confirmado, sin `onFinish` local. |
| `profile.updated` | `onProfile(data)` | Actualmente muestra un aviso; no sustituye la cartera offline. |
| Cambio de conexión | `onConnection(status)` | `game.setConnectionState(status)`. |

`onStart` debe validar sincrónicamente; puede devolver `false` o lanzar para rechazar el inicio. Los snapshots/eventos de otra carrera se ignoran. El validador de snapshots rechaza datos incompletos, fuera de rango o con tick repetido/atrasado sin reemplazar el último estado aceptado. Los eventos deduplicados sólo disparan efectos; sus contadores y propietarios se confirman por snapshot. Los resultados inválidos se rechazan y los repetidos no vuelven a liquidarse visualmente.

## Datos que puede representar esta versión

El servidor puede producir el recorrido o usar los fixtures como referencia, pero debe entregar el manifiesto completo en `race.start`. La escena reutiliza las cantidades de modelos que ya tiene preparadas:

| Campo | Restricción actual |
|---|---|
| Mapas | `maracaibo` u `orinoco`. |
| Participantes | 1–4, IDs únicos, jugador propio incluido; controlador `human` o `bot` declarado por servidor. |
| Longitud | `lengthMeters: 900`. |
| Límite lateral | `lateralLimitMeters: 15`, es decir, jugador X en `[-15,15]`. |
| Manifiesto | Exactamente 54 obstáculos, 103 residuos y 10 salvavidas. |
| Coordenadas del manifiesto | Números finitos: X en `[-64,64]`, Z en `[-900,50]`; permiten objetos visibles cerca de las orillas y salida. |
| Obstáculo | ID único y radio positivo. Los radios locales de referencia son 1.15 y 1.8; cualquier ajuste debe corresponder con su aspecto visible. |
| Residuo | ID único, `kind: 0\|1\|2`, rotación y fase finitas. 0 botella/plástico, 1 tubo/metal, 2 envoltorio/plástico. |
| IDs de objetos | Únicos entre las tres colecciones del manifiesto. No se usa el índice como propietario de red. |

Cada snapshot debe incluir **todos** los participantes de esa carrera y la propiedad de **todos los 103 residuos y los 10 salvavidas**, no sólo los modificados. Cada entrada lleva `itemId` y `collectedBy: playerId | null`. El orden puede variar: se relacionan por ID. Las listas deben estar completas, sin huecos ni IDs repetidos/desconocidos.

`PlayerState` usa Z hacia delante negativo y altura de salto lógica, sin la oscilación del agua. Debe incluir entradas procesadas, contadores, vida, energía, estado individual y todos los campos del tipo propuesto. Las vidas admiten 0–3; energía 0–1. Un descalificado tiene cero vidas; un llegado tiene tiempo de llegada. `collected` debe coincidir con `plastic + metal`.

El front interpola transformaciones continuas entre dos snapshots con retraso visual de 100 ms, sin predecir física. La propiedad, estados terminales y contadores usan la confirmación más reciente. `serverTimeMs` y `startsAtMs` son marcas del servidor en milisegundos; `elapsedSeconds` y `countdownSeconds` llegan del estado autoritativo. La frecuencia de snapshots y el tick de simulación backend deben acordarse: los 20 Hz de entradas no imponen ninguna de esas frecuencias.

## Entradas, foco y desconexión

```ts
{
  type: 'race.input', protocolVersion: 1, raceId: string,
  seq: number, steer: number, netSide: -1 | 1,
  boost: boolean, jumpSeq: number
}
```

La escena envía intenciones periódicas como máximo cada 50 ms (**20 Hz**). Salto, selección de red y liberación de controles pueden generar un envío inmediato adicional. `steer` debe estar entre -1 y 1; no se envían posiciones, impactos, recogidas, vidas ni premios. `seq` es un entero seguro creciente; `jumpSeq` aumenta por pulsación y no retrocede. Los contadores se sincronizan hacia arriba con `lastProcessedInputSeq`/`lastProcessedJumpSeq`; actualmente se reinician al entrar a una nueva carrera, por lo que cualquier reentrada futura necesita una regla acordada.

El servidor debe consumir cada nueva pulsación de salto una sola vez y validar todas las intenciones según la situación real del jugador. Las decisiones de avance, consumo de energía, choques, recogidas, clasificación y acreditación siguen perteneciendo al servidor.

La tecla de pausa, la pérdida de foco y una pestaña oculta liberan giro e impulso mediante una intención neutral. **No pausan la sala.** Si transcurren 3 segundos sin un snapshot válido, el front libera controles, envía neutral una vez si el transporte sigue utilizable y congela la animación de juego hasta volver a recibir estado. Esta interrupción de snapshots no cierra por sí sola un transporte todavía abierto.

Al confirmarse la desconexión, no se envían nuevas entradas y se muestra la pérdida de conexión. La recuperación disponible consiste en salir y volver a entrar; **no hay reconexión automática ni reanudación garantizada de una sesión rota**. Los callbacks de sesiones abandonadas no pueden revivir una partida. Si vuelven snapshots válidos por la misma sesión que seguía abierta, se elimina el historial visual anterior y los controles permanecen liberados.

El servidor necesita su propio **timeout de intenciones**: una orden neutral puede perderse junto con la conexión. La duración y la política de un jugador ausente deben acordarse con backend; el front no impone ese valor ni puede detener la simulación autoritativa al cerrar una pestaña.

## Perfil y economía: adaptador separado

El perfil online está **separado** del `localStorage` offline y dispone del adaptador descrito en [PROFILE_ADAPTER.md](PROFILE_ADAPTER.md). `profile.updated` se entrega al almacén si pertenece al participante propio y su revisión aumenta, o si la misma revisión contiene un `requestId` para confirmar una operación. Una respuesta rechazada por el almacén no adelanta la revisión del cliente de sala.

Tienda, taller, canje y apariencia utilizan el progreso elegido en **Mi progreso**. Online sólo muestra cambios confirmados por el proveedor. Los materiales de `race.ended` se muestran como resultado y no disparan `game.onFinish` ni una transacción `finish` local; el servidor acredita y publica el perfil actualizado. Antes de abrir una sala conectada se exige cargar el perfil; la identidad propia de inicio debe coincidir. Autenticación, persistencia autoritativa y reconciliación dinámica del catálogo corresponden al servicio y su integración pendiente.

## Verificar la conexión cuando exista el servicio

Ejecutar `npm run check` y `npm test` conserva las regresiones locales y valida esta frontera con adaptadores de prueba, sin presentar esos dobles como un servidor disponible. Las pruebas específicas están en `multiplayer-client.test.js`, `network-race.test.js`, `network-presentation.test.js` y `network-game-bridge.test.js`.

La validación real pendiente necesita varias pestañas/dispositivos contra el servicio del equipo: crear/entrar, estado Listo confirmado, una sola reclamación por objeto, llegadas y descalificación independientes, salida/desconexión, resultados y repetición de mensajes. El paquete frontend por sí solo no acredita esos escenarios de red reales.
