// G57 integration: the compiled browser adapter talks to the real Go Match
// Service (-> Envoy -> Rust -> PostgreSQL) through server.mjs on one origin.
// Requires COMPUNUBE_GO_URL (for example http://127.0.0.1:8080) and a running stack.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { createGoBackend } from '../dist/net/backend.js';
import { createOnlineProfileStore } from '../dist/online-profile.js';

const GO = process.env.COMPUNUBE_GO_URL;
if (!GO) throw new Error('COMPUNUBE_GO_URL is required for integration tests (no silent skip)');
const serverFile = fileURLToPath(new URL('../server.mjs', import.meta.url));

async function startWeb() {
  const port = await new Promise(resolve => {
    const probe = net.createServer().listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
  });
  const child = spawn(process.execPath, [serverFile], { env: { ...process.env, COMPUNUBE_WEB_PORT: String(port) }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((resolve, reject) => { child.stdout.once('data', resolve); child.once('exit', reject); });
  return { origin: `http://127.0.0.1:${port}`, stop: () => child.kill() };
}

/** Browser-like fetch: same-origin Origin header on unsafe methods and a cookie jar. */
function browserFetch(origin) {
  let cookie = null;
  const fetchLike = async (path, init) => {
    const headers = { ...init.headers };
    if (cookie) headers.Cookie = cookie;
    if (!['GET', 'HEAD'].includes(init.method)) headers.Origin = origin;
    const response = await fetch(origin + path, { ...init, headers });
    const set = response.headers.get('set-cookie');
    if (set) {
      assert.match(set, /HttpOnly/i);
      assert.match(set, /SameSite=Strict/i);
      cookie = set.split(';')[0];
    }
    return response;
  };
  return { fetch: fetchLike, get cookie() { return cookie; } };
}

test('web profile and economy against real Go, Envoy, Rust and PostgreSQL', async t => {
  const web = await startWeb();
  t.after(web.stop);
  const browser = browserFetch(web.origin);
  const { http, profileAdapter } = createGoBackend({ fetch: browser.fetch });
  const store = createOnlineProfileStore({ adapter: profileAdapter });

  assert.equal(await store.load(), true, JSON.stringify(store.state.error));
  assert.ok(browser.cookie?.startsWith('compunube_session='), 'Go issued the HttpOnly session cookie');
  const first = store.state;
  assert.equal(first.playerId, http.playerId, 'profile belongs to the Go session');
  assert.equal(first.profile.totalCleaned, null);
  const startCoins = first.profile.coins;

  // Definitive rejections from Rust surface without changing the confirmed profile.
  assert.equal(await store.transact({ type: 'buy', id: 'sol' }), false);
  assert.equal(store.state.error.code, 'INSUFFICIENT_COINS');
  assert.equal(await store.transact({ type: 'craft', id: 'red-faro' }), false);
  assert.equal(store.state.error.code, 'INSUFFICIENT_MATERIALS');
  assert.equal(await store.transact({ type: 'exchange', material: 'metal', amount: 1 }), false);
  assert.equal(store.state.error.code, 'INSUFFICIENT_MATERIALS');
  assert.equal(store.state.profileRevision, first.profileRevision);
  assert.equal(store.state.profile.coins, startCoins);

  // Confirmed mutations: equipment and appearance.
  assert.equal(await store.transact({ type: 'equip', id: 'luna' }), true, JSON.stringify(store.state.error));
  assert.equal(store.state.profile.equipped.character, 'luna');
  const afterEquip = store.state.profileRevision;
  assert.ok(afterEquip > first.profileRevision);
  // Rust applies the character's default look when it is equipped.
  const equippedLook = store.state.profile.appearance;
  assert.equal(await store.transact({ type: 'appearance', field: 'skin', value: 'dark' }), true, JSON.stringify(store.state.error));
  assert.equal(store.state.profile.appearance.skin, 'dark');
  assert.equal(store.state.profile.appearance.hairColor, equippedLook.hairColor, 'the unchanged option comes from the last confirmed profile');

  // Same requestId twice: the adapter resends the same body and Go returns the stored result.
  const requestId = `g57-${Date.now()}`;
  const once = await profileAdapter.performAction({ requestId, action: { type: 'equip', id: 'samuel' } });
  const twice = await profileAdapter.performAction({ requestId, action: { type: 'equip', id: 'samuel' } });
  assert.equal(twice.requestId, requestId);
  assert.equal(twice.profileRevision, once.profileRevision, 'replay does not apply a second change');
  const catalog = await http.request('GET', '/v1/catalog');
  const raw = await browser.fetch('/v1/profile/equipment', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId, catalogVersion: catalog.catalogVersion, itemId: 'samuel' }) });
  assert.equal(raw.status, 200);
  assert.equal((await raw.json()).replayed, true);
  const conflict = await browser.fetch('/v1/profile/equipment', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId, catalogVersion: catalog.catalogVersion, itemId: 'nico' }) });
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).code, 'IDEMPOTENCY_CONFLICT');

  // Cookie-authenticated mutations require the page's own Origin (CSRF guard in Go).
  for (const origin of [undefined, 'http://evil.example']) {
    const headers = { 'Content-Type': 'application/json', Cookie: browser.cookie };
    if (origin) headers.Origin = origin;
    const forged = await fetch(`${web.origin}/v1/profile/equipment`, { method: 'POST', headers,
      body: JSON.stringify({ requestId: `forged-${origin}`, catalogVersion: catalog.catalogVersion, itemId: 'nico' }) });
    assert.equal(forged.status, 401, `Origin ${origin ?? 'missing'} rejected`);
    assert.equal((await forged.json()).code, 'SESSION_REQUIRED');
  }

  // A fresh read from Go matches what the store confirmed.
  assert.equal(await store.load(), true);
  assert.equal(store.state.profile.equipped.character, 'samuel');
  assert.equal(store.state.profileRevision, once.profileRevision);
});
