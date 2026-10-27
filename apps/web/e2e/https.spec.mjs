// H66: a browser plays online through server.mjs over HTTPS, as a browser on
// another lab machine would. The Secure, HttpOnly session cookie travels only
// over HTTPS and Go accepts this page's origin from PUBLIC_ORIGINS. Requires
// COMPUNUBE_GO_URL, COMPUNUBE_HTTPS_ORIGIN (listed in Go's PUBLIC_ORIGINS) and
// openssl. The self-signed certificate is accepted by this test's browser only.
import { test, expect, chromium } from '@playwright/test';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ORIGIN = process.env.COMPUNUBE_HTTPS_ORIGIN;
if (!process.env.COMPUNUBE_GO_URL || !ORIGIN) throw new Error('COMPUNUBE_GO_URL and COMPUNUBE_HTTPS_ORIGIN are required (no silent skip)');
const origin = new URL(ORIGIN);
const repo = fileURLToPath(new URL('../../../', import.meta.url));

test('a browser enters the online lobby and creates a room over HTTPS', async ({}, info) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'compunube-tls-'));
  execFileSync('sh', [path.join(repo, 'scripts/deploy/web-tls-cert.sh'), dir, origin.hostname, 'localhost'], { stdio: 'ignore' });
  const web = spawn(process.execPath, [path.join(repo, 'apps/web/server.mjs')], {
    env: { ...process.env, COMPUNUBE_WEB_PORT: origin.port, COMPUNUBE_TLS_CERT: path.join(dir, 'web.crt'), COMPUNUBE_TLS_KEY: path.join(dir, 'web.key') },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    await new Promise((resolve, reject) => { web.stdout.once('data', resolve); web.once('exit', reject); });
    const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 640, height: 400 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    await page.goto(ORIGIN);
    await expect(page.locator('#play')).toBeEnabled({ timeout: 180_000 });
    await page.click('#title-club');

    await page.click('#play-friends');
    await expect(page.locator('#online-lobby')).toBeVisible({ timeout: 30_000 });
    await page.click('#online-lobby .ol-enter');
    await expect(page.locator('#online-share-code')).not.toHaveValue('', { timeout: 20_000 });
    await page.screenshot({ path: info.outputPath('https-lobby.png') });

    expect(await page.evaluate(() => location.protocol)).toBe('https:');
    expect(await page.evaluate(() => document.cookie)).not.toContain('compunube_session');
    const session = (await context.cookies()).find(cookie => cookie.name === 'compunube_session');
    expect(session?.secure && session.httpOnly && session.sameSite === 'Strict').toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
    web.kill();
    rmSync(dir, { recursive: true, force: true });
  }
});
