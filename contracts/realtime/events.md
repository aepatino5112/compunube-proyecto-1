# E43 — Contrato realtime público v1

**Estado:** contrato congelado para el MVP online. Este archivo reemplaza el borrador conceptual anterior y es la fuente normativa del canal **cliente ↔ Go Match Service**. La ubicación de operaciones HTTP request/response se cierra en E45; este documento no convierte esas operaciones en WebSocket.

## Transporte

- Transporte: **WebSocket bidireccional**.
- Ruta pública reservada: **`/v1/realtime`**.
- Subprotocolo WebSocket: **`compunube.realtime.v1`**.
- Frames de aplicación: **texto UTF-8 con JSON**. v1 no usa frames binarios.
- Todo mensaje de aplicación contiene `type` y `protocolVersion: 1`.
- La conexión queda asociada por Go a una identidad/sesión validada. El cliente **no envía `playerId` para decidir quién es**.
- El mecanismo HTTP de autenticación/sesión del handshake pertenece a E45/F48; no se envían tokens en payloads de carrera.
- El tamaño máximo de frame, límites de cola y rate limits concretos se implementan bajo C22/D28; excederlos puede cerrar la conexión sin afectar la sala.

`rulesVersion`, `courseVersion` y `catalogVersion` **no son** la versión de red. Cambiar reglas del juego o un manifiesto no cambia por sí solo `protocolVersion`.

## Convenciones

### Identificadores

`roomId`, `raceId`, `playerId`, `eventId` y `requestId` son strings opacos. El cliente no deriva autoridad de su formato. Para v1:

- no vacíos;
- máximo 128 caracteres;
- sin caracteres de control;
- no se recortan silenciosamente para convertir un ID inválido en otro.

El formato UUID/ULID no forma parte del contrato.

### Tiempo y números

- Marcas absolutas `*AtMs` y `serverTimeMs`: entero en milisegundos Unix UTC suministrado por Go.
- Duraciones `*Ms`: entero no negativo.
- `tick`, secuencias y contadores: enteros no negativos dentro del rango seguro JSON.
- Coordenadas y magnitudes continuas: número finito.
- Las coordenadas de curso son **unidades del juego**, no metros físicos.

El orden competitivo usa el tick/tiempo autoritativo de Go; el reloj del cliente no decide resultados.

## Cliente → Go

v1 acepta exactamente estos comandos realtime:

- `room.ready`;
- `room.leave`;
- `race.input`.

Crear sala, entrar por código, consultar perfil/catálogo y mutar economía son operaciones request/response y se ubican en E45.

### `room.ready`

Solicita cambiar el estado ready del miembro actual. Go confirma el cambio únicamente mediante un `room.state` posterior.

```json
{
  "type": "room.ready",
  "protocolVersion": 1,
  "roomId": "room-opaque",
  "ready": true,
  "profileRevision": 7,
  "reduceChoice": "reusable"
}
```

Reglas:

- solo se admite en **LOBBY**;
- `ready: true` exige perfil online confirmado, equipamiento/apariencia válidos y elección de Reducir;
- `profileRevision` es obligatorio con `ready: true` y debe coincidir con la revisión de perfil que Go validó;
- `reduceChoice` es obligatorio con `ready: true`: `reusable` o `disposable`;
- con `ready: false`, `profileRevision`/`reduceChoice` pueden omitirse;
- cambiar preparación o retirar ready durante COUNTDOWN cancela el countdown mediante la lógica de sala y vuelve a LOBBY; no se procesa como un cambio optimista del cliente;
- la opción de Reducir pertenece a esa participación y no modifica física, premio o saldo.

### `room.leave`

```json
{
  "type": "room.leave",
  "protocolVersion": 1,
  "roomId": "room-opaque"
}
```

- antes de RACING elimina la membresía confirmada;
- durante RACING convierte al participante en `left` de forma autoritativa y cesa sus inputs;
- en RESULTS abandona la sala para la siguiente carrera;
- repetir el comando después de haber salido no produce un segundo resultado ni premio.

### `race.input`

```json
{
  "type": "race.input",
  "protocolVersion": 1,
  "raceId": "race-opaque",
  "seq": 381,
  "steer": -0.25,
  "netSide": -1,
  "boost": true,
  "jumpSeq": 12
}
```

Reglas:

- solo el participante asociado a la conexión puede actuar;
- `steer` ∈ [-1,+1];
- `netSide` ∈ {-1,+1};
- `boost` es intención, no confirmación de energía/velocidad;
- `seq` es estrictamente creciente por **(`raceId`, `playerId`)**;
- `jumpSeq` nunca decrece y aumenta exactamente cuando el cliente solicita un nuevo salto;
- Go conserva la última intención válida y consume cada valor nuevo de `jumpSeq` una sola vez;
- paquetes repetidos, atrasados, para otra carrera o fuera de RACING no alteran el estado;
- el cliente nunca envía posición, velocidad final, vidas, daño, pickup, ranking, outcome, premio ni saldo.

#### Regla de reentrada para secuencias

La reentrada **no reinicia** `seq` ni `jumpSeq`. El snapshot completo incluye `lastProcessedInputSeq` y `lastProcessedJumpSeq`. Después de reatar la misma identidad:

1. el cliente espera un snapshot completo;
2. sincroniza sus contadores al máximo conocido;
3. la siguiente intención usa `seq > lastProcessedInputSeq`;
4. una nueva pulsación usa `jumpSeq > lastProcessedJumpSeq`.

Así un paquete viejo previo a la desconexión no puede convertirse en una acción nueva.

## Go → Cliente

Mensajes normativos:

- `room.state`;
- `race.start`;
- `race.snapshot`;
- `race.event`;
- `race.ended`;
- `error`.

### Tipos compartidos de sala

Estados de sala v1:

- `LOBBY`
- `COUNTDOWN`
- `RACING`
- `RESULTS`
- `CLOSED`

Estados de participación v1:

- `not_ready`
- `ready`
- `racing`
- `reconnecting`
- `finished`
- `disqualified`
- `left`
- `dnf`

El contrato **no usa** los nombres históricos `waiting`, `running` o `ended`.

```ts
interface Equipment {
  boardId: string;
  outfitId: string;
  netId: string;
  hairId: string;
  characterId: string;
}

interface Appearance {
  skinId: string;
  hairColorId: string;
}

interface RoomMember {
  playerId: string;
  displayName: string;
  connected: boolean;
  ready: boolean;
  participantState:
    | 'not_ready' | 'ready' | 'racing' | 'reconnecting'
    | 'finished' | 'disqualified' | 'left' | 'dnf';
  profileRevision: number;
  reduceChoice: 'reusable' | 'disposable' | null;
  equipment: Equipment;
  appearance: Appearance;
}

interface RoomState {
  roomId: string;
  mapId: 'maracaibo' | 'orinoco';
  capacity: 4;
  state: 'LOBBY' | 'COUNTDOWN' | 'RACING' | 'RESULTS' | 'CLOSED';
  rulesVersion: string;
  courseVersion: string;
  raceId: string | null;
  countdownEndsAtMs: number | null;
  members: RoomMember[];
}
```

En LOBBY, `raceId = null`. En COUNTDOWN existe `countdownEndsAtMs`. En RACING/RESULTS, `raceId` identifica la carrera actual/última. `CLOSED` puede enviarse como último estado antes de cerrar la sesión.

### `room.state`

```json
{
  "type": "room.state",
  "protocolVersion": 1,
  "selfPlayerId": "player-opaque",
  "room": {}
}
```

Es la única confirmación realtime de membresía, ready y máquina de sala. Un cliente no muta su room local como verdad por haber enviado un comando.

### `race.start`

Se publica al pasar autoritativamente de COUNTDOWN a RACING.

```ts
interface CoursePoint { x: number; z: number; }

interface CourseManifest {
  mapId: 'maracaibo' | 'orinoco';
  courseVersion: string;
  lengthUnits: number;          // surf-mvp-1: 900
  lateralLimitUnits: number;    // surf-mvp-1: 15
  startSlotsX: number[];        // surf-mvp-1: [-9,-3,3,9]
  obstacles: Array<CoursePoint & {
    itemId: string;
    radius: number;
  }>;
  trash: Array<CoursePoint & {
    itemId: string;
    kind: 'bottle' | 'pipe' | 'wrapper';
    material: 'plastic' | 'metal';
    rotation: number;
    phase: number;
  }>;
  lifesavers: Array<CoursePoint & { itemId: string }>;
}

interface RaceStart {
  type: 'race.start';
  protocolVersion: 1;
  roomId: string;
  raceId: string;
  serverTimeMs: number;
  startedAtMs: number;
  rulesVersion: string;
  course: CourseManifest;
  roster: Array<{
    playerId: string;
    startSlotX: number;
    equipment: Equipment;
    appearance: Appearance;
    reduceChoice: 'reusable' | 'disposable';
  }>;
}
```

Para `surf-mvp-1`, cada manifiesto contiene 54 obstáculos, 103 residuos y 10 salvavidas. El cliente valida estructura/versión, pero Go sigue siendo autoridad.

### `race.snapshot`

Go publica snapshots completos a **10 Hz** (cada 100 ms lógicos, cada segundo tick del runtime D28). Pueden coalescerse/descartarse snapshots viejos bajo backpressure.

```ts
interface PlayerSnapshot {
  playerId: string;
  participantState:
    | 'racing' | 'reconnecting' | 'finished'
    | 'disqualified' | 'left' | 'dnf';
  x: number;
  z: number;
  speed: number;
  steer: number;
  netSide: -1 | 1;
  netAngle: number;
  energy: number;
  boosting: boolean;
  jumpHeight: number;
  jumpVelocity: number;
  lives: number;
  protectionRemainingMs: number;
  collectedPlastic: number;
  collectedMetal: number;
  finishTimeMs: number | null;
  lastProcessedInputSeq: number;
  lastProcessedJumpSeq: number;
}

interface PickupOwnership {
  itemId: string;
  collectedBy: string | null;
}

interface PursuitSnapshot {
  targetPlayerId: string;
  gap: number;
  retreatRemainingMs: number;
}

interface RaceSnapshot {
  raceId: string;
  tick: number;
  serverTimeMs: number;
  elapsedMs: number;
  players: PlayerSnapshot[];
  trash: PickupOwnership[];
  lifesavers: PickupOwnership[];
  pursuits: PursuitSnapshot[];
}
```

Mensaje:

```json
{
  "type": "race.snapshot",
  "protocolVersion": 1,
  "snapshot": {}
}
```

Reglas de recuperación:

- incluye todos los participantes de la carrera;
- incluye propiedad de los 103 residuos y 10 salvavidas del manifiesto actual;
- una lista completa posterior reemplaza la verdad anterior por `itemId`;
- eventos perdidos no son necesarios para reconstruir ownership/vidas/estado terminal;
- un cliente que reentra recibe de inmediato un snapshot completo antes de reanudar inputs.

### `race.event`

Eventos son feedback semántico y **no sustituyen** el snapshot. Tienen `eventId` único para deduplicación.

```ts
type RaceEvent =
  | { kind: 'trash.collected'; itemId: string; playerId: string; material: 'plastic' | 'metal' }
  | { kind: 'lifesaver.collected'; itemId: string; playerId: string; lives: number }
  | { kind: 'player.hit'; playerId: string; cause: 'obstacle' | 'octopus'; lives: number }
  | { kind: 'player.finished'; playerId: string; finishTimeMs: number }
  | { kind: 'player.disqualified'; playerId: string }
  | { kind: 'player.left'; playerId: string }
  | { kind: 'player.dnf'; playerId: string };

interface RaceEventEnvelope {
  type: 'race.event';
  protocolVersion: 1;
  event: RaceEvent & {
    eventId: string;
    raceId: string;
    tick: number;
  };
}
```

Los eventos pueden usarse para efectos visuales. Nunca conceden propiedad o recursos si el snapshot/resultado no los confirma.

### `race.ended`

Go construye el resultado global; el cliente no recalcula puestos ni premio.

```ts
interface ParticipantResult {
  playerId: string;
  outcome: 'finished' | 'disqualified' | 'left' | 'dnf';
  rank: number | null;
  finishTimeMs: number | null;
  collected: { plastic: number; metal: number };
  credited: { plastic: number; metal: number };
  reduceChoice: 'reusable' | 'disposable';
  settlementState: 'pending' | 'confirmed';
}

interface RaceResult {
  raceId: string;
  roomId: string;
  rulesVersion: string;
  courseVersion: string;
  endedAtMs: number;
  participants: ParticipantResult[];
}
```

Mensaje:

```json
{
  "type": "race.ended",
  "protocolVersion": 1,
  "result": {}
}
```

Invariantes:

- solo `finished` tiene `rank` numérico;
- `disqualified`, `left` y `dnf` tienen `rank = null` y `credited = 0`;
- para `finished`, `credited` es exactamente el material que Go decidió acreditar según B16;
- `race.ended` confirma el **resultado Go**, no que el perfil Rust ya se haya actualizado;
- `settlementState` puede estar `pending` o `confirmed`;
- Go puede volver a enviar `race.ended` para el mismo `raceId` únicamente para reflejar progreso `pending → confirmed`; los campos competitivos no cambian y el cliente no suma recursos por recibirlo otra vez.

El perfil actualizado se obtiene por la frontera pública request/response que E45 defina. El antiguo borrador `profile.updated` **no pertenece al realtime v1**.

## Errores realtime

Formato:

```ts
interface RealtimeError {
  type: 'error';
  protocolVersion: 1;
  error: {
    code:
      | 'INVALID_MESSAGE'
      | 'INCOMPATIBLE_VERSION'
      | 'SESSION_REQUIRED'
      | 'ROOM_NOT_FOUND'
      | 'ROOM_FULL'
      | 'NOT_A_MEMBER'
      | 'INVALID_STATE'
      | 'INVALID_READY'
      | 'PROFILE_STALE'
      | 'PROFILE_UNAVAILABLE'
      | 'INVALID_INPUT'
      | 'RACE_NOT_ACTIVE'
      | 'RATE_LIMITED'
      | 'INTERNAL_ERROR';
    message: string;
    relatedType: string | null;
    fatal: boolean;
  };
}
```

Semántica mínima:

| Código | Uso |
| --- | --- |
| `INVALID_MESSAGE` | JSON inválido, campos requeridos ausentes o shape no aceptado. |
| `INCOMPATIBLE_VERSION` | `protocolVersion`/subprotocolo no soportado. |
| `SESSION_REQUIRED` | conexión sin identidad/sesión válida. |
| `ROOM_NOT_FOUND` / `ROOM_FULL` | error de sala cuando aplique a la sesión. |
| `NOT_A_MEMBER` | intenta actuar sobre sala/carrera ajena. |
| `INVALID_STATE` | comando válido por forma, inválido en la máquina actual. |
| `INVALID_READY` | preparación incompleta o elección de Reducir inválida. |
| `PROFILE_STALE` | revisión enviada no coincide con perfil confirmado por Go. |
| `PROFILE_UNAVAILABLE` | no puede validar perfil/Rust durante preparación; no detiene una carrera activa. |
| `INVALID_INPUT` | rango/secuencia/intención inválida. |
| `RACE_NOT_ACTIVE` | input para carrera inexistente/terminada. |
| `RATE_LIMITED` | exceso de tasa/límite de mensajes. |
| `INTERNAL_ERROR` | fallo no atribuible al cliente; no filtra detalles internos. |

El cliente localiza por `code`; `message` es texto seguro de diagnóstico/interfaz y no debe contener secretos.

Un error no fatal no altera por sí mismo el último estado confirmado. Si el protocolo/sesión es incompatible, Go puede enviar el error y cerrar el WebSocket con un close code estándar apropiado.

## Reconexión y acceso al estado confirmado

La reconexión concreta de transporte/sesión se implementa en F48/E45, pero la recuperación de datos v1 queda congelada:

- **RACING:** misma identidad reatada → `room.state` actual + `race.snapshot` completo; no se reproducen eventos históricos.
- **RESULTS:** misma identidad reatada → `room.state` + último `race.ended` disponible.
- **LOBBY/COUNTDOWN:** se recibe `room.state`; si la sesión dejó de ser miembro, el cliente vuelve al flujo de entrada.
- otra identidad no puede recuperar el participante.
- la ventana de reentrada de carrera es 15 s y proviene de B17; no es un timeout de WebSocket negociable por cliente.

## Versionado y compatibilidad

### Realtime

`protocolVersion = 1` y el subprotocolo `compunube.realtime.v1` representan el mismo major.

Dentro de v1 se permiten cambios **aditivos compatibles**:

- campos nuevos opcionales;
- nuevos códigos de error que clientes deben degradar a error genérico;
- nuevos valores de evento solo si clientes desconocidos pueden ignorarlos sin cambiar autoridad.

Requieren v2:

- renombrar/eliminar campos requeridos;
- cambiar tipo o semántica de un campo existente;
- cambiar reglas de secuencia;
- convertir un mensaje en autoridad distinta;
- modificar la unidad de un campo sin nombre/versión nueva.

Un cliente v1 ignora campos desconocidos, pero no inventa defaults para campos requeridos ausentes.

### Relación con versiones de dominio

- `rulesVersion = surf-mvp-1`: simulación/ranking/premios;
- `courseVersion`: manifiesto de un mapa;
- `catalogVersion`: economía/cosméticos;
- `protocolVersion = 1`: forma/semántica de red.

Son ejes independientes.

## Backpressure y entrega

- snapshots son recuperables y pueden coalescerse;
- `race.event` es transitorio: un snapshot posterior recupera verdad;
- `room.state`, `race.start`, `race.ended` y errores fatales no se descartan silenciosamente;
- si una cola crítica no progresa, Go cierra esa conexión en lugar de bloquear RoomLoop;
- cerrar una conexión no detiene la sala.

## Fuente TypeScript normativa

La representación de tipos para clientes está en [`contracts/realtime/v1.ts`](v1.ts). El antiguo [`contracts-proposed.ts`](../../apps/web/docs/backend/contracts-proposed.ts) queda como referencia histórica del frontend preparado; sus nombres `waiting/running/ended`, bots, `lengthMeters`, DNF ausente y `profile.updated` **no son el contrato E43**.

## Límites

E43 no define:

- endpoints HTTP de crear/entrar sala, perfil, catálogo o acciones: E45;
- proveedor/mecanismo de login: E45/F48;
- implementación de WebSocket/RoomLoop: F46/F49/F50;
- UX de reconexión: G56/G57;
- lógica de carrera: B16/F53;
- retry/circuit breaker hacia Rust: E38/J77;
- Swagger para gRPC: no aplica; OpenAPI documentará solo HTTP en E45.
