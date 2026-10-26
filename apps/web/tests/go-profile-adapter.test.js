import test from 'node:test';
import assert from 'node:assert/strict';
import { createGoBackend } from '../dist/net/backend.js';
import { GoApiError } from '../dist/net/http.js';
import { createOnlineProfileStore } from '../dist/online-profile.js';

const PROFILE = {
  playerId: 'player-1', profileRevision: 3, coins: 50, plastic: 6, metal: 2,
  ownedItemIds: ['nico', 'luna', 'amara', 'samuel', 'coral', 'costero', 'swept', 'curls', 'bun', 'ponytail', 'afro', 'red-base'],
  equipment: { boardId: 'coral', outfitId: 'costero', netId: 'red-base', hairId: 'swept', characterId: 'nico' },
  appearance: { skinId: 'medium', hairColorId: 'brown' },
};
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Scripted E45 peer: each route answers from a queue and records requests. */
function fakeGo(routes) {
  const calls = [];
  const fetch = async (url, init) => {
    const key = `${init.method} ${url}`;
    calls.push({ key, init, body: init.body === undefined ? undefined : JSON.parse(init.body) });
    const queue = routes[key];
    if (!queue?.length) throw new TypeError(`unexpected ${key}`);
    const next = queue.shift();
    if (next === 'drop') throw new TypeError('network down');
    return typeof next === 'function' ? next() : json(...next);
  };
  return { fetch, calls };
}
const session = () => ({ 'GET /v1/sessions/current': [[401, { code: 'SESSION_REQUIRED', message: 'x' }]], 'POST /v1/sessions': [[201, { playerId: 'player-1', token: 'secret' }]] });

test('E45 profile is loaded through a Go session cookie and mapped without inventing history', async () => {
  const go = fakeGo({ ...session(), 'GET /v1/profile': [[200, PROFILE]] });
  const { profileAdapter } = createGoBackend({ fetch: go.fetch });
  const envelope = await profileAdapter.getProfile();
  assert.deepEqual(go.calls.map(call => call.key), ['GET /v1/sessions/current', 'POST /v1/sessions', 'GET /v1/profile']);
  for (const call of go.calls) {
    assert.equal(call.init.credentials, 'same-origin');
    assert.equal(call.init.headers.Authorization, undefined);
  }
  assert.equal(envelope.playerId, 'player-1');
  assert.equal(envelope.profileRevision, 3);
  assert.deepEqual(envelope.profile.equipped, { board: 'coral', outfit: 'costero', net: 'red-base', hair: 'swept', character: 'nico' });
  assert.deepEqual(envelope.profile.appearance, { skin: 'medium', hairColor: 'brown' });
  assert.equal(envelope.profile.totalCleaned, null);
  assert.equal(envelope.profile.races, null);
});

test('the store confirms a purchase only from Go and an uncertain retry resends the identical body', async () => {
  const bought = { ...PROFILE, profileRevision: 4, coins: 0, ownedItemIds: [...PROFILE.ownedItemIds, 'manglar'] };
  const go = fakeGo({
    ...session(),
    'GET /v1/profile': [[200, PROFILE]],
    'GET /v1/catalog': [[200, { catalogVersion: 'catalog-1', items: [] }]],
    'POST /v1/profile/purchases': [
      [504, { code: 'MUTATION_OUTCOME_UNKNOWN', message: 'x' }],
      'drop',
      () => json(200, { requestId: go.calls.at(-1).body.requestId, replayed: true, profile: bought }),
    ],
  });
  const { profileAdapter } = createGoBackend({ fetch: go.fetch });
  const store = createOnlineProfileStore({ adapter: profileAdapter });
  assert.equal(await store.load(), true);
  assert.equal(await store.transact({ type: 'buy', id: 'manglar' }), false);
  assert.equal(store.state.status, 'uncertain');
  assert.equal(store.state.profile.coins, 50, 'balance stays at the last confirmation');
  assert.equal(await store.retry(), false);
  assert.equal(store.state.status, 'uncertain');
  assert.equal(await store.retry(), true);
  assert.equal(store.state.status, 'ready');
  assert.ok(store.state.profile.owned.includes('manglar'));
  const purchases = go.calls.filter(call => call.key === 'POST /v1/profile/purchases');
  assert.equal(purchases.length, 3);
  for (const call of purchases) assert.deepEqual(call.body, purchases[0].body);
  assert.deepEqual(Object.keys(purchases[0].body).sort(), ['catalogVersion', 'itemId', 'requestId']);
  assert.equal(go.calls.filter(call => call.key === 'GET /v1/catalog').length, 1);
});

test('definitive E45 rejections leave the profile unchanged and the next action gets a new requestId', async () => {
  const go = fakeGo({
    ...session(),
    'GET /v1/profile': [[200, PROFILE]],
    'GET /v1/catalog': [[200, { catalogVersion: 'catalog-1', items: [] }]],
    'POST /v1/profile/exchanges': [
      () => json(422, { code: 'INSUFFICIENT_MATERIALS', message: 'x', requestId: go.calls.at(-1).body.requestId }),
      () => json(200, { requestId: go.calls.at(-1).body.requestId, replayed: false, profile: { ...PROFILE, profileRevision: 4, plastic: 5, coins: 54 } }),
    ],
  });
  const store = createOnlineProfileStore({ adapter: createGoBackend({ fetch: go.fetch }).profileAdapter });
  await store.load();
  assert.equal(await store.transact({ type: 'exchange', material: 'plastic', amount: 99 }), false);
  assert.equal(store.state.status, 'ready');
  assert.equal(store.state.error.code, 'INSUFFICIENT_MATERIALS');
  assert.equal(store.state.profile.plastic, 6);
  assert.equal(await store.transact({ type: 'exchange', material: 'plastic', amount: 1 }), true);
  const [rejected, accepted] = go.calls.filter(call => call.key === 'POST /v1/profile/exchanges').map(call => call.body);
  assert.notEqual(rejected.requestId, accepted.requestId);
  assert.deepEqual(accepted, { requestId: accepted.requestId, catalogVersion: 'catalog-1', material: 'plastic', amount: 1 });
  assert.equal(store.state.profile.coins, 54);
});

test('PROFILE_UNAVAILABLE is shown as degraded economy and keeps the operation for a same-id retry', async () => {
  const go = fakeGo({
    ...session(),
    'GET /v1/profile': [[503, { code: 'PROFILE_UNAVAILABLE', message: 'x' }], [200, PROFILE]],
    'GET /v1/catalog': [[200, { catalogVersion: 'catalog-1', items: [] }]],
    'PUT /v1/profile/appearance': [
      [503, { code: 'PROFILE_UNAVAILABLE', message: 'x' }],
      () => json(200, { requestId: go.calls.at(-1).body.requestId, replayed: false, profile: { ...PROFILE, profileRevision: 4, appearance: { skinId: 'dark', hairColorId: 'brown' } } }),
    ],
  });
  const store = createOnlineProfileStore({ adapter: createGoBackend({ fetch: go.fetch }).profileAdapter });
  assert.equal(await store.load(), false);
  assert.equal(store.state.error.code, 'PROFILE_UNAVAILABLE');
  assert.equal(await store.retry(), true);
  assert.equal(await store.transact({ type: 'appearance', field: 'skin', value: 'dark' }), false);
  assert.equal(store.state.status, 'uncertain');
  assert.equal(store.state.error.code, 'PROFILE_UNAVAILABLE');
  assert.equal(await store.retry(), true);
  const bodies = go.calls.filter(call => call.key === 'PUT /v1/profile/appearance').map(call => call.body);
  assert.deepEqual(bodies[0], bodies[1]);
  assert.equal(bodies[0].skinId, 'dark');
  assert.equal(bodies[0].hairColorId, 'brown', 'the unchanged option comes from the confirmed profile');
  assert.equal(store.state.profile.appearance.skin, 'dark');
});

test('GoApiError separates definitive 4xx answers from uncertain outcomes', () => {
  assert.equal(new GoApiError(422, 'NOT_OWNED').definitive, true);
  assert.equal(new GoApiError(409, 'IDEMPOTENCY_CONFLICT').definitive, true);
  for (const error of [new GoApiError(504, 'MUTATION_OUTCOME_UNKNOWN'), new GoApiError(503, 'PROFILE_UNAVAILABLE'), new GoApiError(0, 'TRANSPORT_ERROR'), new GoApiError(500, 'HTTP_ERROR')]) {
    assert.equal(error.definitive, false);
    assert.equal(error.uncertain, true);
  }
});
