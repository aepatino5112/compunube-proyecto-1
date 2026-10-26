// G56/G59 E2E: two independent browsers and the Python client race in one
// room on the real Go stack, through the unchanged Surf Club UI and the Python
// CLI. Requires COMPUNUBE_GO_URL and the Python client's pinned dependencies.
// Headless Firefox on the CI runner cannot create a WebGL context, which the
// game needs, so both browsers are separate Chromium processes.
import { test, expect, chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const GO = process.env.COMPUNUBE_GO_URL;
if (!GO) throw new Error('COMPUNUBE_GO_URL is required for browser E2E (no silent skip)');
const serverFile = fileURLToPath(new URL('../server.mjs', import.meta.url));

async function startWeb() {
  const port = await new Promise(resolve => {
    const probe = net.createServer().listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
  });
  const child = spawn(process.execPath, [serverFile], { env: { ...process.env, COMPUNUBE_WEB_PORT: String(port) }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((resolve, reject) => { child.stdout.once('data', resolve); child.once('exit', reject); });
  return { origin: `http://127.0.0.1:${port}`, stop: () => child.kill() };
}

async function openClub(browserType, origin, name, info) {
  // Software WebGL so headless CI runners (no GPU) can render Three.js.
  const browser = await browserType.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  // CI renders in software: a small viewport and reduced motion keep two
  // browsers fast enough to apply 10 Hz snapshots in real time.
  const page = await browser.newPage({ viewport: { width: 640, height: 400 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  const errors = [], consoleLines = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => { if (['error', 'warning'].includes(message.type())) consoleLines.push(`${message.type()}: ${message.text()}`.slice(0, 300)); });
  const started = Date.now();
  await page.goto(origin);
  try {
    await expect(page.locator('#play')).toBeEnabled({ timeout: 180_000 });
  } catch (error) {
    const webgl = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
      return gl ? gl.getParameter(gl.VERSION) : 'no WebGL context';
    }).catch(() => 'evaluate failed');
    info.annotations.push({ type: `${name} diagnostics`, description: JSON.stringify({ webgl, errors, console: consoleLines.slice(-15) }) });
    console.log(`${name} did not finish loading:`, webgl, errors, consoleLines.slice(-15));
    throw error;
  }
  info.annotations.push({ type: name, description: `club ready in ${Date.now() - started} ms` });
  return { browser, page, errors, name };
}

const shot = (client, info, label) => client.page.screenshot({ path: info.outputPath(`${client.name}-${label}.png`) });

function startPythonClient(roomId) {
  const cwd = path.resolve(fileURLToPath(new URL('../../client-secondary/', import.meta.url)));
  const child = spawn(process.env.PYTHON || 'python3', ['-m', 'compunube_client', '--server', GO, 'play', '--join', roomId, '--reduce', 'reusable'],
    { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const done = new Promise(resolve => child.once('exit', code => resolve({ code, output })));
  return { done, stop: () => child.kill(), get output() { return output; } };
}

test('two browsers and the Python client share a real Go race from the lobby to the confirmed result', async ({}, info) => {
  const web = await startWeb();
  const host = await openClub(chromium, web.origin, 'browser-host', info);
  const guest = await openClub(chromium, web.origin, 'browser-guest', info);
  let python = null;
  try {
    // Host: "Con amigos" loads the Go profile (session cookie) and creates a room.
    await host.page.click('#play-friends');
    await expect(host.page.locator('#online-lobby')).toBeVisible();
    await host.page.click('#online-lobby .ol-enter');
    const code = host.page.locator('#online-share-code');
    await expect(code).not.toHaveValue('', { timeout: 20_000 });
    const roomId = await code.inputValue();

    // Guest joins with the shared code.
    await guest.page.click('#play-friends');
    await expect(guest.page.locator('#online-lobby')).toBeVisible();
    await guest.page.click('#online-lobby [data-ol-mode="join"]');
    await guest.page.fill('#online-room-code', roomId);
    await guest.page.click('#online-lobby .ol-enter');
    await expect(guest.page.locator('#online-share-code')).toHaveValue(roomId, { timeout: 20_000 });
    // The secondary client joins the same room through Go's public API only.
    python = startPythonClient(roomId);
    for (const client of [host, guest]) await expect(client.page.locator('#online-lobby .ol-count')).toHaveText('3 / 4 surfistas', { timeout: 30_000 });

    // Ready needs the Reducir choice; Go confirms it through room.state.
    for (const client of [host, guest]) await expect(client.page.locator('#online-lobby .ol-ready')).toBeDisabled();
    await host.page.click('#online-lobby [data-ol-reduce="reusable"]');
    await guest.page.click('#online-lobby [data-ol-reduce="disposable"]');
    await shot(host, info, 'lobby');
    for (const client of [host, guest]) await client.page.click('#online-lobby .ol-ready');
    await expect(host.page.locator('#online-lobby .ol-reduce-note')).toContainText('La sala confirmó tu botella reutilizable', { timeout: 15_000 });

    // Countdown (3 s) and race.start: both switch to the race scene.
    for (const client of [host, guest]) {
      await expect(client.page.locator('#race')).toBeVisible({ timeout: 30_000 });
      await expect(client.page.locator('.topbar')).toHaveAttribute('data-race-location', /CON AMIGOS/);
    }
    await host.page.waitForTimeout(4000);
    await shot(host, info, 'race');
    await shot(guest, info, 'race');
    // No key presses here: once the result arrives the card focuses
    // "Visitar el club", and Space would activate it.

    // Authoritative result in both browsers, then the settlement confirmation.
    for (const client of [host, guest]) {
      await expect(client.page.locator('#card-label')).toContainText('CARRERA CON AMIGOS', { timeout: 240_000 });
    }
    for (const client of [host, guest]) {
      const text = await client.page.locator('#card-text').textContent();
      if (/acreditación está pendiente/.test(text)) {
        await expect(client.page.locator('#card-text')).toContainText('ya recibió', { timeout: 60_000 });
      } else expect(text).toMatch(/ya recibió|no acredita/);
      await shot(client, info, 'result');
      expect(client.errors).toEqual([]);
    }
    const py = await python.done;
    info.annotations.push({ type: 'python-client', description: py.output.slice(-1500) });
    expect(py.code, py.output).toBe(0);
    expect(py.output).toContain('Resultado de la carrera');
    expect(py.output).toMatch(/Settlement de tu participación: (confirmed|pending)/);
  } finally {
    if (python) console.log(`python client output:\n${python.output.slice(-3000)}`);
    python?.stop();
    await host.browser.close();
    await guest.browser.close();
    web.stop();
  }
});
