import http from 'node:http';
import net from 'node:net';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(fileURLToPath(new URL('./dist/', import.meta.url)));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.json': 'application/json; charset=utf-8' };
const host = process.env.COMPUNUBE_WEB_HOST || '127.0.0.1';
const port = Number(process.env.COMPUNUBE_WEB_PORT || 4173);
// Optional Go Match Service origin (for example http://127.0.0.1:8080). /v1 is
// forwarded so the browser stays same-origin: Go's HttpOnly session cookie and
// its Origin check on mutations and the WebSocket upgrade both rely on that.
const go = process.env.COMPUNUBE_GO_URL ? new URL(process.env.COMPUNUBE_GO_URL) : null;
if (go && (go.protocol !== 'http:' || go.pathname !== '/' || go.search)) throw new Error('COMPUNUBE_GO_URL must be an http:// origin');
const isApi = url => url === '/v1' || url.startsWith('/v1/');

function unavailable(res) {
  res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify({ code: 'SERVICE_UNAVAILABLE', message: 'Online service is not configured' }));
}

function forward(req, res) {
  if (!go) { unavailable(res); return; }
  // The original Host header is kept so Go compares Origin with this page's host.
  const upstream = http.request({ host: go.hostname, port: go.port || 80, method: req.method, path: req.url, headers: req.headers }, answer => {
    res.writeHead(answer.statusCode, answer.headers);
    answer.pipe(res);
  });
  upstream.on('error', () => { if (!res.headersSent) unavailable(res); else res.destroy(); });
  req.pipe(upstream);
}

const server = http.createServer(async (req, res) => {
  if (isApi(req.url)) { forward(req, res); return; }
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const target = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!target.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
    const body = await readFile(target);
    res.writeHead(200, { 'Content-Type': types[path.extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch { res.writeHead(404); res.end('Not found'); }
});

// WebSocket upgrades for /v1/realtime are tunnelled byte for byte to Go.
server.on('upgrade', (req, socket, head) => {
  if (!go || !isApi(req.url)) { socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n'); return; }
  const upstream = net.connect(Number(go.port || 80), go.hostname, () => {
    const lines = [`${req.method} ${req.url} HTTP/1.1`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
    upstream.write(lines.join('\r\n') + '\r\n\r\n');
    if (head?.length) upstream.write(head);
    upstream.pipe(socket); socket.pipe(upstream);
  });
  const close = () => { upstream.destroy(); socket.destroy(); };
  upstream.on('error', close); socket.on('error', close);
});

server.listen(port, host, () => console.log(`Compunube: http://${host}:${port}${go ? ` · online via ${go.origin}` : ''}`));
