import test from 'node:test';
import assert from 'node:assert/strict';
import {createOnlineProfileStore} from '../dist/online-profile.js';
import {freshProfile} from '../dist/economy.js';

function envelope(revision = 1, patch = {}) {
  const {settled, ...profile} = freshProfile();
  return {playerId: 'account-1', profileRevision: revision,
    profile: {...profile, coins: 120, plastic: 20, metal: 12}, ...patch};
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}
function harness(options = {}) {
  const requests = [], loads = [];
  let sequence = 0;
  const adapter = {
    getProfile(context) { loads.push(context); return options.load ? options.load(context) : Promise.resolve(envelope()); },
    performAction(request, context) {
      requests.push({request, context});
      return options.perform ? options.perform(request, context) : Promise.resolve(envelope(2, {requestId: request.requestId}));
    },
  };
  const store = createOnlineProfileStore({adapter, requestIdFactory: () => `request-${++sequence}`,
    ...options.storeOptions});
  return {store, requests, loads, adapter};
}
const buy = {type: 'buy', id: 'manglar'};

test('unconfigured or malformed adapters never invent an online account', async () => {
  for (const adapter of [null, {}, {getProfile() { throw new Error('unused'); }}]) {
    const store = createOnlineProfileStore({adapter}), states = [];
    const unsubscribe = store.subscribe(state => states.push(state));
    assert.equal(states.length, 1); assert.equal(store.state.status, 'unconfigured');
    assert.equal(store.state.profile, null);
    assert.equal(await store.load(), false); assert.equal(await store.transact(buy), false);
    assert.equal(await store.retry(), false); assert.equal(store.state.error.code, 'NOT_CONFIGURED');
    assert.equal(store.accept(envelope()), false);
    unsubscribe(); store.reset(); store.dispose();
  }
});

test('load whitelists and deeply freezes DTO copies without local history or server extras', async () => {
  const raw = envelope(4); raw.token = 'secret'; raw.profile.settled = ['local-only'];
  raw.profile.equipped.unknown = 'secret'; raw.profile.appearance.extra = 'secret';
  const h = harness({load: async () => raw}), statuses = [];
  h.store.subscribe(state => statuses.push(state.status));
  assert.equal(await h.store.load(), true);
  assert.deepEqual(statuses, ['idle', 'loading', 'ready']);
  assert.equal(h.store.state.profileRevision, 4); assert.equal(h.store.state.playerId, 'account-1');
  assert.equal(h.store.state.profile.settled, undefined); assert.equal(h.store.state.token, undefined);
  assert.equal(h.store.state.profile.equipped.unknown, undefined);
  assert.equal(h.store.state.profile.appearance.extra, undefined);
  raw.profile.coins = 500; raw.profile.owned.length = 0; raw.profile.equipped.board = 'sol';
  assert.equal(h.store.state.profile.coins, 120); assert.equal(h.store.state.profile.equipped.board, 'coral');
  assert.throws(() => h.store.state.profile.owned.push('sol'), TypeError);
  assert.throws(() => { h.store.state.profile.appearance.skin = 'deep'; }, TypeError);
  assert.throws(() => { h.store.state.status = 'ready'; }, TypeError);
  assert.ok(h.loads[0].signal instanceof AbortSignal);
  h.store.dispose();
});

test('invalid server profiles fail closed, never repaired into starter equipment or money', async () => {
  const changes = [
    value => value.profile.version = 2,
    value => value.profile.coins = -1,
    value => value.profile.plastic = 1.5,
    value => value.profile.metal = 1e9,
    value => value.profile.races = Number.MAX_SAFE_INTEGER + 1,
    value => value.profile.totalCleaned = NaN,
    value => value.profile.owned.push('unknown'),
    value => value.profile.owned.push('coral'),
    value => value.profile.equipped.board = 'manglar',
    value => value.profile.equipped.board = 'costero',
    value => delete value.profile.equipped.hair,
    value => value.profile.appearance.skin = 'invented',
    value => delete value.profile.appearance.hairColor,
    value => value.profileRevision = -1,
    value => value.profileRevision = 2.5,
    value => value.playerId = '  ',
    value => value.requestId = '\nrequest',
  ];
  for (const change of changes) {
    const raw = envelope(); change(raw);
    const h = harness({load: async () => raw});
    assert.equal(await h.store.load(), false);
    assert.equal(h.store.state.status, 'error'); assert.equal(h.store.state.error.code, 'INVALID_RESPONSE');
    assert.equal(h.store.state.profile, null); assert.equal(h.store.state.playerId, null);
    h.store.dispose();
  }
});

test('reload failure preserves the last confirmed account; another identity requires reset', async () => {
  let response = envelope();
  const h = harness({load: async () => { if (response instanceof Error) throw response; return response; }});
  await h.store.load(); const profile = h.store.state.profile;
  response = new Error('private transport detail');
  assert.equal(await h.store.load(), false); assert.equal(h.store.state.profile, profile);
  assert.equal(h.store.state.status, 'error'); assert.equal(h.store.state.error.code, 'LOAD_FAILED');
  assert.ok(!h.store.state.error.message.includes('private'));
  response = envelope(8, {playerId: 'account-2'});
  assert.equal(await h.store.retry(), false); assert.equal(h.store.state.error.code, 'IDENTITY_CHANGED');
  assert.equal(h.store.state.profile, profile); assert.equal(h.store.state.playerId, 'account-1');
  h.store.reset(); assert.equal(await h.store.load(), true); assert.equal(h.store.state.playerId, 'account-2');
  h.store.dispose();
});

test('the server confirms mutations; there is no optimistic spending or local economy invocation', async () => {
  const reply = deferred();
  const h = harness({perform: () => reply.promise}); await h.store.load();
  const before = h.store.state.profile;
  const outgoing = {...buy, coins: -999, plastic: 10000, raceId: 'forged'};
  const result = h.store.transact(outgoing); await Promise.resolve();
  assert.equal(h.store.state.status, 'pending'); assert.equal(h.store.state.profile, before);
  assert.deepEqual(h.requests[0].request, {requestId: 'request-1', action: buy});
  outgoing.id = 'sol'; assert.equal(h.store.state.operation.action.id, 'manglar');
  assert.ok(h.requests[0].context.signal instanceof AbortSignal);
  const confirmed = envelope(2, {requestId: 'request-1'});
  confirmed.profile.coins = 59; confirmed.profile.owned.push('manglar');
  reply.resolve(confirmed); assert.equal(await result, true);
  assert.equal(h.store.state.profile.coins, 59); assert.ok(h.store.state.profile.owned.includes('manglar'));
  assert.equal(h.store.state.status, 'ready'); assert.equal(h.store.state.operation, null);
  h.store.dispose();
});

test('only catalog-backed buy, craft, equip, appearance and positive exchanges can be sent', async () => {
  const h = harness();
  assert.equal(await h.store.transact(buy), false); assert.equal(h.store.state.error.code, 'PROFILE_REQUIRED');
  await h.store.load();
  for (const bad of [null, {}, {type: 'finish', raceId: 'fake', plastic: 100},
    {type: 'buy', id: 'unknown'}, {type: 'buy', id: 'red-reuso'}, {type: 'craft', id: 'coral'},
    {type: 'equip', id: 'unknown'}, {type: 'appearance', field: 'skin', value: 'invalid'},
    {type: 'appearance', field: 'toString', value: 'blue'}, {type: 'appearance', field: '__proto__', value: 'deep'},
    ...[-1, 0, 1.5, Infinity, 1e9, '2'].map(amount => ({type: 'exchange', material: 'plastic', amount})),
    {type: 'exchange', material: 'coins', amount: 1}]) {
    assert.equal(await h.store.transact(bad), false);
    assert.equal(h.store.state.error.code, 'INVALID_ACTION'); assert.equal(h.store.state.status, 'ready');
  }
  assert.equal(h.requests.length, 0);
  for (const action of [buy, {type: 'craft', id: 'red-reuso'}, {type: 'equip', id: 'coral'},
    {type: 'appearance', field: 'skin', value: 'deep'}, {type: 'appearance', field: 'hairColor', value: 'blue'},
    {type: 'exchange', material: 'plastic', amount: 3}, {type: 'exchange', material: 'metal', amount: 1}])
    assert.equal(await h.store.transact(action), true);
  assert.equal(h.requests.length, 7); h.store.dispose();
});

test('a single operation blocks concurrent clicks, reloads and retries until confirmation', async () => {
  const reply = deferred(), h = harness({perform: () => reply.promise}); await h.store.load();
  const result = h.store.transact(buy); await Promise.resolve();
  assert.equal(await h.store.transact({type: 'buy', id: 'sol'}), false);
  assert.equal(await h.store.load(), false); assert.equal(await h.store.retry(), false);
  assert.equal(h.requests.length, 1); assert.equal(h.loads.length, 1);
  reply.resolve(envelope(2, {requestId: 'request-1'})); assert.equal(await result, true);
  h.store.dispose();
});

test('explicit business rejection keeps confirmed balances and allows a new unique request', async () => {
  let reject = true;
  const h = harness({perform: async request => {
    if (reject) throw {code: 'INSUFFICIENT_MATERIALS', message: '<script>secret</script>', requestId: request.requestId};
    return envelope(2, {requestId: request.requestId});
  }}); await h.store.load(); const before = h.store.state.profile;
  assert.equal(await h.store.transact({type: 'craft', id: 'red-reuso'}), false);
  assert.equal(h.store.state.status, 'ready'); assert.equal(h.store.state.operation, null);
  assert.equal(h.store.state.profile, before); assert.equal(h.store.state.error.code, 'INSUFFICIENT_MATERIALS');
  assert.ok(!h.store.state.error.message.includes('script'));
  reject = false; assert.equal(await h.store.transact(buy), true);
  assert.deepEqual(h.requests.map(value => value.request.requestId), ['request-1', 'request-2']);
  h.store.dispose();
});

test('transport failures preserve the same request and prevent a second spend until retry confirms', async () => {
  let fail = true;
  const h = harness({perform: async request => {
    if (fail) throw new Error('network dropped after commit');
    return envelope(2, {requestId: request.requestId});
  }}); await h.store.load(); const before = h.store.state.profile;
  assert.equal(await h.store.transact(buy), false);
  const operation = h.store.state.operation;
  assert.equal(h.store.state.status, 'uncertain'); assert.equal(h.store.state.profile, before);
  assert.equal(await h.store.transact(buy), false); assert.equal(await h.store.load(), false);
  fail = false; assert.equal(await h.store.retry(), true);
  assert.equal(h.requests.length, 2); assert.equal(h.requests[0].request, operation);
  assert.equal(h.requests[1].request, operation); assert.equal(h.store.state.operation, null);
  h.store.dispose();
});

test('malformed, wrong-identity, wrong-request responses and unrelated rejections are uncertain', async () => {
  const changes = [value => value.profile.coins = -1, value => value.playerId = 'another-account',
    value => value.requestId = 'another-request', value => delete value.requestId];
  for (const change of changes) {
    const h = harness({perform: async request => { const raw = envelope(2, {requestId: request.requestId}); change(raw); return raw; }});
    await h.store.load(); const before = h.store.state.profile;
    assert.equal(await h.store.transact(buy), false); assert.equal(h.store.state.status, 'uncertain');
    assert.equal(h.store.state.profile, before); assert.equal(h.store.state.operation.requestId, 'request-1');
    h.store.dispose();
  }
  const h = harness({perform: async () => { throw {code: 'NOT_OWNED', requestId: 'another-request'}; }});
  await h.store.load(); assert.equal(await h.store.transact(buy), false);
  assert.equal(h.store.state.status, 'uncertain'); h.store.dispose();
});

test('unsolicited pushes cannot establish or change identity and old revisions cannot roll back state', async () => {
  const h = harness();
  assert.equal(h.store.accept(envelope(100)), false); await h.store.load();
  assert.equal(h.store.accept(envelope(10, {playerId: 'another-account'})), false);
  const raw = envelope(4); raw.profile.coins = 400;
  assert.equal(h.store.accept(raw), true); const before = h.store.state.profile;
  assert.equal(h.store.accept(envelope(3)), false); assert.equal(h.store.accept(envelope(4)), false);
  assert.equal(h.store.state.profile, before); assert.equal(h.store.state.profile.coins, 400);
  assert.equal(await h.store.load(), true); assert.equal(h.store.state.profile, before);
  h.store.dispose();
});

test('a newer push wins over an older HTTP action response without leaving the action pending', async () => {
  const reply = deferred(), h = harness({perform: () => reply.promise}); await h.store.load();
  const result = h.store.transact(buy); await Promise.resolve();
  const latest = envelope(8); latest.profile.coins = 777;
  assert.equal(h.store.accept(latest), true); assert.equal(h.store.state.status, 'pending');
  assert.equal(h.store.state.operation.requestId, 'request-1');
  reply.resolve(envelope(2, {requestId: 'request-1'})); assert.equal(await result, true);
  assert.equal(h.store.state.status, 'ready'); assert.equal(h.store.state.profileRevision, 8);
  assert.equal(h.store.state.profile.coins, 777); h.store.dispose();
});

test('only a matching request push acknowledges an action, including an equal-revision replay', async () => {
  const reply = deferred(), h = harness({perform: () => reply.promise}); await h.store.load();
  const result = h.store.transact(buy); await Promise.resolve();
  assert.equal(h.store.accept(envelope(3, {requestId: 'unrelated'})), true);
  assert.equal(h.store.state.status, 'pending');
  const confirmed = h.store.state.profile;
  assert.equal(h.store.accept(envelope(3, {requestId: 'request-1'})), true);
  assert.equal(h.store.state.status, 'ready'); assert.equal(h.store.state.operation, null);
  assert.equal(h.store.state.profile, confirmed); assert.equal(await result, true);
  assert.equal(h.requests[0].context.signal.aborted, true);
  reply.resolve(envelope(2, {requestId: 'request-1'})); await Promise.resolve();
  assert.equal(h.store.state.profileRevision, 3); h.store.dispose();
});

test('timeouts abort requests: loads stay empty and actions remain uncertain with their original ID', async () => {
  const missing = new Promise(() => {}), h = harness({load: () => missing, storeOptions: {timeoutMs: 15}});
  assert.equal(await h.store.load(), false); assert.equal(h.store.state.status, 'error');
  assert.equal(h.store.state.profile, null); assert.equal(h.loads[0].signal.aborted, true); h.store.dispose();
  let hangs = true;
  const action = harness({perform: request => hangs ? missing : Promise.resolve(envelope(2, {requestId: request.requestId})),
    storeOptions: {timeoutMs: 15}}); await action.store.load();
  assert.equal(await action.store.transact(buy), false); assert.equal(action.store.state.status, 'uncertain');
  assert.equal(action.requests[0].context.signal.aborted, true); hangs = false;
  assert.equal(await action.store.retry(), true);
  assert.equal(action.requests[1].request.requestId, 'request-1'); action.store.dispose();
});

test('reset and disposal abort and ignore late requests without restoring a previous account', async () => {
  for (const action of ['reset', 'dispose']) {
    const reply = deferred(), h = harness({load: () => reply.promise});
    const loading = h.store.load(); await Promise.resolve();
    h.store[action](); assert.equal(await loading, false); assert.equal(h.loads[0].signal.aborted, true);
    reply.resolve(envelope()); await Promise.resolve();
    assert.equal(h.store.state.profile, null); assert.equal(h.store.state.playerId, null);
    assert.equal(h.store.accept(envelope()), false); h.store.dispose();
  }
  const reply = deferred(), h = harness({perform: () => reply.promise}); await h.store.load();
  const result = h.store.transact(buy); await Promise.resolve(); h.store.reset();
  assert.equal(await result, false); reply.resolve(envelope(2, {requestId: 'request-1'}));
  await Promise.resolve(); assert.equal(h.store.state.status, 'idle'); assert.equal(h.store.state.profile, null);
  h.store.dispose();
});

test('invalid and reused request identifiers fail before sending another operation', async () => {
  const h = harness({storeOptions: {requestIdFactory: () => 'same-id'}}); await h.store.load();
  assert.equal(await h.store.transact(buy), true); assert.equal(await h.store.transact(buy), false);
  assert.equal(h.requests.length, 1); assert.equal(h.store.state.error.code, 'INVALID_REQUEST_ID');
  h.store.reset(); await h.store.load(); assert.equal(await h.store.transact(buy), false);
  h.store.dispose();
  for (const requestIdFactory of [() => '', () => '\nforged', () => { throw new Error('no randomness'); }]) {
    const invalid = harness({storeOptions: {requestIdFactory}}); await invalid.store.load();
    assert.equal(await invalid.store.transact(buy), false); assert.equal(invalid.requests.length, 0); invalid.store.dispose();
  }
});

test('subscription cleanup and reentrant reset do not send or resurrect a request', async () => {
  const h = harness(); let calls = 0;
  const unsubscribe = h.store.subscribe(() => calls++); assert.equal(calls, 1);
  unsubscribe(); await h.store.load(); assert.equal(calls, 1);
  const reset = h.store.subscribe(state => { if (state.status === 'pending') h.store.reset(); });
  assert.equal(await h.store.transact(buy), false); assert.equal(h.requests.length, 0);
  assert.equal(h.store.state.status, 'idle'); reset(); h.store.dispose();
  assert.equal(await h.store.load(), false); assert.equal(await h.store.transact(buy), false);
  assert.equal(await h.store.retry(), false); assert.equal(h.store.reset(), false);
});
