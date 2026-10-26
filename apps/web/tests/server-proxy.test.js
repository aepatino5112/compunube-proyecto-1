import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const serverFile = fileURLToPath(new URL('../server.mjs', import.meta.url));
const freePort = () => new Promise(resolve => {
  const probe = net.createServer().listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
});

async function startWeb(env) {
  const port = await freePort();
  const child = spawn(process.execPath, [serverFile], { env: { ...process.env, COMPUNUBE_WEB_PORT: String(port), ...env }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((resolve, reject) => { child.stdout.once('data', resolve); child.once('exit', reject); });
  return { port, stop: () => child.kill() };
}

test('without COMPUNUBE_GO_URL the API answers 503 and static files still load', async t => {
  const web = await startWeb({ COMPUNUBE_GO_URL: '' });
  t.after(web.stop);
  const api = await fetch(`http://127.0.0.1:${web.port}/v1/profile`);
  assert.equal(api.status, 503);
  assert.equal((await api.json()).code, 'SERVICE_UNAVAILABLE');
  assert.equal((await fetch(`http://127.0.0.1:${web.port}/`)).status, 200);
});

test('/v1 is forwarded with the browser Host, Origin and cookie; WebSocket upgrades are tunnelled', async t => {
  const seen = [];
  const upstream = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, host: req.headers.host, origin: req.headers.origin, cookie: req.headers.cookie, body });
      res.writeHead(201, { 'Content-Type': 'application/json', 'Set-Cookie': 'compunube_session=abc; Path=/v1; HttpOnly; Secure; SameSite=Strict' });
      res.end('{"playerId":"p1"}');
    });
  });
  upstream.on('upgrade', (req, socket) => {
    seen.push({ upgrade: req.url, host: req.headers.host, protocol: req.headers['sec-websocket-protocol'] });
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
    socket.on('data', chunk => socket.write(chunk));
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  t.after(() => upstream.close());
  const web = await startWeb({ COMPUNUBE_GO_URL: `http://127.0.0.1:${upstream.address().port}` });
  t.after(web.stop);
  const origin = `http://127.0.0.1:${web.port}`;

  const response = await fetch(`${origin}/v1/sessions`, { method: 'POST', headers: { Origin: origin, Cookie: 'compunube_session=old' }, body: '{"a":1}' });
  assert.equal(response.status, 201);
  assert.match(response.headers.get('set-cookie'), /HttpOnly; Secure; SameSite=Strict/);
  assert.deepEqual(seen[0], { method: 'POST', url: '/v1/sessions', host: `127.0.0.1:${web.port}`, origin, cookie: 'compunube_session=old', body: '{"a":1}' });

  const echoed = await new Promise((resolve, reject) => {
    const socket = net.connect(web.port, '127.0.0.1', () => {
      socket.write(`GET /v1/realtime HTTP/1.1\r\nHost: 127.0.0.1:${web.port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Protocol: compunube.realtime.v1\r\n\r\n`);
    });
    let data = '';
    socket.on('data', chunk => {
      data += chunk;
      if (data.includes('\r\n\r\n') && !data.includes('ping')) socket.write('ping');
      if (data.includes('ping')) { socket.destroy(); resolve(data); }
    });
    socket.on('error', reject);
  });
  assert.match(echoed, /^HTTP\/1\.1 101/);
  assert.deepEqual(seen[1], { upgrade: '/v1/realtime', host: `127.0.0.1:${web.port}`, protocol: 'compunube.realtime.v1' });
});

test('/api-docs serves Swagger UI and the unmodified E45 contract without a backend', async t => {
  const web = await startWeb({ COMPUNUBE_GO_URL: '' });
  t.after(web.stop);
  const origin = `http://127.0.0.1:${web.port}`;
  const redirect = await fetch(`${origin}/api-docs`, { redirect: 'manual' });
  assert.equal(redirect.status, 301);
  assert.equal(redirect.headers.get('location'), '/api-docs/');
  const page = await fetch(`${origin}/api-docs/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /swagger-ui-bundle\.js/);
  const spec = await fetch(`${origin}/api-docs/openapi.yaml`);
  assert.match(spec.headers.get('content-type'), /yaml/);
  const { readFile } = await import('node:fs/promises');
  assert.equal(await spec.text(), await readFile(new URL('../../../contracts/http/openapi.yaml', import.meta.url), 'utf8'));
});
