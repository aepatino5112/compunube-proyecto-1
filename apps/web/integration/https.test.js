// H66: server.mjs over HTTPS in front of Go. Browsers on other machines only
// send Go's Secure session cookie over HTTPS, and Go sees the proxied request
// over plain HTTP, so it must accept exactly the configured public origin
// (PUBLIC_ORIGINS) for cookie-only mutations and the WebSocket upgrade.
// Requires COMPUNUBE_GO_URL, COMPUNUBE_HTTPS_ORIGIN (listed in Go's
// PUBLIC_ORIGINS) and openssl.
import test from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const GO = process.env.COMPUNUBE_GO_URL;
const ORIGIN = process.env.COMPUNUBE_HTTPS_ORIGIN;
if (!GO || !ORIGIN) throw new Error('COMPUNUBE_GO_URL and COMPUNUBE_HTTPS_ORIGIN are required (no silent skip)');
const origin = new URL(ORIGIN);
const repo = fileURLToPath(new URL('../../../', import.meta.url));

function request(ca, method, target, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request({ host: origin.hostname, port: origin.port, path: target, method, ca, headers }, res => {
      let text = ''; res.on('data', chunk => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    req.on('upgrade', (res, socket) => { socket.destroy(); resolve({ status: res.statusCode, headers: res.headers, text: '' }); });
    req.on('error', reject);
    req.end(body);
  });
}

test('HTTPS web server: Secure cookie, public origin and wss reach Go', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'compunube-tls-'));
  execFileSync('sh', [path.join(repo, 'scripts/deploy/web-tls-cert.sh'), dir, origin.hostname, 'localhost'], { stdio: 'ignore' });
  const ca = readFileSync(path.join(dir, 'web.crt'));
  const web = spawn(process.execPath, [path.join(repo, 'apps/web/server.mjs')], {
    env: { ...process.env, COMPUNUBE_WEB_PORT: origin.port, COMPUNUBE_TLS_CERT: path.join(dir, 'web.crt'), COMPUNUBE_TLS_KEY: path.join(dir, 'web.key') },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  try {
    const banner = await new Promise((resolve, reject) => { web.stdout.once('data', chunk => resolve(String(chunk))); web.once('exit', reject); });
    assert.match(banner, /^Compunube: https:\/\//);
    assert.equal((await request(ca, 'GET', '/')).status, 200);

    const created = await request(ca, 'POST', '/v1/sessions');
    assert.equal(created.status, 201);
    const setCookie = created.headers['set-cookie']?.[0] ?? '';
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /Secure/i);
    const cookie = setCookie.split(';')[0];

    // Cookie-only mutation: only the configured https origin is accepted.
    const body = JSON.stringify({ mapId: 'maracaibo' });
    const json = { 'Content-Type': 'application/json', Cookie: cookie };
    for (const other of ['https://evil.example', `https://${origin.hostname}:${Number(origin.port) + 1}`]) {
      assert.equal((await request(ca, 'POST', '/v1/rooms', { headers: { ...json, Origin: other }, body })).status, 401, other);
    }
    const room = await request(ca, 'POST', '/v1/rooms', { headers: { ...json, Origin: ORIGIN }, body });
    assert.equal(room.status, 201, room.text);
    assert.equal(JSON.parse(room.text).mapId, 'maracaibo');

    // wss: the upgrade is tunnelled to Go and authenticated by cookie + Origin.
    const upgrade = extra => request(ca, 'GET', '/v1/realtime', { headers: {
      Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
      'Sec-WebSocket-Protocol': 'compunube.realtime.v1', Cookie: cookie, ...extra } });
    assert.equal((await upgrade({ Origin: 'https://evil.example' })).status, 401);
    const accepted = await upgrade({ Origin: ORIGIN });
    assert.equal(accepted.status, 101);
    assert.equal(accepted.headers['sec-websocket-protocol'], 'compunube.realtime.v1');
  } finally {
    web.kill();
    rmSync(dir, { recursive: true, force: true });
  }
});
