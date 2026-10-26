// Transport-independent, read-only presentation of an authoritative race.
// No physics, local pickup claims, rewards, timers or network connections run here.
import { MAPS, COURSE_LENGTH, COURSE_WIDTH } from './maps.js';
import { CATALOG } from './economy.js';
import { SKIN_TONES, HAIR_COLORS } from './appearance.js';
import { MAX_LIVES } from './survival.js';
import { NET_LEFT_ANGLE } from './mechanics.js';

const COUNTS = Object.freeze({ obstacles: 54, trash: 103, lifesavers: 10 });
const CONTINUOUS = ['x', 'z', 'speed', 'turn', 'netAngle', 'jump', 'jumpVelocity'];
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const fail = message => { throw new TypeError(message); };
function object(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${path}: se esperaba un objeto.`);
  return value;
}
function text(value, path) {
  if (typeof value !== 'string' || !value.trim()) fail(`${path}: falta un identificador o texto válido.`);
  return value;
}
function number(value, path, min = -Infinity, max = Infinity) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail(`${path}: número fuera de rango o no finito.`);
  return value;
}
function integer(value, path, min = 0, max = Number.MAX_SAFE_INTEGER) {
  number(value, path, min, max);
  if (!Number.isSafeInteger(value)) fail(`${path}: se esperaba un entero seguro.`);
  return value;
}
function boolean(value, path) {
  if (typeof value !== 'boolean') fail(`${path}: se esperaba verdadero o falso.`);
  return value;
}
function choice(value, choices, path) {
  if (!choices.includes(value)) fail(`${path}: valor no compatible con este front.`);
  return value;
}
function list(value, path, length) {
  if (!Array.isArray(value) || (length !== undefined && value.length !== length)) fail(`${path}: cantidad de elementos no compatible con este front.`);
  for (let index = 0; index < value.length; index++) if (!own(value, index)) fail(`${path}: la lista contiene huecos.`);
  return value;
}
function uniqueId(value, ids, path) {
  const id = text(value, path);
  if (ids.has(id)) fail(`${path}: identificador repetido.`);
  ids.add(id); return id;
}
function freeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function member(value, ids, index) {
  const path = `members[${index}]`;
  object(value, path); object(value.equipment, `${path}.equipment`); object(value.appearance, `${path}.appearance`);
  const equipment = {};
  for (const type of ['board', 'outfit', 'net', 'hair', 'character']) {
    equipment[type] = choice(value.equipment[type], CATALOG.filter(item => item.type === type).map(item => item.id), `${path}.equipment.${type}`);
  }
  return {
    playerId: uniqueId(value.playerId, ids, `${path}.playerId`),
    displayName: text(value.displayName, `${path}.displayName`),
    controller: choice(value.controller, ['human', 'bot'], `${path}.controller`),
    ready: boolean(value.ready, `${path}.ready`), connected: boolean(value.connected, `${path}.connected`),
    equipment,
    appearance: {
      skin: choice(value.appearance.skin, SKIN_TONES.map(item => item.id), `${path}.appearance.skin`),
      hairColor: choice(value.appearance.hairColor, HAIR_COLORS.map(item => item.id), `${path}.appearance.hairColor`),
    },
  };
}
function sanitizeStart(value, selfPlayerId) {
  object(value, 'race.start');
  choice(value.type, ['race.start'], 'type'); choice(value.protocolVersion, [1], 'protocolVersion');
  const course = object(value.course, 'course');
  choice(course.mapId, MAPS.map(map => map.id), 'course.mapId');
  choice(course.lengthMeters, [COURSE_LENGTH], 'course.lengthMeters');
  choice(course.lateralLimitMeters, [COURSE_WIDTH], 'course.lateralLimitMeters');
  const ids = new Set(), cleanCourse = {
    mapId: course.mapId, courseVersion: text(course.courseVersion, 'course.courseVersion'),
    initialSeed: integer(course.initialSeed, 'course.initialSeed', 0, 0xffffffff),
    lengthMeters: COURSE_LENGTH, lateralLimitMeters: COURSE_WIDTH,
  };
  for (const [kind, count] of Object.entries(COUNTS)) {
    cleanCourse[kind] = list(course[kind], `course.${kind}`, count).map((entry, index) => {
      const path = `course.${kind}[${index}]`; object(entry, path);
      // These meshes cover the supported 900 m course and its two visible banks.
      const clean = { id: uniqueId(entry.id, ids, `${path}.id`), x: number(entry.x, `${path}.x`, -64, 64), z: number(entry.z, `${path}.z`, -COURSE_LENGTH, 50) };
      if (kind === 'obstacles') clean.radius = number(entry.radius, `${path}.radius`, Number.MIN_VALUE);
      if (kind === 'trash') {
        clean.kind = choice(entry.kind, [0, 1, 2], `${path}.kind`);
        clean.rotation = number(entry.rotation, `${path}.rotation`); clean.phase = number(entry.phase, `${path}.phase`);
      }
      return clean;
    });
  }
  const rawMembers = list(value.members, 'members');
  if (!rawMembers.length || rawMembers.length > 4) fail('members: se necesitan entre uno y cuatro participantes.');
  const playerIds = new Set(), members = rawMembers.map((entry, index) => member(entry, playerIds, index));
  if (!playerIds.has(text(selfPlayerId, 'selfPlayerId'))) fail('selfPlayerId: tu participante no aparece en esta carrera.');
  // Keep the server roster intact in start; presentation gets a separate self-first order.
  return freeze({
    type: 'race.start', protocolVersion: 1, raceId: text(value.raceId, 'raceId'),
    serverTimeMs: number(value.serverTimeMs, 'serverTimeMs', 0), startsAtMs: number(value.startsAtMs, 'startsAtMs', 0),
    rulesVersion: text(value.rulesVersion, 'rulesVersion'), course: cleanCourse, members,
  });
}
function player(value, ids, seen, index, totalTrash) {
  const path = `players[${index}]`; object(value, path);
  const playerId = uniqueId(value.playerId, seen, `${path}.playerId`);
  if (!ids.has(playerId)) fail(`${path}.playerId: participante desconocido.`);
  const clean = {
    playerId, state: choice(value.state, ['racing', 'reconnecting', 'finished', 'disqualified', 'left', 'dnf'], `${path}.state`),
    x: number(value.x, `${path}.x`, -COURSE_WIDTH, COURSE_WIDTH), z: number(value.z, `${path}.z`, -COURSE_LENGTH, 50),
    speed: number(value.speed, `${path}.speed`, 0), turn: number(value.turn, `${path}.turn`, -1, 1),
    netSide: choice(value.netSide, [-1, 1], `${path}.netSide`), netAngle: number(value.netAngle, `${path}.netAngle`, 0, NET_LEFT_ANGLE),
    energy: number(value.energy, `${path}.energy`, 0, 1), boosting: boolean(value.boosting, `${path}.boosting`),
    jump: number(value.jump, `${path}.jump`, 0), jumpVelocity: number(value.jumpVelocity, `${path}.jumpVelocity`),
    lives: integer(value.lives, `${path}.lives`, 0, MAX_LIVES), protection: number(value.protection, `${path}.protection`, 0), hit: number(value.hit, `${path}.hit`, 0),
    collected: integer(value.collected, `${path}.collected`, 0, totalTrash),
    plastic: integer(value.plastic, `${path}.plastic`, 0, totalTrash), metal: integer(value.metal, `${path}.metal`, 0, totalTrash),
    finishTimeSeconds: value.finishTimeSeconds === null ? null : number(value.finishTimeSeconds, `${path}.finishTimeSeconds`, 0),
    lastProcessedInputSeq: integer(value.lastProcessedInputSeq, `${path}.lastProcessedInputSeq`),
    lastProcessedJumpSeq: integer(value.lastProcessedJumpSeq, `${path}.lastProcessedJumpSeq`),
  };
  if (clean.collected !== clean.plastic + clean.metal) fail(`${path}: el total recogido no coincide con sus materiales.`);
  if (clean.state === 'finished' && clean.finishTimeSeconds === null) fail(`${path}: falta el tiempo de llegada.`);
  if (clean.state === 'disqualified' && clean.lives !== 0) fail(`${path}: un participante descalificado debe tener cero vidas.`);
  for (const field of ['catchTimer', 'landingTimer']) if (own(value, field)) clean[field] = number(value[field], `${path}.${field}`, 0);
  return clean;
}
function ownership(value, manifestIds, playerIds, path) {
  const seen = new Set();
  return list(value, path, manifestIds.size).map((entry, index) => {
    const at = `${path}[${index}]`; object(entry, at);
    const itemId = uniqueId(entry.itemId, seen, `${at}.itemId`);
    if (!manifestIds.has(itemId)) fail(`${at}.itemId: objeto desconocido en este recorrido.`);
    if (entry.collectedBy !== null && !playerIds.has(entry.collectedBy)) fail(`${at}.collectedBy: propietario desconocido.`);
    return { itemId, collectedBy: entry.collectedBy };
  });
}
function sanitizeSnapshot(value, start, members) {
  object(value, 'snapshot');
  if (value.raceId !== start.raceId) fail('raceId: el estado pertenece a otra carrera.');
  const playerIds = new Set(members.map(entry => entry.playerId)), seen = new Set(), pursuits = new Set();
  const players = list(value.players, 'players', members.length).map((entry, index) => player(entry, playerIds, seen, index, start.course.trash.length));
  const byId = new Map(players.map(entry => [entry.playerId, entry]));
  return freeze({
    raceId: start.raceId, tick: integer(value.tick, 'tick'), serverTimeMs: number(value.serverTimeMs, 'serverTimeMs', 0),
    elapsedSeconds: number(value.elapsedSeconds, 'elapsedSeconds', 0),
    state: choice(value.state, ['countdown', 'running', 'ended'], 'state'), countdownSeconds: number(value.countdownSeconds, 'countdownSeconds', 0),
    players: members.map(entry => byId.get(entry.playerId)),
    trash: ownership(value.trash, new Set(start.course.trash.map(entry => entry.id)), playerIds, 'trash'),
    lifesavers: ownership(value.lifesavers, new Set(start.course.lifesavers.map(entry => entry.id)), playerIds, 'lifesavers'),
    pursuits: list(value.pursuits, 'pursuits').map((entry, index) => {
      const path = `pursuits[${index}]`; object(entry, path);
      if (!playerIds.has(entry.targetPlayerId)) fail(`${path}.targetPlayerId: participante desconocido.`);
      return {
        pursuitId: uniqueId(entry.pursuitId, pursuits, `${path}.pursuitId`), targetPlayerId: entry.targetPlayerId,
        gap: number(entry.gap, `${path}.gap`, 0), retreat: number(entry.retreat, `${path}.retreat`, 0),
      };
    }),
  });
}

/**
 * Validates protocol v1 for the meshes this frontend can display, then buffers two
 * authoritative snapshots. Throws a readable TypeError for an incompatible start.
 * push() instead returns false and exposes error when a snapshot is rejected.
 * Getters are deeply frozen copies of accepted DTOs; input objects are never kept.
 * sample() delays continuous pose values and elapsed time, never ownership,
 * participant states, results or counters.
 * Receive times use the local monotonic clock, independent of the server UTC clock.
 */
export function createNetworkRace({ start: rawStart, selfPlayerId, now = () => performance.now(), interpolationMs = 100 }) {
  const start = sanitizeStart(rawStart, selfPlayerId);
  number(interpolationMs, 'interpolationMs', 0);
  if (typeof now !== 'function') fail('now: falta un reloj local.');
  const members = freeze([start.members.find(entry => entry.playerId === selfPlayerId), ...start.members.filter(entry => entry.playerId !== selfPlayerId)]);
  let latest = null, samples = [], error = null, lastTick = -1, receivedAt = null;
  return {
    get start() { return start; }, get members() { return members; },
    get latest() { return latest; }, get error() { return error; }, get receivedAt() { return receivedAt; },
    push(value, arrivalTime = now()) {
      try {
        number(arrivalTime, 'receivedAt', 0);
        const snapshot = sanitizeSnapshot(value, start, members);
        if (snapshot.tick <= lastTick) fail('tick: estado atrasado o repetido.');
        if (receivedAt !== null && arrivalTime < receivedAt) fail('receivedAt: el reloj local retrocedió.');
        samples.push({ snapshot, receivedAt: arrivalTime }); if (samples.length > 2) samples.shift();
        latest = snapshot; lastTick = snapshot.tick; receivedAt = arrivalTime; error = null; return true;
      } catch (reason) { error = reason instanceof Error ? reason.message : 'Estado de carrera inválido.'; return false; }
    },
    sample(at = now()) {
      number(at, 'sample time', 0);
      if (!latest) return null;
      const output = structuredClone(latest);
      if (samples.length !== 2) return output;
      const [from, to] = samples, duration = to.receivedAt - from.receivedAt;
      const alpha = duration > 0 ? Math.max(0, Math.min(1, (at - interpolationMs - from.receivedAt) / duration)) : 1;
      output.elapsedSeconds = from.snapshot.elapsedSeconds + (to.snapshot.elapsedSeconds - from.snapshot.elapsedSeconds) * alpha;
      for (let index = 0; index < output.players.length; index++) {
        const a = from.snapshot.players[index], b = to.snapshot.players[index];
        // Confirmed terminal actors must already be at their final transform,
        // rather than showing a finished racer airborne or behind the gate.
        // Go keeps moving a reconnecting participant with a neutral intent.
        if (b.state !== 'racing' && b.state !== 'reconnecting') continue;
        for (const field of CONTINUOUS) output.players[index][field] = a[field] + (b[field] - a[field]) * alpha;
      }
      return output;
    },
    // Drop only visual history. Preserve the tick watermark and latest trusted
    // state: delayed packets cannot resurrect the race after a reconnect.
    resetBuffer() { samples = []; },
  };
}
