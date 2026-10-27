import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import net from 'node:net';
import test from 'node:test';
import { composeUp, hostPort, initValues, LAB_DB_PORT, parseEnv, renderEnv, SECRETS, tcp } from './lab.mjs';

const example = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');

test('a single-host init only fills the five secrets, each random and distinct', () => {
  const values = initValues({});
  assert.deepEqual(Object.keys(values), SECRETS);
  assert.equal(new Set(Object.values(values)).size, 5);
  for (const value of Object.values(values)) assert.match(value, /^[0-9a-f]{48}$/);
});

test('a lab init points Go and Rust at the other machines and keeps existing secrets', () => {
  const existing = parseEnv(renderEnv(example, initValues({})));
  const values = initValues(existing, { db: '10.0.0.21', rust: '10.0.0.22', go: 'labbd-15' });
  for (const key of SECRETS) assert.equal(values[key], existing[key]);
  assert.equal(values.POSTGRES_PORT, LAB_DB_PORT);
  assert.equal(values.POSTGRES_ADDR, `10.0.0.21:${LAB_DB_PORT}`);
  assert.equal(values.PLAYER_PROFILE_GRPC_ADDR, '10.0.0.22:50051');
  assert.equal(values.COMPUNUBE_GO_URL, 'http://labbd-15:8080');
  assert.equal(initValues(existing, { db: '10.0.0.21:5432' }).POSTGRES_ADDR, '10.0.0.21:5432');
});

test('the rendered .env keeps the template and Compose reads the new values', () => {
  const values = initValues({}, { db: '10.0.0.21', rust: '10.0.0.22', go: '10.0.0.15' });
  const text = renderEnv(example.replace(/\n/g, '\r\n'), values);
  const env = parseEnv(text);
  for (const [key, value] of Object.entries(values)) assert.equal(env[key], value);
  assert.equal(env.POSTGRES_DB, 'compunube');
  assert.equal(text.match(/^POSTGRES_ADDR=/gm).length, 1);
  assert.ok(text.includes('# Lab by roles'));
  assert.ok(text.endsWith('\n') && !text.endsWith('\n\n'));
});

test('each role starts only its services; Rust and Go skip the dependencies on other machines', () => {
  assert.deepEqual(composeUp('db').slice(-2), ['postgres', 'db-migrate']);
  assert.ok(!composeUp('db').includes('--no-deps'));
  assert.deepEqual(composeUp('rust').slice(-4), ['--no-deps', 'player-profile-rust-1', 'player-profile-rust-2', 'envoy']);
  assert.deepEqual(composeUp('go').slice(-2), ['--no-deps', 'match-service-go']);
  assert.deepEqual(composeUp('all'), ['compose', 'up', '-d', '--wait', '--wait-timeout', '300']);
  assert.ok(composeUp('go', { build: true }).includes('--build'));
});

test('addresses accept a host, host:port or an http origin', () => {
  assert.deepEqual(hostPort('10.0.0.15', 8080), { host: '10.0.0.15', port: 8080 });
  assert.deepEqual(hostPort('10.0.0.21:55432'), { host: '10.0.0.21', port: 55432 });
  assert.deepEqual(hostPort('http://labbd-15:8080/'), { host: 'labbd-15', port: 8080 });
});

test('tcp reports an open and a closed port', async () => {
  const server = net.createServer().listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  assert.equal(await tcp('127.0.0.1', port), true);
  await new Promise(resolve => server.close(resolve));
  assert.equal(await tcp('127.0.0.1', port, 500), false);
});
