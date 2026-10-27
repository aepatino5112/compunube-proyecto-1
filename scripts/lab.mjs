#!/usr/bin/env node
// Lab deployment by roles (docs/deployment/lab-roles.md): one machine per role,
// started with plain Node and Docker Compose. Runs the same from PowerShell,
// cmd or Git Bash, so it needs neither .ps1/.sh scripts nor administrator rights.
//   node scripts/lab.mjs init --db <ip> --rust <ip> --go <ip>   # once, then copy .env
//   node scripts/lab.mjs db | rust | go | web | all | check | status | stop
import { spawnSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENV_FILE = path.join(ROOT, '.env');
export const SECRETS = ['POSTGRES_PASSWORD', 'MATCH_DB_PASSWORD', 'PLAYER_DB_PASSWORD', 'MONITOR_DB_PASSWORD', 'GRAFANA_ADMIN_PASSWORD'];
// Published database port in the lab: lab machines may already run a Windows
// PostgreSQL on 5432, which would take the connection instead of Docker.
export const LAB_DB_PORT = '55432';

// role -> Compose services it runs and the .env addresses it needs to reach.
export const ROLES = {
  // db-migrate is a one-shot job: some Compose versions fail `up --wait` when a
  // targeted service exits, even with code 0, so it runs after PostgreSQL is up.
  db: { services: ['postgres'], needs: [], then: ['compose', 'run', '--rm', 'db-migrate'] },
  rust: { services: ['player-profile-rust-1', 'player-profile-rust-2', 'envoy'], needs: ['POSTGRES_ADDR'] },
  go: { services: ['match-service-go'], needs: ['POSTGRES_ADDR', 'PLAYER_PROFILE_GRPC_ADDR'] },
  all: { services: [], needs: [] },
};

export function parseEnv(text) {
  const env = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const at = line.indexOf('=');
    env[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return env;
}

// Rewrites KEY= lines of the template in place and appends keys it lacks.
export function renderEnv(template, values) {
  const pending = new Map(Object.entries(values));
  const lines = template.split(/\r?\n/).map(line => {
    const key = line.split('=')[0].trim();
    if (line.trim().startsWith('#') || !line.includes('=') || !pending.has(key)) return line;
    const value = pending.get(key);
    pending.delete(key);
    return `${key}=${value}`;
  });
  while (lines.length && lines.at(-1) === '') lines.pop();
  for (const [key, value] of pending) lines.push(`${key}=${value}`);
  return lines.join('\n') + '\n';
}

export function hostPort(address, port) {
  const value = String(address).trim().replace(/^[a-z]+:\/\//i, '').replace(/\/.*$/, '');
  const at = value.lastIndexOf(':');
  return at > 0 ? { host: value.slice(0, at), port: Number(value.slice(at + 1)) } : { host: value, port: Number(port) };
}

// Values for a new or existing .env. Secrets already present are kept, so every
// machine that receives a copy of the file shares the same credentials.
export function initValues(existing, { db, rust, go } = {}) {
  const values = {};
  for (const key of SECRETS) values[key] = existing[key] || randomBytes(24).toString('hex');
  if (db || rust || go) {
    const dbAddr = db && hostPort(db, LAB_DB_PORT);
    if (dbAddr) values.POSTGRES_PORT = String(dbAddr.port);
    values.POSTGRES_ADDR = dbAddr ? `${dbAddr.host}:${dbAddr.port}` : '';
    const rustAddr = rust && hostPort(rust, existing.ENVOY_GRPC_PORT || 50051);
    values.PLAYER_PROFILE_GRPC_ADDR = rustAddr ? `${rustAddr.host}:${rustAddr.port}` : '';
    const goAddr = go && hostPort(go, existing.GO_HTTP_PORT || 8080);
    values.COMPUNUBE_GO_URL = goAddr ? `http://${goAddr.host}:${goAddr.port}` : '';
  }
  return values;
}

export function composeUp(role, { build = false } = {}) {
  const { services } = ROLES[role];
  return ['compose', 'up', '-d', '--wait', '--wait-timeout', '300', ...(build ? ['--build'] : []),
    ...(role === 'rust' || role === 'go' ? ['--no-deps'] : []), ...services];
}

function flags(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) { out._.push(argv[i]); continue; }
    const key = argv[i].slice(2);
    out[key] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  }
  return out;
}

function die(message, hint) {
  console.error(`\nERROR: ${message}`);
  if (hint) console.error(`  -> ${hint}`);
  process.exit(1);
}

// Like Compose: variables set in the shell win over the .env file.
function loadEnv() {
  return { ...(existsSync(ENV_FILE) ? parseEnv(readFileSync(ENV_FILE, 'utf8')) : {}), ...process.env };
}

function readEnv() {
  if (!existsSync(ENV_FILE)) die('falta el archivo .env en la carpeta del proyecto.', 'Ejecuta "node scripts/lab.mjs init" en UN equipo y copia ese .env a los equipos BD, Rust y Go.');
  const env = loadEnv();
  const missing = SECRETS.filter(key => !env[key]);
  if (missing.length) die(`.env no tiene valor para ${missing.join(', ')}.`, 'Ejecuta "node scripts/lab.mjs init" (conserva lo que ya tenga).');
  return env;
}

export function tcp(host, port, timeout = 3000) {
  return new Promise(resolve => {
    const socket = net.connect({ host, port });
    const done = ok => { socket.destroy(); resolve(ok); };
    socket.setTimeout(timeout, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

async function status(url) {
  try { return (await fetch(url, { signal: AbortSignal.timeout(3000) })).status; } catch { return 0; }
}

async function until(probe, seconds) {
  for (let i = 0; i < seconds; i += 2) {
    if (await probe()) return true;
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  return probe();
}

async function healthyReplicas(adminPort) {
  try {
    const body = await (await fetch(`http://127.0.0.1:${adminPort}/clusters`, { signal: AbortSignal.timeout(3000) })).text();
    return body.split('\n').filter(line => /^player_profile_cluster::.*::health_flags::healthy$/.test(line)).length;
  } catch { return 0; }
}

function docker(args, env = process.env) {
  const result = spawnSync('docker', args, { cwd: ROOT, stdio: 'inherit', env });
  if (result.error) die('no se encontró el comando docker.', 'Instala o abre Docker Desktop.');
  return result.status === 0;
}

function requireDocker() {
  const result = spawnSync('docker', ['info', '--format', '{{.ServerVersion}}'], { cwd: ROOT, encoding: 'utf8' });
  if (result.error || result.status !== 0) die('Docker no responde.', 'Abre Docker Desktop y espera a que diga "Engine running"; luego repite el comando.');
}

async function reach(label, address, hint) {
  const { host, port } = hostPort(address);
  const ok = await tcp(host, port);
  console.log(`  ${ok ? 'OK   ' : 'FALLA'} ${label} ${host}:${port}`);
  if (!ok) die(`no hay conexión con ${label} (${host}:${port}).`, hint);
}

async function init(opts) {
  const existing = existsSync(ENV_FILE) ? parseEnv(readFileSync(ENV_FILE, 'utf8')) : {};
  let { db, rust, go } = opts;
  if (!db && !rust && !go && process.stdin.isTTY) {
    console.log('IP (o nombre) de cada equipo. Deja todo vacío para tener el sistema completo en este equipo.');
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    db = (await rl.question('  Equipo BD   (PostgreSQL): ')).trim();
    rust = (await rl.question('  Equipo Rust (Envoy + 2 réplicas): ')).trim();
    go = (await rl.question('  Equipo Go   (Match Service): ')).trim();
    rl.close();
  }
  const template = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, 'utf8') : readFileSync(path.join(ROOT, '.env.example'), 'utf8');
  writeFileSync(ENV_FILE, renderEnv(template, initValues(existing, { db, rust, go })));
  const values = parseEnv(readFileSync(ENV_FILE, 'utf8'));
  const kept = SECRETS.filter(key => existing[key]).length;
  console.log(`\n.env ${Object.keys(existing).length ? 'actualizado' : 'creado'} (${kept ? 'secretos conservados' : 'secretos nuevos y aleatorios'}; no se muestran).`);
  if (values.POSTGRES_ADDR || values.PLAYER_PROFILE_GRPC_ADDR || values.COMPUNUBE_GO_URL) {
    console.log(`  BD:   ${values.POSTGRES_ADDR || '(sin definir)'}\n  Rust: ${values.PLAYER_PROFILE_GRPC_ADDR || '(sin definir)'}\n  Go:   ${values.COMPUNUBE_GO_URL || '(sin definir)'}`);
    console.log('\nCopia ESTE MISMO .env a la carpeta del proyecto en los equipos BD, Rust y Go (USB o carpeta compartida; nunca por chat ni git).');
    console.log('Luego, en orden: "node scripts/lab.mjs db", "node scripts/lab.mjs rust", "node scripts/lab.mjs go".');
  } else {
    console.log('Siguiente paso (todo en este equipo): node scripts/lab.mjs all');
  }
}

async function up(role, opts) {
  const env = readEnv();
  for (const key of ROLES[role].needs) {
    if (!env[key]) die(`.env no dice dónde está ${key === 'POSTGRES_ADDR' ? 'la BD' : 'Rust (Envoy)'} (${key}).`, 'Ejecuta "node scripts/lab.mjs init --db <ip> --rust <ip> --go <ip>" y copia el .env a este equipo.');
  }
  requireDocker();
  if (ROLES[role].needs.length) console.log('Comprobando que este equipo llega a los demás:');
  if (env.POSTGRES_ADDR && role !== 'db' && role !== 'all') await reach('BD', env.POSTGRES_ADDR, '¿Está arriba el equipo BD ("node scripts/lab.mjs db")? Si lo está, el puerto está bloqueado: revisa la IP y que el admin aprobó Docker Desktop Backend en el firewall del equipo BD.');
  if (role === 'go') await reach('Rust (Envoy)', env.PLAYER_PROFILE_GRPC_ADDR, '¿Está arriba el equipo Rust ("node scripts/lab.mjs rust")? Si lo está, revisa la IP y la aprobación del firewall en ese equipo.');
  console.log(`\nArrancando ${role === 'all' ? 'el sistema completo' : ROLES[role].services.join(', ')} (la primera vez construye las imágenes; puede tardar varios minutos)...`);
  // A single machine (plan B) ignores the lab addresses even if .env has them.
  const local = role === 'all' ? { ...process.env, POSTGRES_ADDR: '', PLAYER_PROFILE_GRPC_ADDR: '' } : process.env;
  if (!docker(composeUp(role, opts), local)) {
    die('Docker Compose no pudo dejar el rol sano.', `Mira los registros: docker compose logs --tail 50 ${ROLES[role].services.join(' ')}`);
  }
  if (ROLES[role].then && !docker(ROLES[role].then, local)) die('Las migraciones de la base de datos fallaron.', 'Revisa el mensaje de arriba; luego repite "node scripts/lab.mjs db".');
  const goPort = env.GO_HTTP_PORT || 8080, adminPort = env.ENVOY_ADMIN_PORT || 9901;
  if (role === 'db') {
    const port = env.POSTGRES_PORT || 5432;
    if (!(await tcp('127.0.0.1', port))) die(`PostgreSQL no escucha en el puerto ${port} de este equipo.`, 'docker compose ps -a postgres');
    console.log(`\nBD lista en el puerto ${port}. Desde el equipo Rust o Go: node scripts/lab.mjs check`);
  }
  if (role === 'rust' || role === 'all') {
    if (!(await until(async () => (await healthyReplicas(adminPort)) === 2, 90))) die(`Envoy no ve las dos réplicas Rust sanas (ve ${await healthyReplicas(adminPort)}).`, 'docker compose logs --tail 50 player-profile-rust-1 player-profile-rust-2');
    console.log('\nRust listo: Envoy ve 2 réplicas sanas.');
  }
  if (role === 'go' || role === 'all') {
    if (!(await until(async () => (await status(`http://127.0.0.1:${goPort}/readyz`)) === 200, 90))) die('Go arrancó, pero /readyz no responde 200 (no llega a la BD o a Rust).', 'docker compose logs --tail 50 match-service-go');
    console.log(`\nGo listo en el puerto ${goPort}. En cada equipo web: node scripts/lab.mjs web --go <ip de este equipo>`);
  }
}

async function web(opts) {
  const env = loadEnv();
  const go = opts.go ? hostPort(opts.go, 8080) : env.COMPUNUBE_GO_URL ? hostPort(env.COMPUNUBE_GO_URL) : { host: '127.0.0.1', port: Number(env.GO_HTTP_PORT || 8080) };
  const url = `http://${go.host}:${go.port}`;
  console.log(`Comprobando Go en ${url} ...`);
  if ((await status(`${url}/readyz`)) !== 200) die(`Go no responde en ${url}/readyz.`, '¿Está arriba el equipo Go ("node scripts/lab.mjs go")? Revisa la IP y prueba: node scripts/lab.mjs check');
  console.log(`Go responde. Abre http://127.0.0.1:${process.env.COMPUNUBE_WEB_PORT || 4173} en el navegador de ESTE equipo (Ctrl+C para parar).\n`);
  const child = spawn(process.execPath, [path.join(ROOT, 'apps', 'web', 'server.mjs')], { cwd: ROOT, stdio: 'inherit', env: { ...process.env, COMPUNUBE_GO_URL: url } });
  child.on('exit', code => process.exit(code ?? 0));
}

async function check(opts) {
  const env = loadEnv();
  const goUrl = opts.go ? `http://${hostPort(opts.go, 8080).host}:${hostPort(opts.go, 8080).port}` : env.COMPUNUBE_GO_URL;
  const rows = [['BD', env.POSTGRES_ADDR], ['Rust (Envoy)', env.PLAYER_PROFILE_GRPC_ADDR], ['Go', goUrl]];
  let failed = false;
  console.log('Conexiones desde este equipo:');
  for (const [label, address] of rows) {
    if (!address) { console.log(`  -     ${label}: no configurado en .env`); continue; }
    const { host, port } = hostPort(address);
    const ok = await tcp(host, port);
    failed ||= !ok;
    console.log(`  ${ok ? 'OK   ' : 'FALLA'} ${label} ${host}:${port}`);
  }
  if (goUrl) {
    const code = await status(`${goUrl}/readyz`);
    failed ||= code !== 200;
    console.log(`  ${code === 200 ? 'OK   ' : 'FALLA'} Go /readyz ${code ? `HTTP ${code}` : 'sin respuesta'}`);
  }
  process.exit(failed ? 1 : 0);
}

const HELP = `Despliegue por roles del laboratorio (docs/deployment/lab-roles.md)

  node scripts/lab.mjs init [--db <ip> --rust <ip> --go <ip>]   crea o actualiza .env (una vez, en un equipo)
  node scripts/lab.mjs db       equipo BD:   PostgreSQL + migraciones
  node scripts/lab.mjs rust     equipo Rust: rust-1, rust-2 y Envoy
  node scripts/lab.mjs go       equipo Go:   Match Service
  node scripts/lab.mjs web [--go <ip>]   equipo cliente: web en http://127.0.0.1:4173
  node scripts/lab.mjs all      todo en este equipo (plan B)
  node scripts/lab.mjs check [--go <ip>]  prueba las conexiones desde este equipo
  node scripts/lab.mjs status   estado de los contenedores de este equipo
  node scripts/lab.mjs stop     detiene los contenedores (conserva la base de datos)

  Añade --build a db/rust/go/all después de actualizar el código.`;

async function main() {
  const opts = flags(process.argv.slice(2));
  const [command] = opts._;
  if (command === 'init') return init(opts);
  if (command in ROLES) return up(command, { build: opts.build === true });
  if (command === 'web') return web(opts);
  if (command === 'check') return check(opts);
  if (command === 'status') { requireDocker(); docker(['compose', 'ps', '-a']); return; }
  if (command === 'stop') { requireDocker(); docker(['compose', 'stop']); return; }
  console.log(HELP);
  if (command && command !== 'help') process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
