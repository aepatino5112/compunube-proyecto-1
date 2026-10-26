// G59/G61 integration: two web clients (separate cookie jars) use the compiled
// adapters and multiplayer-client against the real Go Match Service through
// server.mjs. Requires COMPUNUBE_GO_URL and a running stack.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { createGoBackend } from '../dist/net/backend.js';
import { createOnlineProfileStore } from '../dist/online-profile.js';
import { createMultiplayerClient } from '../dist/multiplayer-client.js';
import { createNetworkRace } from '../dist/network-race.js';

const GO = process.env.COMPUNUBE_GO_URL;
if (!GO) throw new Error('COMPUNUBE_GO_URL is required for integration tests (no silent skip)');
const serverFile = fileURLToPath(new URL('../server.mjs', import.meta.url));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function startWeb() {
  const port = await new Promise(resolve => {
    const probe = net.createServer().listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
  });
  const child = spawn(process.execPath, [serverFile], { env: { ...process.env, COMPUNUBE_WEB_PORT: String(port) }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((resolve, reject) => { child.stdout.once('data', resolve); child.once('exit', reject); });
  return { origin: `http://127.0.0.1:${port}`, stop: () => child.kill() };
}

/** One browser page: shared cookie jar, same-origin Origin header, sockets it opened. */
function browser(origin, name, jar = { cookie: null }) {
  const sockets = [];
  const fetchLike = async (path, init) => {
    const headers = { ...init.headers };
    if (jar.cookie) headers.Cookie = jar.cookie;
    if (!['GET', 'HEAD'].includes(init.method)) headers.Origin = origin;
    const response = await fetch(origin + path, { ...init, headers });
    const set = response.headers.get('set-cookie');
    if (set) jar.cookie = set.split(';')[0];
    return response;
  };
  const backend = createGoBackend({ fetch: fetchLike, realtime: {
    url: origin.replace('http', 'ws') + '/v1/realtime',
    createSocket: (url, protocols) => {
      const socket = new WebSocket(url, { protocols, headers: { Cookie: jar.cookie, Origin: origin } });
      sockets.push(socket); return socket;
    },
  } });
  const profile = createOnlineProfileStore({ adapter: backend.profileAdapter });
  const seen = { starts: [], snapshots: [], events: [], results: [], settlements: [], statuses: [] };
  let race = null;
  const client = createMultiplayerClient({ adapter: backend.backendAdapter, callbacks: {
    onStart(data) {
      race = createNetworkRace({ start: data.start, selfPlayerId: data.selfPlayerId });
      seen.starts.push(data.start); return true;
    },
    onSnapshot(snapshot) { assert.equal(race.push(snapshot), true, `${name}: ${race.error}`); seen.snapshots.push(snapshot); },
    onEvent(event) { seen.events.push(event); },
    onResult(result) { seen.results.push(result); },
    onSettlement(result) { seen.settlements.push(result); },
    onConnection(status) { seen.statuses.push(status); },
  } });
  return { name, jar, backend, profile, client, seen, sockets, get race() { return race; }, get cookie() { return jar.cookie; } };
}

async function until(label, predicate, ms = 20000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) { if (predicate()) return; await wait(50); }
  throw new Error(`timeout: ${label}`);
}

test('two web clients race on Go: E43 flow, reentry with monotonic inputs, leave and settlement', async t => {
  const web = await startWeb();
  t.after(web.stop);
  const host = browser(web.origin, 'host'), guest = browser(web.origin, 'guest');
  for (const b of [host, guest]) assert.equal(await b.profile.load(), true, JSON.stringify(b.profile.state.error));
  const equipment = { board: 'coral', outfit: 'costero', net: 'red-base', hair: 'swept', character: 'nico' };
  const appearance = { skin: 'medium', hairColor: 'brown' };

  // The WebSocket rejects a cookie handshake from a foreign Origin.
  await new Promise(resolve => {
    const socket = new WebSocket(web.origin.replace('http', 'ws') + '/v1/realtime', { protocols: ['compunube.realtime.v1'], headers: { Cookie: host.cookie, Origin: 'http://evil.example' } });
    socket.onopen = () => assert.fail('foreign Origin handshake accepted');
    socket.onerror = () => resolve();
  });

  assert.equal(await host.client.createRoom({ mapId: 'orinoco', displayName: 'Nico', equipment, appearance }), true, JSON.stringify(host.client.state.error));
  const roomId = host.client.state.room.roomId;
  assert.equal(await guest.client.joinRoom({ roomId, displayName: 'Nico', equipment, appearance }), true, JSON.stringify(guest.client.state.error));
  await until('host sees two members', () => host.client.state.room?.members.length === 2);
  assert.equal(host.client.state.selfPlayerId, host.profile.state.playerId, 'Go derives the same identity for profile and room');

  // A stale revision is rejected by Go; the verified revision is accepted.
  assert.equal(host.client.setReady(true, { profileRevision: host.profile.state.profileRevision + 50, reduceChoice: 'reusable' }), true);
  await until('stale revision rejected', () => !!host.client.state.error);
  assert.match(host.client.state.error.code, /INVALID_READY|PROFILE_STALE/);
  for (const [b, choice] of [[host, 'reusable'], [guest, 'disposable']]) {
    assert.equal(b.client.setReady(true, { profileRevision: b.profile.state.profileRevision, reduceChoice: choice }), true);
  }
  await until('both clients racing', () => host.client.state.status === 'racing' && guest.client.state.status === 'racing', 15000);
  assert.equal(host.seen.starts[0].course.mapId, 'orinoco');
  assert.equal(host.seen.starts[0].course.trash.length, 103);
  await until('snapshots flowing', () => host.seen.snapshots.length > 5 && guest.seen.snapshots.length > 5);

  // Inputs with strictly increasing seq; Go reports what it processed.
  const raceId = host.seen.starts[0].raceId;
  let seq = 0, jumpSeq = 0;
  const send = (b, extra = {}) => b.client.sendInput({ type: 'race.input', protocolVersion: 1, raceId, seq: ++seq, steer: 0, netSide: 1, boost: false, jumpSeq, ...extra });
  for (let i = 0; i < 5; i++) { assert.equal(send(host, i === 2 ? { jumpSeq: ++jumpSeq } : {}), true); await wait(60); }
  await until('Go processed host inputs', () => host.race.latest.players.find(p => p.playerId === host.client.state.selfPlayerId).lastProcessedInputSeq >= 5);

  // Reentry: drop the host's socket mid-race; the adapter reopens it inside the window.
  host.sockets.at(-1).close();
  await until('host reconnecting', () => host.seen.statuses.includes('reconnecting'));
  await until('host racing again', () => host.client.state.status === 'racing' && host.sockets.length >= 2, 15000);
  const before = host.seen.snapshots.length;
  await until('fresh snapshot after reentry', () => host.seen.snapshots.length > before);
  const self = host.race.latest.players.find(p => p.playerId === host.client.state.selfPlayerId);
  assert.ok(self.lastProcessedInputSeq >= 5, 'Go kept the processed sequence across reentry');
  assert.equal(host.client.sendInput({ type: 'race.input', protocolVersion: 1, raceId, seq: self.lastProcessedInputSeq, steer: 0, netSide: 1, boost: false, jumpSeq }), false,
    'a sequence Go already processed is never sent again');
  assert.equal(send(host), true);

  // Reload (G61): the guest page unloads without room.leave; a new page with the
  // same session cookie resumes the race from room.state, a full snapshot and
  // the versioned course manifest, loading the online profile first.
  guest.client.detach();
  const reloaded = browser(web.origin, 'guest-reloaded', guest.jar);
  const resumedAt = Date.now();
  assert.equal(await reloaded.client.resume(async playerId =>
    (await reloaded.profile.load()) && reloaded.profile.state.playerId === playerId), true);
  await until('reloaded guest racing with the current snapshot', () => reloaded.client.state.status === 'racing' && reloaded.race?.latest);
  console.log(`  guest resumed the race ${Date.now() - resumedAt} ms after reload`);
  const guestId = guest.profile.state.playerId;
  assert.equal(reloaded.client.state.selfPlayerId, guestId, 'same identity after reload');
  assert.equal(reloaded.race.start.raceId, raceId);
  assert.equal(reloaded.race.start.course.trash.length, 103, 'course rebuilt from the versioned manifest');
  assert.ok(['racing', 'reconnecting'].includes(reloaded.race.latest.players.find(p => p.playerId === guestId).state),
    'the participation survived the reload inside the reentry window');
  const owned = race => new Map(race.latest.trash.map(item => [item.itemId, item.collectedBy]));
  await until('both pages agree on pickup ownership', () => {
    const a = owned(host.race), b = owned(reloaded.race);
    return [...a].every(([id, owner]) => b.get(id) === owner);
  }, 5000);

  // The guest leaves voluntarily: Go marks the participant left and the race continues.
  reloaded.client.leave();
  await until('race ended for host', () => host.seen.results.length === 1, 120000);
  const result = host.seen.results[0];
  const byId = Object.fromEntries(result.participants.map(p => [p.playerId, p]));
  assert.equal(byId[guestId].outcome, 'left');
  assert.deepEqual(byId[guestId].credited, { plastic: 0, metal: 0 });
  assert.equal(byId[guestId].rank, null);
  const mine = byId[host.client.state.selfPlayerId];
  assert.ok(['finished', 'disqualified', 'dnf'].includes(mine.outcome));
  if (mine.outcome !== 'finished') assert.deepEqual(mine.credited, { plastic: 0, metal: 0 });
  assert.equal(host.client.state.status, 'room');
  assert.equal(host.client.state.room.state, 'ended');

  // Settlement: Go republishes race.ended as confirmed; the profile shows the credit once.
  const start = host.profile.state.profile;
  if (host.client.state.result.settlementState !== 'confirmed') {
    await until('settlement confirmed', () => host.client.state.result.settlementState === 'confirmed', 60000);
    assert.equal(host.seen.settlements.length, 1);
  }
  assert.equal(await host.profile.load(), true);
  assert.equal(host.profile.state.profile.plastic, start.plastic + mine.credited.plastic);
  assert.equal(host.profile.state.profile.metal, start.metal + mine.credited.metal);
  host.client.leave();
});
