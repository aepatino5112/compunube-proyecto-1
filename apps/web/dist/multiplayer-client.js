// Transport-independent session boundary. Only an injected backend adapter can
// confirm a room or race; the local game and its saved profile remain separate.
import {MAPS} from './maps.js';
import {CATALOG} from './economy.js';
import {SKIN_TONES, HAIR_COLORS} from './appearance.js';
const MAP_IDS = new Set(MAPS.map(map => map.id));
const EQUIPMENT = Object.fromEntries(['board', 'outfit', 'net', 'hair', 'character']
  .map(type => [type, new Set(CATALOG.filter(item => item.type === type).map(item => item.id))]));
const APPEARANCE = {
  skin: new Set(SKIN_TONES.map(tone => tone.id)),
  hairColor: new Set(HAIR_COLORS.map(color => color.id)),
};
const ROOM_STATES = new Set(['waiting', 'countdown', 'running', 'ended']);
const ERROR_MESSAGES = {
  NOT_CONFIGURED: 'El modo online todavía no tiene conectado el backend.',
  INVALID_REQUEST: 'Revisa el nombre, el mapa y el equipo para entrar a la sala.',
  ALREADY_CONNECTED: 'Sal de la sala actual antes de entrar a otra.',
  ROOM_FULL: 'La sala ya tiene cuatro participantes.',
  ROOM_NOT_FOUND: 'No encontramos esa sala. Revisa el código.',
  RACE_NOT_ACTIVE: 'La carrera todavía no está disponible.',
  NOT_A_MEMBER: 'Tu sesión ya no pertenece a esta sala.',
  INCOMPATIBLE_VERSION: 'El servidor usa una versión distinta. Actualiza el juego antes de volver a entrar.',
  SESSION_REQUIRED: 'El servidor necesita una sesión válida para continuar.',
  INVALID_ACTION: 'El servidor no pudo aceptar esa acción.',
  INVALID_ITEM: 'Ese objeto no está disponible en el servidor.',
  INSUFFICIENT_COINS: 'No tienes suficientes monedas en tu perfil online.',
  INSUFFICIENT_MATERIALS: 'No tienes suficientes materiales en tu perfil online.',
  NOT_OWNED: 'Ese objeto no pertenece a tu perfil online.',
  ALREADY_OWNED: 'Ese objeto ya pertenece a tu perfil online.',
  INVALID_APPEARANCE: 'El servidor no reconoce esa apariencia.',
  CONNECTION_FAILED: 'No pudimos conectar con el servidor. Puedes volver a intentarlo.',
  DISCONNECTED: 'Se perdió la conexión con el servidor. Sal de la sala y vuelve a entrar.',
  INVALID_RESPONSE: 'El servidor envió datos de sala o de carrera incompatibles.',
  CLIENT_CALLBACK: 'No se pudo actualizar la partida online. Puedes volver al juego local.',
  INVALID_STATE: 'La sala no admite ese cambio ahora. Si ya estás en otra sala, recarga la página para recuperarla o sal de ella.',
  INVALID_READY: 'Elige cómo reducirás residuos y confirma tu perfil online antes de estar listo.',
  PROFILE_STALE: 'Tu perfil online cambió. Actualízalo y vuelve a marcar que estás listo.',
  PROFILE_UNAVAILABLE: 'El perfil online no está disponible para preparar la carrera. La sala sigue abierta; inténtalo en unos momentos.',
  RATE_LIMITED: 'Demasiadas acciones seguidas. Espera un momento.',
  INVALID_MESSAGE: 'El servidor no reconoció un mensaje de esta versión del juego.',
  INVALID_INPUT: 'El servidor descartó una entrada de control.',
  INTERNAL_ERROR: 'El servicio de partidas tuvo un problema. La sala sigue su curso.',
  ROOM_CLOSED: 'La sala se cerró. Puedes crear otra o entrar con un nuevo código.',
  SERVICE_UNAVAILABLE: 'El servicio de partidas no está disponible ahora. Inténtalo de nuevo en unos momentos.',
  TIMEOUT: 'La sala tardó demasiado en responder. Inténtalo de nuevo.',
};
const REDUCE_CHOICES = new Set(['reusable', 'disposable']);
const PARTICIPANT_STATES = new Set(['not_ready', 'ready', 'racing', 'reconnecting', 'finished', 'disqualified', 'left', 'dnf']);
const id = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 128;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
let requestSequence = 0;
function requestId() {
  return globalThis.crypto?.randomUUID?.() ?? `front-${Date.now().toString(36)}-${++requestSequence}`;
}
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}
function selection(value, choices) {
  if (!record(value) || Object.keys(choices).some(key => !choices[key].has(value[key]))) return null;
  return Object.fromEntries(Object.keys(choices).map(key => [key, value[key]]));
}
function member(value) {
  if (!record(value) || !id(value.playerId) || typeof value.displayName !== 'string' ||
      !value.displayName.trim() || value.displayName.length > 80 ||
      !['human', 'bot'].includes(value.controller) || typeof value.ready !== 'boolean' ||
      typeof value.connected !== 'boolean') return null;
  // E43 members publish their equipment once Go has verified their preparation.
  const unprepared = value.equipment === null && value.appearance === null && !value.ready;
  const equipment = unprepared ? null : selection(value.equipment, EQUIPMENT);
  const appearance = unprepared ? null : selection(value.appearance, APPEARANCE);
  if (!unprepared && !(equipment && appearance)) return null;
  const extra = {};
  if (PARTICIPANT_STATES.has(value.participantState)) extra.participantState = value.participantState;
  if (REDUCE_CHOICES.has(value.reduceChoice)) extra.reduceChoice = value.reduceChoice;
  return {
    playerId: value.playerId, displayName: value.displayName, controller: value.controller,
    ready: value.ready, connected: value.connected, equipment, appearance, ...extra,
  };
}
function roomState(value, selfPlayerId) {
  if (!record(value) || !id(value.roomId) || !MAP_IDS.has(value.mapId) || value.capacity !== 4 ||
      !id(value.rulesVersion) || !id(value.courseVersion) || !ROOM_STATES.has(value.state) ||
      !Array.isArray(value.members) || value.members.length < 1 || value.members.length > 4) return null;
  const members = value.members.map(member);
  if (members.some(value => !value) || new Set(members.map(value => value.playerId)).size !== members.length ||
      !members.some(value => value.playerId === selfPlayerId)) return null;
  return {
    roomId: value.roomId, mapId: value.mapId, capacity: 4, rulesVersion: value.rulesVersion,
    courseVersion: value.courseVersion, state: value.state, members,
    ...(id(value.raceId) ? {raceId: value.raceId} : {}),
    ...(Number.isSafeInteger(value.countdownEndsAtMs) ? {countdownEndsAtMs: value.countdownEndsAtMs} : {}),
  };
}
function selfResult(result, selfPlayerId) {
  const own = Array.isArray(result?.participants) ? result.participants.find(item => item?.playerId === selfPlayerId) : null;
  if (!own || !id(result.raceId) || !['finished', 'disqualified', 'left', 'dnf'].includes(own.outcome)) return null;
  return freeze({raceId: result.raceId, outcome: own.outcome, rank: Number.isInteger(own.rank) ? own.rank : null,
    credited: {plastic: own.credited?.plastic ?? 0, metal: own.credited?.metal ?? 0},
    reduceChoice: REDUCE_CHOICES.has(own.reduceChoice) ? own.reduceChoice : null,
    settlementState: own.settlementState === 'confirmed' ? 'confirmed' : 'pending'});
}
function friendlyError(error, fallback = 'CONNECTION_FAILED') {
  const code = Object.hasOwn(ERROR_MESSAGES, error?.code) ? error.code : fallback;
  // Do not render arbitrary server/transport exception text in the interface.
  return freeze({code, message: ERROR_MESSAGES[code]});
}

/**
 * Proposed adapter interface, independent of HTTP/WebSocket libraries:
 * createRoom(request, {signal}) / joinRoom(request, {signal}) return a session:
 * {selfPlayerId, room, send(message), subscribe(onMessage, onDisconnect), close()}.
 * subscribe returns an unsubscribe function. Cosmetics in the request express
 * intent; the server validates ownership and confirms the actual member state.
 */
export function createMultiplayerClient({adapter = null, callbacks = {}} = {}) {
  const configured = !!adapter && typeof adapter.createRoom === 'function' && typeof adapter.joinRoom === 'function';
  let state = freeze({status: configured ? 'idle' : 'unconfigured', selfPlayerId: null, room: null, error: null, result: null});
  const listeners = new Set();
  let generation = 0, pending = null, connection = null, disposed = false;
  let raceId = null, lastInputSeq = -1, lastJumpSeq = 0, lastProfileRevision = -1, linkStatus = null;

  function close(handle) {
    if (!handle || handle.closed) return;
    handle.closed = true;
    try { handle.unsubscribe?.(); } catch { /* Best-effort transport cleanup. */ }
    handle.unsubscribe = null;
    try {
      const closing = handle.session.close();
      closing?.catch?.(() => {});
    } catch { /* A closed transport is already unusable. */ }
  }
  function invalidate() {
    generation++;
    pending?.abort(); pending = null;
    const previous = connection; connection = null;
    close(previous);
    raceId = null; lastInputSeq = -1; lastJumpSeq = 0; lastProfileRevision = -1; linkStatus = null;
  }
  function update(patch, reportConnection = true) {
    if (disposed) return;
    const previousStatus = state.status;
    state = freeze({...state, ...patch});
    for (const listener of [...listeners]) {
      try { listener(state); }
      catch {
        listeners.delete(listener);
        fail({code: 'CLIENT_CALLBACK'});
        return;
      }
    }
    if (reportConnection && previousStatus !== state.status) call('onConnection', state.status);
  }
  function fail(error, fallback = 'INVALID_RESPONSE') {
    if (disposed) return;
    invalidate();
    update({status: 'error', room: null, selfPlayerId: null, error: friendlyError(error, fallback)}, false);
    // A failing connection callback must not recurse while reporting its error.
    try {
      const reported = callbacks.onConnection?.('error');
      reported?.catch?.(() => {});
    } catch { /* Local mode remains usable. */ }
  }
  function call(name, payload) {
    const token = generation;
    try {
      const value = callbacks[name]?.(payload);
      if (value && typeof value.then === 'function') value.catch(() => {
        if (!disposed && token === generation) fail({code: 'CLIENT_CALLBACK'});
      });
      return {ok: true, value};
    }
    catch { fail({code: 'CLIENT_CALLBACK'}); return {ok: false}; }
  }
  function send(message) {
    const handle = connection, token = generation;
    if (!handle || handle.closed || disposed) return false;
    try {
      const sent = handle.session.send(message);
      if (sent === false) { fail(null, 'DISCONNECTED'); return false; }
      if (sent && typeof sent.then === 'function') sent.catch(() => {
        if (token === generation && handle === connection) fail(null, 'DISCONNECTED');
      });
      return true;
    } catch { fail(null, 'DISCONNECTED'); return false; }
  }
  function disconnected(token, code) {
    if (disposed || token !== generation || !connection) return;
    invalidate();
    const error = friendlyError(Object.hasOwn(ERROR_MESSAGES, code) ? {code} : null, 'DISCONNECTED');
    if (['SESSION_REQUIRED', 'INCOMPATIBLE_VERSION', 'NOT_A_MEMBER', 'ROOM_CLOSED', 'INVALID_RESPONSE'].includes(error.code)) {
      update({status: 'error', room: null, selfPlayerId: null, error});
    } else update({status: 'disconnected', error});
  }
  // The transport may reopen the channel inside the reentry window. While it
  // does, the room keeps running in Go; this client sends nothing.
  function linkChanged(token, value) {
    if (disposed || token !== generation || !connection) return;
    if (value === 'reconnecting' && state.status !== 'reconnecting') {
      linkStatus = state.status; update({status: 'reconnecting', error: null});
    } else if (value === 'live' && state.status === 'reconnecting') {
      const previous = linkStatus || 'room'; linkStatus = null; update({status: previous, error: null});
    }
  }
  function receive(message, token) {
    if (disposed || token !== generation || !connection || !record(message)) return;
    if (message.protocolVersion !== 1) { fail({code: 'INCOMPATIBLE_VERSION'}); return; }
    if (state.status === 'reconnecting' && message.type !== 'error') linkChanged(token, 'live');
    if (message.type === 'room.state') {
      const room = roomState(message.room, state.selfPlayerId);
      if (!room || message.selfPlayerId !== state.selfPlayerId || room.roomId !== state.room.roomId ||
          (raceId && (room.mapId !== state.room.mapId||room.rulesVersion!==state.room.rulesVersion||room.courseVersion!==state.room.courseVersion))) { fail(null); return; }
      update({room, error: null});
    } else if (message.type === 'race.start') {
      if (raceId || state.status !== 'room') return;
      if (!id(message.raceId) || message.course?.mapId !== state.room.mapId ||message.rulesVersion!==state.room.rulesVersion||message.course?.courseVersion!==state.room.courseVersion||
          !Array.isArray(message.members)||message.members.length!==state.room.members.length||new Set(message.members.map(value=>value?.playerId)).size!==message.members.length||!message.members.every(value=>state.room.members.some(confirmed=>confirmed.playerId===value?.playerId))) {
        fail(null); return;
      }
      raceId = message.raceId; lastInputSeq = -1; lastJumpSeq = 0;
      const accepted = call('onStart', {start: message, selfPlayerId: state.selfPlayerId});
      if (!accepted.ok) return;
      if (accepted.value === false) { fail(null); return; }
      if (token === generation && connection) update({status: 'racing', error: null});
    } else if (message.type === 'race.snapshot') {
      if (state.status === 'racing' && message.snapshot?.raceId === raceId) call('onSnapshot', message.snapshot);
    } else if (message.type === 'race.event') {
      if (state.status === 'racing' && message.event?.raceId === raceId) call('onEvent', message.event);
    } else if (message.type === 'race.ended') {
      if (state.status === 'racing') {
        if (message.result?.raceId !== raceId) return;
        if (!call('onResult', message.result).ok || token !== generation) return;
        raceId = null;
        update({status: 'room', room: {...state.room, state: 'ended'}, error: null, result: selfResult(message.result, state.selfPlayerId)});
        return;
      }
      // Go repeats race.ended only to move settlementState pending -> confirmed,
      // and replays it once to a client that reattaches during RESULTS.
      const summary = selfResult(message.result, state.selfPlayerId);
      if (!summary || state.status !== 'room' || state.room?.state !== 'ended' ||
          (state.result && state.result.raceId !== summary.raceId)) return;
      const confirmed = state.result?.settlementState !== 'confirmed' && summary.settlementState === 'confirmed';
      update({result: summary});
      if (confirmed) call('onSettlement', message.result);
    } else if (message.type === 'profile.updated') {
      if (message.data?.playerId === state.selfPlayerId && Number.isSafeInteger(message.data.profileRevision) &&
          (message.data.profileRevision>lastProfileRevision||message.data.profileRevision===lastProfileRevision&&id(message.data.requestId))) {
        const accepted=call('onProfile',message.data);
        if(accepted.ok&&accepted.value!==false)lastProfileRevision=message.data.profileRevision;
      }
    } else if (message.type === 'error') {
      const error = friendlyError(message.error, 'INVALID_ACTION');
      if (message.error?.fatal === true || ['SESSION_REQUIRED', 'INCOMPATIBLE_VERSION', 'NOT_A_MEMBER'].includes(error.code)) fail(error);
      // Inputs are best effort: a dropped or rate-limited intent does not need UI.
      else if (!['INVALID_INPUT', 'RATE_LIMITED', 'RACE_NOT_ACTIVE'].includes(message.error?.code) || message.error?.relatedType !== 'race.input') update({error});
    }
  }
  function attach(session, room, token) {
    const handle = {session, unsubscribe: null, closed: false}; connection = handle;
    update({status: 'room', room, selfPlayerId: session.selfPlayerId, error: null, result: null});
    if (token !== generation || disposed) return false;
    const unsubscribe = session.subscribe(message => receive(message, token), code => disconnected(token, code),
      value => linkChanged(token, value));
    if (typeof unsubscribe !== 'function') { fail(null); return false; }
    if (handle.closed || token !== generation || disposed) unsubscribe();
    else handle.unsubscribe = unsubscribe;
    return token === generation && connection === handle;
  }
  async function connect(kind, values = {}) {
    if (disposed) return false;
    if (!configured) { update({error: friendlyError({code: 'NOT_CONFIGURED'})}); return false; }
    if (connection || pending) { update({error: friendlyError({code: 'ALREADY_CONNECTED'})}); return false; }
    const equipment = selection(values.equipment, EQUIPMENT), appearance = selection(values.appearance, APPEARANCE);
    const displayName = typeof values.displayName === 'string' ? values.displayName.trim() : '';
    if (!equipment || !appearance || !displayName || displayName.length > 24 ||
        (kind === 'createRoom' ? !MAP_IDS.has(values.mapId) : !id(values.roomId))) {
      update({status: 'error', error: friendlyError({code: 'INVALID_REQUEST'})}); return false;
    }
    const token = ++generation, controller = new AbortController();
    pending = controller;
    update({status: 'connecting', selfPlayerId: null, room: null, error: null});
    if (token !== generation || disposed) return false;
    const request = {requestId: requestId(), equipment, appearance, displayName,
      ...(kind === 'createRoom' ? {mapId: values.mapId} : {roomId: values.roomId.trim()})};
    let session;
    try {
      session = await adapter[kind](request, {signal: controller.signal});
      if (token !== generation || disposed) {
        if (session && typeof session.close === 'function') close({session, closed: false});
        return false;
      }
      pending = null;
      const room = roomState(session?.room, session?.selfPlayerId);
      if (!room || !id(session.selfPlayerId) || typeof session.send !== 'function' ||
          typeof session.subscribe !== 'function' || typeof session.close !== 'function' ||
          (kind === 'createRoom' ? room.mapId !== request.mapId : room.roomId !== request.roomId)) {
        if (session && typeof session.close === 'function') close({session, closed: false});
        fail(null); return false;
      }
      return attach(session, room, token);
    } catch (error) {
      if (token !== generation || disposed) return false;
      // Preserve known server error codes, never exception text or stack traces.
      fail(error, 'CONNECTION_FAILED'); return false;
    }
  }

  return {
    get state() { return state; },
    subscribe(listener) {
      if (disposed || typeof listener !== 'function') return () => {};
      listeners.add(listener);
      try { listener(state); }
      catch { listeners.delete(listener); fail({code: 'CLIENT_CALLBACK'}); }
      return () => listeners.delete(listener);
    },
    createRoom(values) { return connect('createRoom', values); },
    joinRoom(values) { return connect('joinRoom', values); },
    /**
     * Reattach to a room this session still belongs to (page reload, G61).
     * prepare() runs after Go confirmed the room and before any message is
     * delivered, e.g. to load the online profile a resumed race start needs.
     */
    async resume(prepare) {
      if (disposed || !configured || typeof adapter.resume !== 'function' || connection || pending) return false;
      const token = ++generation, controller = new AbortController();
      pending = controller;
      let session;
      try { session = await adapter.resume({signal: controller.signal}); }
      catch { if (token === generation) pending = null; return false; }
      if (token !== generation || disposed) { if (session) close({session, closed: false}); return false; }
      pending = null;
      if (!session) return false;
      const room = roomState(session.room, session.selfPlayerId);
      if (!room || !id(session.selfPlayerId)) { close({session, closed: false}); return false; }
      let ready = true;
      try { ready = typeof prepare === 'function' ? await prepare(session.selfPlayerId) !== false : true; } catch { ready = false; }
      if (!ready || token !== generation || disposed) { close({session, closed: false}); return false; }
      return attach(session, room, token);
    },
    /** E43 ready: true needs the profile revision Go verifies and a Reducir choice. */
    setReady(ready, {profileRevision, reduceChoice} = {}) {
      if (typeof ready !== 'boolean' || state.status !== 'room' || !['waiting', 'countdown'].includes(state.room?.state)) return false;
      if (ready && (state.room.state !== 'waiting' || !Number.isSafeInteger(profileRevision) || profileRevision < 0 || !REDUCE_CHOICES.has(reduceChoice))) return false;
      return send({type: 'room.ready', protocolVersion: 1, roomId: state.room.roomId, ready,
        ...(ready ? {profileRevision, reduceChoice} : {})});
    },
    sendInput(input) {
      if (state.status !== 'racing' || !record(input) || input.type !== 'race.input' || input.protocolVersion !== 1 ||
          input.raceId !== raceId || !Number.isSafeInteger(input.seq) || input.seq < 0 || input.seq <= lastInputSeq ||
          !Number.isFinite(input.steer) || input.steer < -1 || input.steer > 1 || ![-1, 1].includes(input.netSide) ||
          typeof input.boost !== 'boolean' || !Number.isSafeInteger(input.jumpSeq) || input.jumpSeq < lastJumpSeq) return false;
      const accepted = send({type: 'race.input', protocolVersion: 1, raceId, seq: input.seq,
        steer: input.steer, netSide: input.netSide, boost: input.boost, jumpSeq: input.jumpSeq});
      if (accepted) { lastInputSeq = input.seq; lastJumpSeq = input.jumpSeq; }
      return accepted;
    },
    leave() {
      if (disposed) return false;
      if (connection && state.room) send({type: 'room.leave', protocolVersion: 1, roomId: state.room.roomId});
      invalidate();
      update({status: configured ? 'idle' : 'unconfigured', selfPlayerId: null, room: null, error: null, result: null});
      return true;
    },
    /**
     * Close the channel without room.leave, e.g. on page unload: Go keeps the
     * membership and the race reentry window so the same session can return.
     */
    detach() {
      if (disposed) return;
      invalidate();
      update({status: configured ? 'idle' : 'unconfigured', selfPlayerId: null, room: null, error: null, result: null}, false);
    },
    dispose() {
      if (disposed) return;
      if (connection && state.room) send({type: 'room.leave', protocolVersion: 1, roomId: state.room.roomId});
      disposed = true; invalidate(); listeners.clear();
      state = freeze({status: configured ? 'idle' : 'unconfigured', selfPlayerId: null, room: null, error: null, result: null});
    },
  };
}
