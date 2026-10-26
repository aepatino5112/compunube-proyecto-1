// G56/G59 browser E2E: Chromium and Firefox play one room on the real Go stack
// through the unchanged Surf Club UI. Requires COMPUNUBE_GO_URL.
import { test, expect, chromium, firefox } from '@playwright/test';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

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
  // Software WebGL so headless CI runners can render Three.js.
  const browser = await browserType.launch(browserType === chromium ? { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } : {});
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  const started = Date.now();
  await page.goto(origin);
  await expect(page.locator('#play')).toBeEnabled({ timeout: 120_000 });
  info.annotations.push({ type: name, description: `club ready in ${Date.now() - started} ms` });
  return { browser, page, errors, name };
}

const shot = (client, info, label) => client.page.screenshot({ path: info.outputPath(`${client.name}-${label}.png`) });

test('Chromium host and Firefox guest share a real Go race from the lobby to the confirmed result', async ({}, info) => {
  const web = await startWeb();
  const host = await openClub(chromium, web.origin, 'chromium-host', info);
  const guest = await openClub(firefox, web.origin, 'firefox-guest', info);
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
    for (const client of [host, guest]) await expect(client.page.locator('#online-lobby .ol-count')).toHaveText('2 / 4 surfistas');

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
    // Steering is only an intent; the guest jumps and turns for a while.
    await guest.page.keyboard.down('ArrowLeft');
    await guest.page.keyboard.press('Space');
    await guest.page.waitForTimeout(800);
    await guest.page.keyboard.up('ArrowLeft');

    // Authoritative result in both browsers, then the settlement confirmation.
    for (const client of [host, guest]) {
      await expect(client.page.locator('#card-label')).toContainText('CARRERA CON AMIGOS', { timeout: 150_000 });
    }
    for (const client of [host, guest]) {
      const text = await client.page.locator('#card-text').textContent();
      if (/acreditación está pendiente/.test(text)) {
        await expect(client.page.locator('#card-text')).toContainText('ya recibió', { timeout: 60_000 });
      } else expect(text).toMatch(/ya recibió|no acredita/);
      await shot(client, info, 'result');
      expect(client.errors).toEqual([]);
    }
  } finally {
    await host.browser.close();
    await guest.browser.close();
    web.stop();
  }
});
