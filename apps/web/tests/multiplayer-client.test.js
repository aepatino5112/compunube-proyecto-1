import test from 'node:test';
import assert from 'node:assert/strict';
import {createMultiplayerClient} from '../dist/multiplayer-client.js';
import {backendAdapter} from '../dist/backend-config.js';

const equipment = {board: 'coral', outfit: 'costero', net: 'red-base', hair: 'swept', character: 'nico'};
const appearance = {skin: 'medium', hairColor: 'brown'};
const values = {mapId: 'maracaibo', roomId: 'SALA-1', displayName: '  Nico  ', equipment, appearance};
const member = (playerId = 'p1') => ({playerId, displayName: 'Nico', controller: 'human', ready: false,
  connected: true, equipment: {...equipment}, appearance: {...appearance}});
const room = () => ({roomId: 'SALA-1', mapId: 'maracaibo', capacity: 4, rulesVersion: 'rules-1',
  courseVersion: 'course-1', state: 'waiting', members: [member()]});
const start = (raceId = 'race-1') => ({type: 'race.start', protocolVersion: 1, raceId,
  serverTimeMs: 1000, startsAtMs: 4000, rulesVersion: 'rules-1',
  course: {mapId: 'maracaibo',courseVersion:'course-1'}, members: [member()]});
const input = (seq = 0, extra = {}) => ({type: 'race.input', protocolVersion: 1, raceId: 'race-1',
  seq, steer: .5, netSide: -1, boost: true, jumpSeq: 0, ...extra});
function harness(options = {}) {
  let onMessage, onDisconnect, closeCount = 0, unsubscribeCount = 0;
  const sent = [], requests = [];
  const session = {selfPlayerId: 'p1', room: room(),
    send(message) { sent.push(message); return options.send?.(message); },
    subscribe(message, disconnect) { onMessage = message; onDisconnect = disconnect; return () => unsubscribeCount++; },
    close() { closeCount++; }};
  const adapter = Object.fromEntries(['createRoom', 'joinRoom'].map(method => [method, async (request, context) => {
    requests.push({method, request, context}); return options.connect ? options.connect(session, context) : session;
  }]));
  const client = createMultiplayerClient({adapter, callbacks: options.callbacks});
  return {client, session, sent, requests, emit: message => onMessage(message), disconnect: () => onDisconnect(),
    get closed() { return closeCount; }, get unsubscribed() { return unsubscribeCount; }};
}

test('a race cannot start with different room versions or unconfirmed participants',async()=>{
  for(const change of [message=>message.rulesVersion='other',message=>message.course.courseVersion='other',message=>message.members.push(member('unknown')),message=>message.members=[member('unknown')]]){
    let starts=0;const h=harness({callbacks:{onStart(){starts++;}}});await h.client.createRoom(values);
    const message=start();change(message);h.emit(message);
    assert.equal(starts,0);assert.equal(h.client.state.status,'error');assert.equal(h.closed,1);
  }
});

test('unconfigured default never creates a pretend connection and subscribers receive current state immediately', async () => {
  assert.equal(backendAdapter, null);
  const client = createMultiplayerClient(), states = [];
  const unsubscribe = client.subscribe(value => states.push(value));
  assert.equal(states.length, 1); assert.equal(states[0].status, 'unconfigured');
  assert.equal(await client.createRoom(values), false);
  assert.equal(await client.joinRoom(values), false);
  assert.equal(client.state.status, 'unconfigured');
  assert.equal(client.state.error.code, 'NOT_CONFIGURED');
  assert.equal(client.sendInput(input()), false); assert.equal(client.setReady(true), false);
  unsubscribe(); client.leave(); assert.equal(states.length, 3);
  client.dispose();
});

test('adapter confirms room, ready state remains server-authoritative, leave unsubscribes and closes exactly once', async () => {
  const h = harness(), statuses = [];
  h.client.subscribe(value => statuses.push(value.status));
  assert.equal(await h.client.createRoom({...values, x: 600}), true);
  assert.deepEqual(statuses, ['idle', 'connecting', 'room']);
  assert.equal(h.requests[0].method, 'createRoom');
  assert.deepEqual(Object.keys(h.requests[0].request).sort(), ['appearance', 'displayName', 'equipment', 'mapId', 'requestId']);
  assert.equal(h.requests[0].request.displayName, 'Nico');
  assert.equal(typeof h.requests[0].request.requestId, 'string');
  assert.ok(h.requests[0].context.signal instanceof AbortSignal);
  assert.equal(h.client.setReady(true), true);
  assert.deepEqual(h.sent[0], {type: 'room.ready', protocolVersion: 1, roomId: 'SALA-1', ready: true});
  assert.equal(h.client.state.room.members[0].ready, false);
  const updated = room(); updated.members[0].ready = true;
  h.emit({type: 'room.state', protocolVersion: 1, selfPlayerId: 'p1', room: updated});
  assert.equal(h.client.state.room.members[0].ready, true);
  updated.members[0].ready = false;
  assert.equal(h.client.state.room.members[0].ready, true);
  assert.throws(() => { h.client.state.room.members[0].ready = false; }, TypeError);
  assert.equal(h.client.leave(), true);
  assert.deepEqual(h.sent[1], {type: 'room.leave', protocolVersion: 1, roomId: 'SALA-1'});
  assert.equal(h.closed, 1); assert.equal(h.unsubscribed, 1);
  assert.equal(h.client.state.status, 'idle'); assert.equal(h.client.state.room, null);
  h.client.leave(); h.client.dispose(); assert.equal(h.closed, 1); assert.equal(h.unsubscribed, 1);
});

test('race callbacks and inputs are confined to the confirmed race, with no outgoing positions', async () => {
  const calls = {starts: [], snapshots: [], events: [], results: [], profiles: []};
  const h = harness({callbacks: {onStart: value => calls.starts.push(value), onSnapshot: value => calls.snapshots.push(value),
    onEvent: value => calls.events.push(value), onResult: value => calls.results.push(value), onProfile: value => calls.profiles.push(value)}});
  await h.client.joinRoom(values);
  assert.equal(h.requests[0].method, 'joinRoom');
  assert.equal(h.requests[0].request.roomId, 'SALA-1');
  assert.equal(h.client.sendInput(input()), false);
  h.emit(start()); h.emit(start());
  assert.equal(calls.starts.length, 1); assert.equal(calls.starts[0].selfPlayerId, 'p1');
  assert.equal(h.client.state.status, 'racing'); assert.equal(h.client.setReady(true), false);
  assert.equal(h.client.sendInput(input(0, {x: 999, z: -900, lives: 100, score: 90})), true);
  assert.deepEqual(Object.keys(h.sent[0]).sort(), ['boost', 'jumpSeq', 'netSide', 'protocolVersion', 'raceId', 'seq', 'steer', 'type']);
  for (const bad of [input(0), input(-1), input(2, {raceId: 'other'}), input(2, {seq: NaN}), input(2, {steer: Infinity}),
    input(2, {steer: 1.01}), input(2, {jumpSeq: -1}), input(2, {netSide: 0}), input(2, {boost: 1})]) {
    assert.equal(h.client.sendInput(bad), false);
  }
  assert.equal(h.client.sendInput(input(1, {jumpSeq: 2})), true);
  assert.equal(h.client.sendInput(input(2, {jumpSeq: 1})), false);
  assert.equal(h.client.sendInput(input(3, {jumpSeq: 2})), true);
  for (const raceId of ['old-race', 'race-1']) {
    h.emit({type: 'race.snapshot', protocolVersion: 1, snapshot: {raceId, tick: 1}});
    h.emit({type: 'race.event', protocolVersion: 1, event: {raceId, eventId: 'event-1'}});
  }
  assert.equal(calls.snapshots.length, 1); assert.equal(calls.events.length, 1);
  h.emit({type: 'race.ended', protocolVersion: 1, result: {raceId: 'old-race'}});
  assert.equal(h.client.state.status, 'racing');
  for (const [playerId, profileRevision] of [['other', 1], ['p1', 2], ['p1', 1], ['p1', 2], ['p1', 3]]) {
    h.emit({type: 'profile.updated', protocolVersion: 1, data: {playerId, profileRevision}});
  }
  assert.deepEqual(calls.profiles.map(value => value.profileRevision), [2, 3]);
  h.emit({type: 'race.ended', protocolVersion: 1, result: {raceId: 'race-1', participants: []}});
  assert.equal(calls.results.length, 1); assert.equal(h.client.state.room.state, 'ended');
  assert.equal(h.client.state.status, 'room'); assert.equal(h.client.sendInput(input(4)), false);
  h.emit({type: 'race.snapshot', protocolVersion: 1, snapshot: {raceId: 'race-1'}});
  assert.equal(calls.snapshots.length, 1);
  h.client.dispose();
});

test('invalid room identities, membership, map and protocol cannot become a connected room', async () => {
  for (const mutate of [
    value => { value.members.push(member()); },
    value => { value.members = []; },
    value => { value.members = ['a', 'b', 'c', 'd', 'e'].map(member); },
    value => { value.members = [member('stranger')]; },
    value => { value.mapId = 'unknown'; },
    value => { value.mapId = 'orinoco'; },
    value => { value.capacity = 8; },
    value => { value.members[0].equipment.board = 'unknown'; },
  ]) {
    const h = harness(); mutate(h.session.room);
    assert.equal(await h.client.createRoom(values), false);
    assert.equal(h.client.state.status, 'error'); assert.equal(h.client.state.error.code, 'INVALID_RESPONSE');
    assert.equal(h.closed, 1); h.client.dispose();
  }
  const h = harness(); h.session.room.roomId = 'another-room';
  assert.equal(await h.client.joinRoom(values), false); assert.equal(h.closed, 1);
  const active = harness(); await active.client.joinRoom(values);
  active.emit({type: 'room.state', protocolVersion: 2});
  assert.equal(active.client.state.error.code, 'INCOMPATIBLE_VERSION'); assert.equal(active.closed, 1);
});

test('profile validation rejection does not poison revisions and equal revision acknowledgements still arrive',async()=>{
  const calls=[];
  const h=harness({callbacks:{onProfile(data){calls.push(data);return data.valid===true;}}});await h.client.createRoom(values);
  const send=data=>h.emit({type:'profile.updated',protocolVersion:1,data:{playerId:'p1',...data}});
  send({profileRevision:999,valid:false});send({profileRevision:2,valid:true});
  send({profileRevision:2,requestId:'pending-op',valid:true});send({profileRevision:1,requestId:'old-op',valid:true});
  assert.deepEqual(calls.map(value=>[value.profileRevision,value.requestId]),[[999,undefined],[2,undefined],[2,'pending-op']]);
  h.client.dispose();
});

test('leave during connection aborts and closes a late response without reviving the room', async () => {
  let resolve;
  const h = harness({connect: session => new Promise(done => { resolve = () => done(session); })});
  const pending = h.client.createRoom(values);
  assert.equal(h.client.state.status, 'connecting');
  h.client.leave(); assert.equal(h.requests[0].context.signal.aborted, true);
  resolve(); assert.equal(await pending, false);
  assert.equal(h.client.state.status, 'idle'); assert.equal(h.client.state.room, null);
  assert.equal(h.closed, 1); assert.equal(h.unsubscribed, 0);
});

test('disconnect and callbacks from an abandoned session never restart a race or send input', async () => {
  let starts = 0;
  const h = harness({callbacks: {onStart: () => starts++}});
  await h.client.createRoom(values); h.emit(start()); h.disconnect();
  assert.equal(h.client.state.status, 'disconnected'); assert.equal(h.client.state.error.code, 'DISCONNECTED');
  assert.equal(h.client.sendInput(input()), false); assert.equal(h.client.setReady(true), false);
  h.emit(start('race-2')); h.emit({type: 'error', protocolVersion: 1, error: {code: 'ROOM_FULL'}});
  assert.equal(h.client.state.status, 'disconnected'); assert.equal(starts, 1);
  assert.equal(h.closed, 1); assert.equal(h.unsubscribed, 1);
  h.client.leave(); assert.equal(h.client.state.status, 'idle');
});

test('ordinary server errors are translated without manufacturing a room or trusting exception text', async () => {
  const denied = harness({connect: () => { throw {code: 'ROOM_FULL', message: '<script>private transport stack</script>'}; }});
  assert.equal(await denied.client.joinRoom(values), false);
  assert.equal(denied.client.state.status, 'error');
  assert.equal(denied.client.state.error.message, 'La sala ya tiene cuatro participantes.');
  const h = harness(); await h.client.joinRoom(values);
  h.emit({type: 'error', protocolVersion: 1, error: {code: 'INVALID_ACTION', message: 'internal stack'}});
  assert.equal(h.client.state.status, 'room'); assert.equal(h.client.state.error.code, 'INVALID_ACTION');
  h.emit({type: 'error', protocolVersion: 1, error: {code: 'toString'}});
  assert.equal(h.client.state.error.code, 'INVALID_ACTION');
  h.emit({type: 'error', protocolVersion: 1, error: {code: 'SESSION_REQUIRED'}});
  assert.equal(h.client.state.status, 'error'); assert.equal(h.client.state.room, null); assert.equal(h.closed, 1);
});

test('callback rejection and transport failure close safely; disposal cancels and suppresses callbacks', async () => {
  const rejected = harness({callbacks: {onStart: () => false}});
  await rejected.client.createRoom(values); rejected.emit(start());
  assert.equal(rejected.client.state.error.code, 'INVALID_RESPONSE'); assert.equal(rejected.closed, 1);
  const broken = harness({callbacks: {onSnapshot: () => { throw Error('render failed'); }}});
  await broken.client.createRoom(values); broken.emit(start());
  assert.doesNotThrow(() => broken.emit({type: 'race.snapshot', protocolVersion: 1, snapshot: {raceId: 'race-1'}}));
  assert.equal(broken.client.state.error.code, 'CLIENT_CALLBACK'); assert.equal(broken.closed, 1);
  const asyncBroken = harness({callbacks: {onEvent: async () => { throw Error('async failed'); }}});
  await asyncBroken.client.createRoom(values); asyncBroken.emit(start());
  asyncBroken.emit({type: 'race.event', protocolVersion: 1, event: {raceId: 'race-1'}});
  await Promise.resolve(); assert.equal(asyncBroken.client.state.error.code, 'CLIENT_CALLBACK');
  const failedSend = harness({send: () => { throw Error('offline'); }});
  await failedSend.client.createRoom(values); assert.equal(failedSend.client.setReady(true), false);
  assert.equal(failedSend.client.state.status, 'error'); assert.equal(failedSend.closed, 1);
  let calls = 0;
  const disposed = harness({callbacks: {onStart: () => calls++}});
  await disposed.client.createRoom(values); disposed.client.dispose(); disposed.emit(start()); disposed.disconnect();
  assert.equal(calls, 0); assert.equal(disposed.closed, 1); assert.equal(disposed.unsubscribed, 1);
  assert.equal(await disposed.client.createRoom(values), false); assert.equal(disposed.client.leave(), false);
  let lateResolve;
  const cancelled = harness({connect: session => new Promise(resolve => { lateResolve = () => resolve(session); })});
  const pending = cancelled.client.createRoom(values); cancelled.client.dispose();
  assert.equal(cancelled.requests[0].context.signal.aborted, true);
  lateResolve(); assert.equal(await pending, false); assert.equal(cancelled.closed, 1);
  let cleanup = 0;
  const synchronous = harness({callbacks: {onStart: () => false}});
  synchronous.session.subscribe = message => { message(start()); return () => cleanup++; };
  assert.equal(await synchronous.client.createRoom(values), false);
  assert.equal(synchronous.closed, 1); assert.equal(cleanup, 1);
});

test('malformed requests never reach the adapter and listener errors do not escape into local UI', async () => {
  const h = harness();
  for (const invalid of [{...values, displayName: ''}, {...values, mapId: 'fake'}, {...values, equipment: {}},
    {...values, appearance: {skin: 'blue'}}, {...values, displayName: 'x'.repeat(25)}]) {
    assert.equal(await h.client.createRoom(invalid), false);
  }
  assert.equal(h.requests.length, 0);
  assert.doesNotThrow(() => h.client.subscribe(() => { throw Error('broken view'); }));
  assert.equal(h.client.state.error.code, 'CLIENT_CALLBACK');
  assert.equal(await h.client.createRoom(values), true);
  assert.equal(await h.client.joinRoom(values), false); assert.equal(h.requests.length, 1);
  h.client.dispose();
});
