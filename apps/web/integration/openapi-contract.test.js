// E45 conformance: every public operation is called on the real Go Match
// Service (-> Envoy -> Rust -> PostgreSQL) and each answer must use a status the
// OpenAPI documents for that operation and a body that validates against the
// documented schema. Requires COMPUNUBE_GO_URL and a running stack.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import SwaggerParser from '@apidevtools/swagger-parser';
import Ajv from 'ajv';

const GO = process.env.COMPUNUBE_GO_URL;
if (!GO) throw new Error('COMPUNUBE_GO_URL is required for integration tests (no silent skip)');
const specFile = fileURLToPath(new URL('../../../contracts/http/openapi.yaml', import.meta.url));
const spec = await SwaggerParser.dereference(specFile);
const base = spec.servers[0].url; // /v1
// OpenAPI 3.0 keywords such as `example` and `format: int64` are not JSON Schema validation rules.
const ajv = new Ajv({ strict: false, allErrors: true });
const validators = new Map();
const covered = new Map();

function operation(method, template) {
  const op = spec.paths[template]?.[method.toLowerCase()];
  assert.ok(op, `${method} ${template} is not documented`);
  return op;
}

/** Calls Go and checks status and body against the documented response. */
async function call(method, template, { path = template, token, body, raw, headers = {} } = {}) {
  const op = operation(method, template);
  const init = { method, headers: { Accept: 'application/json', ...headers } };
  if (token) init.headers.Authorization = `Bearer ${token}`;
  if (body !== undefined || raw !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = raw ?? JSON.stringify(body);
  }
  const response = await fetch(GO + base + path, init);
  const status = String(response.status);
  const documented = op.responses[status];
  assert.ok(documented, `${op.operationId} returned undocumented status ${status}`);
  const text = await response.text();
  const schema = documented.content?.['application/json']?.schema;
  let json = null;
  if (schema) {
    assert.match(response.headers.get('content-type') ?? '', /application\/json/, `${op.operationId} ${status} content type`);
    json = JSON.parse(text);
    const key = `${op.operationId} ${status}`;
    if (!validators.has(key)) validators.set(key, ajv.compile(schema));
    const validate = validators.get(key);
    assert.ok(validate(json), `${key} body does not match the OpenAPI schema: ${ajv.errorsText(validate.errors)} :: ${text.slice(0, 300)}`);
  }
  covered.set(op.operationId, new Set([...(covered.get(op.operationId) ?? []), status]));
  return { status: response.status, json, headers: response.headers };
}

async function session() {
  const { status, json, headers } = await call('POST', '/sessions');
  assert.equal(status, 201);
  assert.match(headers.get('set-cookie') ?? '', /compunube_session=.*HttpOnly.*Secure.*SameSite=Strict/i);
  return json.token;
}

function upgrade(headers) {
  const url = new URL(GO + base + '/realtime');
  return new Promise((resolve, reject) => {
    const request = http.request({ host: url.hostname, port: url.port, path: url.pathname, headers: {
      Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==', ...headers,
    } });
    request.on('upgrade', (response, socket) => { socket.destroy(); resolve({ status: response.statusCode, protocol: response.headers['sec-websocket-protocol'] }); });
    request.on('response', response => {
      let text = ''; response.on('data', chunk => { text += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, text }));
    });
    request.on('error', reject);
    request.end();
  });
}

test('every E45 operation answers with documented statuses and schemas', async () => {
  // Session
  const token = await session();
  assert.equal((await call('POST', '/sessions', { raw: '{}' })).json.code, 'INVALID_REQUEST');
  assert.equal((await call('GET', '/sessions/current', { token })).status, 200);
  assert.equal((await call('GET', '/sessions/current')).json.code, 'SESSION_REQUIRED');

  // Profile and catalog
  const profile = (await call('GET', '/profile', { token })).json;
  assert.equal((await call('GET', '/profile', { token, path: '/profile?x=1' })).json.code, 'INVALID_REQUEST');
  assert.equal((await call('GET', '/profile')).status, 401);
  const catalog = (await call('GET', '/catalog', { token })).json;
  assert.equal(catalog.items.length, 22);
  assert.equal((await call('GET', '/catalog', { token, path: '/catalog?catalogVersion=no-such-version' })).json.code, 'INVALID_CATALOG_VERSION');
  assert.equal((await call('GET', '/catalog', { token, path: '/catalog?foo=1' })).status, 400);
  const v = catalog.catalogVersion;
  const id = label => `e45-${label}-${Date.now()}`;

  // Economy: definitive rejections, validation, success, replay and conflict
  assert.equal((await call('POST', '/profile/purchases', { token, body: { requestId: id('buy'), catalogVersion: v, itemId: 'sol' } })).json.code, 'INSUFFICIENT_COINS');
  assert.equal((await call('POST', '/profile/purchases', { token, body: { requestId: id('bad'), catalogVersion: v } })).status, 400);
  assert.equal((await call('POST', '/profile/crafts', { token, body: { requestId: id('craft'), catalogVersion: v, itemId: 'red-faro' } })).json.code, 'INSUFFICIENT_MATERIALS');
  assert.equal((await call('POST', '/profile/exchanges', { token, body: { requestId: id('ex'), catalogVersion: v, material: 'metal', amount: 1 } })).json.code, 'INSUFFICIENT_MATERIALS');
  assert.equal((await call('POST', '/profile/exchanges', { token, body: { requestId: id('ex0'), catalogVersion: v, material: 'metal', amount: 0 } })).status, 400);
  const equipId = id('equip');
  const equipped = await call('POST', '/profile/equipment', { token, body: { requestId: equipId, catalogVersion: v, itemId: 'luna' } });
  assert.equal(equipped.json.replayed, false);
  assert.ok(equipped.json.profile.profileRevision > profile.profileRevision);
  const replay = await call('POST', '/profile/equipment', { token, body: { requestId: equipId, catalogVersion: v, itemId: 'luna' } });
  assert.equal(replay.json.replayed, true);
  assert.equal(replay.json.profile.profileRevision, equipped.json.profile.profileRevision);
  assert.equal((await call('POST', '/profile/equipment', { token, body: { requestId: equipId, catalogVersion: v, itemId: 'nico' } })).json.code, 'IDEMPOTENCY_CONFLICT');
  assert.equal((await call('POST', '/profile/equipment', { token, body: { requestId: id('notowned'), catalogVersion: v, itemId: 'sol' } })).json.code, 'NOT_OWNED');
  assert.equal((await call('PUT', '/profile/appearance', { token, body: { requestId: id('look'), catalogVersion: v, skinId: 'dark', hairColorId: 'black' } })).status, 200);
  assert.equal((await call('PUT', '/profile/appearance', { token, body: { requestId: id('badlook'), catalogVersion: v, skinId: 'nope', hairColorId: 'black' } })).json.code, 'INVALID_APPEARANCE');
  assert.equal((await call('PUT', '/profile/appearance', { body: { requestId: id('anon'), catalogVersion: v, skinId: 'dark', hairColorId: 'black' } })).status, 401);

  // Rooms
  assert.equal((await call('POST', '/rooms', { token, body: { mapId: 'atlantis' } })).status, 422);
  assert.equal((await call('POST', '/rooms', { token, raw: '{"mapId":"maracaibo","extra":1}' })).json.code, 'INVALID_REQUEST');
  const room = (await call('POST', '/rooms', { token, body: { mapId: 'maracaibo' } })).json;
  assert.equal(room.state, 'LOBBY');
  assert.equal((await call('POST', '/rooms', { token, body: { mapId: 'orinoco' } })).json.code, 'INVALID_STATE');
  const joinPath = `/rooms/${encodeURIComponent(room.roomId)}/memberships`;
  const others = [];
  for (let i = 0; i < 4; i++) others.push(await session());
  assert.equal((await call('POST', '/rooms/{roomId}/memberships', { token: others[0], path: '/rooms/no-such-room/memberships' })).json.code, 'ROOM_NOT_FOUND');
  for (const other of others.slice(0, 3)) {
    const joined = await call('POST', '/rooms/{roomId}/memberships', { token: other, path: joinPath });
    assert.equal(joined.json.roomId, room.roomId);
  }
  assert.equal((await call('POST', '/rooms/{roomId}/memberships', { token: others[3], path: joinPath })).json.code, 'ROOM_FULL');
  assert.equal((await call('POST', '/rooms/{roomId}/memberships', { path: joinPath })).status, 401);

  // Realtime upgrade (E43 messages are covered by the realtime integration tests)
  const op = operation('GET', '/realtime');
  const noSession = await upgrade({ 'Sec-WebSocket-Protocol': 'compunube.realtime.v1' });
  const wrongProtocol = await upgrade({ Authorization: `Bearer ${token}`, 'Sec-WebSocket-Protocol': 'compunube.realtime.v2' });
  const ok = await upgrade({ Authorization: `Bearer ${token}`, 'Sec-WebSocket-Protocol': 'compunube.realtime.v1' });
  for (const result of [noSession, wrongProtocol, ok]) assert.ok(op.responses[String(result.status)], `openRealtime undocumented ${result.status}`);
  assert.equal(noSession.status, 401);
  assert.equal(JSON.parse(wrongProtocol.text).code, 'INCOMPATIBLE_VERSION');
  assert.equal(ok.status, 101);
  assert.equal(ok.protocol, 'compunube.realtime.v1');
  covered.set('openRealtime', new Set(['101', '400', '401']));

  // Every documented operation was exercised; report statuses not provoked here.
  const operations = Object.values(spec.paths).flatMap(item => Object.values(item));
  for (const documented of operations) assert.ok(covered.has(documented.operationId), `${documented.operationId} not exercised`);
  const unexercised = operations.flatMap(o => Object.keys(o.responses).filter(s => !covered.get(o.operationId).has(s)).map(s => `${o.operationId} ${s}`));
  console.log(`  E45: ${operations.length} operations, ${[...covered.values()].reduce((n, s) => n + s.size, 0)} status/schema pairs verified`);
  console.log(`  not provoked here (dependency failures and timeouts): ${unexercised.join(', ')}`);
});
