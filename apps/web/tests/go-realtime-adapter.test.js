import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createGoHttp } from '../dist/net/http.js';
import { createRoomsAdapter, SUBPROTOCOL } from '../dist/net/realtime.js';
import * as translate from '../dist/net/translate.js';
import { createNetworkRace } from '../dist/network-race.js';
import { createMultiplayerClient } from '../dist/multiplayer-client.js';

const manifest = JSON.parse(await readFile(new URL('../dist/courses/maracaibo-surf-mvp-3.json', import.meta.url)));
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

const EQUIP = { boardId: 'coral', outfitId: 'costero', netId: 'red-base', hairId: 'swept', characterId: 'luna' };
const LOOK = { skinId: 'light', hairColorId: 'blonde' };
const NONE = { boardId: '', outfitId: '', netId: '', hairId: '', characterId: '' };
function member(playerId, extra = {}) {
  return { playerId, displayName: '', connected: true, ready: false, participantState: 'not_ready', profileRevision: 0,
    reduceChoice: null, equipment: NONE, appearance: { skinId: '', hairColorId: '' }, ...extra };
}
function prepared(playerId, extra = {}) {
  return member(playerId, { displayName: playerId, ready: true, participantState: 'ready', profileRevision: 4,
    reduceChoice: 'reusable', equipment: EQUIP, appearance: LOOK, ...extra });
}
function roomState(state = 'LOBBY', members = [member('p1')], extra = {}) {
  return { type: 'room.state', protocolVersion: 1, selfPlayerId: 'p1', room: {
    roomId: 'room-1', mapId: 'maracaibo', capacity: 4, state, rulesVersion: 'surf-mvp-3',
    courseVersion: 'maracaibo-surf-mvp-3', raceId: state === 'LOBBY' ? null : 'race-1', countdownEndsAtMs: null, members, ...extra } };
}
const raceStart = (ids = ['p1', 'p2']) => ({ type: 'race.start', protocolVersion: 1, roomId: 'room-1', raceId: 'race-1',
  serverTimeMs: 1000, startedAtMs: 1000, rulesVersion: 'surf-mvp-3', course: manifest,
  roster: ids.map((playerId, i) => ({ playerId, startSlotX: manifest.startSlotsX[i], equipment: EQUIP, appearance: LOOK, reduceChoice: 'reusable' })) });
function snapshot(tick = 2, ids = ['p1', 'p2'], extra = {}) {
  return { raceId: 'race-1', tick, serverTimeMs: 1000 + tick * 50, elapsedMs: tick * 50,
    players: ids.map(playerId => ({ playerId, participantState: 'racing', x: 0, z: -tick, speed: 16.4, steer: 0, netSide: 1,
      netAngle: 0, energy: 0, boosting: false, jumpHeight: 0, jumpVelocity: 0, lives: 3, protectionRemainingMs: 2000,
      collectedPlastic: 1, collectedMetal: 0, finishTimeMs: null, lastProcessedInputSeq: 9, lastProcessedJumpSeq: 2, ...extra })),
    trash: manifest.trash.map((item, i) => ({ itemId: item.itemId, collectedBy: i === 0 ? 'p1' : null })),
    lifesavers: manifest.lifesavers.map(item => ({ itemId: item.itemId, collectedBy: null })),
    pursuits: ids.map(id => ({ targetPlayerId: id, gap: 48, retreatRemainingMs: 0 })) };
}
const ended = settlementState => ({ type: 'race.ended', protocolVersion: 1, result: { raceId: 'race-1', roomId: 'room-1',
  rulesVersion: 'surf-mvp-3', courseVersion: 'maracaibo-surf-mvp-3', endedAtMs: 9000, participants: [
    { playerId: 'p1', outcome: 'finished', rank: 1, finishTimeMs: 55000, collected: { plastic: 1, metal: 0 }, credited: { plastic: 1, metal: 0 }, reduceChoice: 'reusable', settlementState },
    { playerId: 'p2', outcome: 'dnf', rank: null, finishTimeMs: null, collected: { plastic: 0, metal: 0 }, credited: { plastic: 0, metal: 0 }, reduceChoice: 'disposable', settlementState: 'confirmed' }] } });

class FakeSocket extends EventTarget {
  constructor(url, protocols, { protocol = protocols[0], fail = false } = {}) {
    super(); this.url = url; this.protocols = protocols; this.protocol = protocol; this.readyState = 0; this.sent = [];
    setTimeout(() => {
      if (fail) { this.readyState = 3; this.dispatchEvent(new Event('error')); this.dispatchEvent(new Event('close')); return; }
      this.readyState = 1; this.dispatchEvent(new Event('open'));
    }, 0);
  }
  send(data) { this.sent.push(JSON.parse(data)); }
  receive(message) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message) })); }
  close() { if (this.readyState === 3) return; this.readyState = 3; this.dispatchEvent(new Event('close')); }
}
function harness({ routes = {}, sockets = [], plan = [], options = {} } = {}) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push(`${init.method} ${url}`);
    const next = routes[`${init.method} ${url}`]?.shift();
    if (!next) throw new TypeError(`unexpected ${init.method} ${url}`);
    return json(...next);
  };
  const http = createGoHttp({ fetch });
  const createSocket = (url, protocols) => { const socket = new FakeSocket(url, protocols, plan.shift() ?? {}); sockets.push(socket); return socket; };
  const adapter = createRoomsAdapter(http, { url: 'ws://page/v1/realtime', createSocket, ...options });
  return { adapter, calls, sockets };
}
const session = () => ({ 'GET /v1/sessions/current': [[200, { playerId: 'p1' }]] });

test('translations of real Go manifests pass the presentation validators', () => {
  const room = roomState('RACING', [prepared('p1'), prepared('p2', { equipment: { ...EQUIP, characterId: 'samuel' } })]).room;
  const start = translate.raceStart(raceStart(), room);
  assert.equal(start.course.lengthMeters, 1800);
  assert.deepEqual([...new Set(start.course.trash.map(item => item.kind))].sort(), [0, 1, 2]);
  assert.deepEqual(start.members.map(m => m.displayName), ['Luna', 'Luna'], 'opaque playerId is never shown as a name');
  const race = createNetworkRace({ start, selfPlayerId: 'p1', now: () => 0 });
  assert.equal(race.push(translate.raceSnapshot(snapshot(2)), 10), true, race.error);
  const self = race.latest.players.find(p => p.playerId === 'p1');
  assert.equal(self.protection, 2); assert.ok(Math.abs(self.hit - 0.55) < 1e-9);
  assert.equal(race.latest.trash[0].collectedBy, 'p1');
  assert.equal(race.push(translate.raceSnapshot(snapshot(4, ['p1', 'p2'], { participantState: 'reconnecting' })), 20), true, race.error);
  assert.equal(race.push(translate.raceSnapshot(snapshot(6, ['p1', 'p2'], { participantState: 'dnf' })), 30), true, race.error);
  assert.deepEqual(translate.raceEvent({ kind: 'lifesaver.collected', eventId: 'e', raceId: 'race-1', tick: 1, itemId: 'l-001', playerId: 'p1', lives: 3 }).kind, 'life.collected');
  assert.equal(translate.raceEvent({ kind: 'player.finished', eventId: 'f', raceId: 'race-1', tick: 9, playerId: 'p1', finishTimeMs: 55000 }).finishTimeSeconds, 55);
  const unprepared = translate.roomState(roomState('LOBBY', [member('p1')]).room);
  assert.equal(unprepared.state, 'waiting'); assert.equal(unprepared.members[0].equipment, null);
  assert.equal(translate.roomState(roomState('CLOSED').room), null);
});

test('createRoom confirms over E45, opens the subprotocol and resolves on the first room.state', async () => {
  const h = harness({ routes: { ...session(), 'POST /v1/rooms': [[201, { roomId: 'room-1', mapId: 'maracaibo', state: 'LOBBY', playerId: 'p1' }]] } });
  const pending = h.adapter.createRoom({ mapId: 'maracaibo' });
  await tick(); await tick(); await tick();
  assert.deepEqual(h.sockets[0].protocols, [SUBPROTOCOL]);
  h.sockets[0].receive(roomState());
  const s = await pending;
  assert.equal(s.selfPlayerId, 'p1'); assert.equal(s.room.roomId, 'room-1'); assert.equal(s.room.state, 'waiting');
  const received = [];
  s.subscribe(message => received.push(message), () => {});
  assert.equal(received[0].type, 'room.state', 'buffered state is replayed on subscribe');
  assert.equal(s.send({ type: 'room.leave', protocolVersion: 1, roomId: 'room-1' }), true);
  assert.deepEqual(h.sockets[0].sent, [{ type: 'room.leave', protocolVersion: 1, roomId: 'room-1' }]);
  s.close();
});

test('a server without the subprotocol is an incompatible version', async () => {
  const h = harness({ routes: { ...session(), 'POST /v1/rooms/r%2F1/memberships': [[200, { roomId: 'r/1', mapId: 'orinoco', state: 'LOBBY', playerId: 'p1' }]] }, plan: [{ protocol: '' }] });
  await assert.rejects(h.adapter.joinRoom({ roomId: 'r/1' }), { code: 'INCOMPATIBLE_VERSION' });
});

test('a dropped channel reconnects inside the window and recovers room.state and the snapshot', async () => {
  const h = harness({ routes: { ...session(), 'POST /v1/rooms': [[201, { roomId: 'room-1', mapId: 'maracaibo', state: 'LOBBY', playerId: 'p1' }]] },
    plan: [{}, { fail: true }, {}], options: { reentryWindowMs: 2000, stateTimeoutMs: 500 } });
  const pending = h.adapter.createRoom({ mapId: 'maracaibo' });
  await tick(); await tick(); await tick();
  h.sockets[0].receive(roomState('RACING', [prepared('p1'), prepared('p2')]));
  const s = await pending, statuses = [], received = [];
  let lost = null;
  s.subscribe(message => received.push(message.type), code => { lost = code; }, status => statuses.push(status));
  h.sockets[0].close();
  assert.deepEqual(statuses, ['reconnecting']);
  assert.equal(s.send({ type: 'race.input' }), undefined, 'intents are dropped, not faked, while reopening');
  await wait(400);
  assert.equal(h.sockets.length, 3); assert.deepEqual(statuses, ['reconnecting', 'live']);
  h.sockets[2].receive(roomState('RACING', [prepared('p1', { participantState: 'racing' }), prepared('p2')]));
  h.sockets[2].receive({ type: 'race.snapshot', protocolVersion: 1, snapshot: snapshot(40) });
  assert.deepEqual(received, ['room.state', 'room.state', 'race.snapshot']);
  await wait(600);
  assert.equal(lost, null, 'room.state arrived before the state timeout');
  s.close();
});

test('the reentry window expiring, a closed room or a lost membership end the session with a reason', async () => {
  for (const [scenario, expected] of [['expire', 'DISCONNECTED'], ['closed', 'ROOM_CLOSED'], ['silent', 'NOT_A_MEMBER']]) {
    const h = harness({ routes: { ...session(), 'POST /v1/rooms': [[201, { roomId: 'room-1', mapId: 'maracaibo', state: 'LOBBY', playerId: 'p1' }]] },
      plan: scenario === 'expire' ? [{}, { fail: true }, { fail: true }, { fail: true }, { fail: true }] : [{}, {}],
      options: { reentryWindowMs: 300, stateTimeoutMs: 100 } });
    const pending = h.adapter.createRoom({ mapId: 'maracaibo' });
    await tick(); await tick(); await tick();
    h.sockets[0].receive(roomState());
    const s = await pending;
    let lost = null;
    s.subscribe(() => {}, code => { lost = code; });
    if (scenario === 'closed') h.sockets[0].receive(roomState('CLOSED'));
    else h.sockets[0].close();
    await wait(scenario === 'expire' ? 900 : 300);
    assert.equal(lost, expected, scenario);
  }
});

test('resume without a session does not create one, and a racing room is rebuilt from the versioned manifest', async () => {
  const none = harness({ routes: { 'GET /v1/sessions/current': [[401, { code: 'SESSION_REQUIRED', message: 'x' }]] } });
  assert.equal(await none.adapter.resume(), null);
  assert.equal(none.sockets.length, 0); assert.deepEqual(none.calls, ['GET /v1/sessions/current']);

  const h = harness({ routes: session(), options: { loadManifest: async version => { assert.equal(version, 'maracaibo-surf-mvp-3'); return manifest; } } });
  const pending = h.adapter.resume();
  await tick(); await tick(); await tick();
  h.sockets[0].receive(roomState('RACING', [prepared('p1', { participantState: 'racing' }), prepared('p2', { participantState: 'racing' })]));
  h.sockets[0].receive({ type: 'race.snapshot', protocolVersion: 1, snapshot: snapshot(300) });
  const s = await pending;
  const received = [];
  s.subscribe(message => received.push(message), () => {});
  assert.deepEqual(received.map(m => m.type), ['room.state', 'race.start', 'race.snapshot']);
  const race = createNetworkRace({ start: received[1], selfPlayerId: 'p1', now: () => 0 });
  assert.equal(race.push(received[2].snapshot, 1), true, race.error);
  s.close();
});

test('through multiplayer-client: ready carries the verified revision, results and a later settlement confirmation', async () => {
  const h = harness({ routes: { ...session(), 'POST /v1/rooms': [[201, { roomId: 'room-1', mapId: 'maracaibo', state: 'LOBBY', playerId: 'p1' }]] } });
  const calls = { start: 0, results: 0, settlements: [] };
  const client = createMultiplayerClient({ adapter: h.adapter, callbacks: {
    onStart: () => { calls.start++; return true; }, onResult: () => { calls.results++; }, onSettlement: result => calls.settlements.push(result.raceId) } });
  const values = { mapId: 'maracaibo', displayName: 'Luna', equipment: { board: 'coral', outfit: 'costero', net: 'red-base', hair: 'swept', character: 'luna' }, appearance: { skin: 'light', hairColor: 'blonde' } };
  const created = client.createRoom(values);
  await tick(); await tick(); await tick(); await tick();
  h.sockets[0].receive(roomState('LOBBY', [member('p1'), member('p2')]));
  assert.equal(await created, true);
  assert.equal(client.setReady(true, { profileRevision: 4, reduceChoice: 'reusable' }), true);
  assert.deepEqual(h.sockets[0].sent.at(-1), { type: 'room.ready', protocolVersion: 1, roomId: 'room-1', ready: true, profileRevision: 4, reduceChoice: 'reusable' });
  assert.equal(client.state.room.members[0].ready, false, 'readiness waits for Go');
  h.sockets[0].receive(roomState('COUNTDOWN', [prepared('p1'), prepared('p2')]));
  h.sockets[0].receive(raceStart());
  assert.equal(client.state.status, 'racing'); assert.equal(calls.start, 1);
  h.sockets[0].close();
  assert.equal(client.state.status, 'reconnecting');
  assert.equal(client.sendInput({ type: 'race.input', protocolVersion: 1, raceId: 'race-1', seq: 1, steer: 0, netSide: 1, boost: false, jumpSeq: 0 }), false);
  await wait(300);
  h.sockets.at(-1).receive(roomState('RACING', [prepared('p1', { participantState: 'racing' }), prepared('p2')]));
  assert.equal(client.state.status, 'racing');
  h.sockets.at(-1).receive(ended('pending'));
  assert.equal(client.state.status, 'room'); assert.equal(calls.results, 1);
  assert.deepEqual(client.state.result, { raceId: 'race-1', outcome: 'finished', rank: 1, credited: { plastic: 1, metal: 0 }, reduceChoice: 'reusable', settlementState: 'pending' });
  h.sockets.at(-1).receive(ended('confirmed'));
  h.sockets.at(-1).receive(ended('confirmed'));
  assert.equal(client.state.result.settlementState, 'confirmed');
  assert.deepEqual(calls.settlements, ['race-1'], 'confirmation is reported once and nothing is credited locally');
  client.detach();
  assert.equal(h.sockets.at(-1).sent.some(m => m.type === 'room.leave'), false, 'unloading keeps the membership for reentry');
});
