// E45 Swagger UI served by server.mjs: the documented spec loads and "Try it
// out" reaches the real Go service on the same origin. Requires COMPUNUBE_GO_URL.
import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

if (!process.env.COMPUNUBE_GO_URL) throw new Error('COMPUNUBE_GO_URL is required for browser E2E (no silent skip)');
const serverFile = fileURLToPath(new URL('../server.mjs', import.meta.url));

test('Swagger UI documents every E45 operation and Try it out reaches Go', async ({ page }, info) => {
  const port = await new Promise(resolve => {
    const probe = net.createServer().listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
  });
  const child = spawn(process.execPath, [serverFile], { env: { ...process.env, COMPUNUBE_WEB_PORT: String(port) }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((resolve, reject) => { child.stdout.once('data', resolve); child.once('exit', reject); });
  try {
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    await page.goto(`http://127.0.0.1:${port}/api-docs`);
    await expect(page.locator('.opblock').first()).toBeVisible({ timeout: 30_000 });
    const operations = await page.locator('.opblock-summary-operation-id').allTextContents();
    expect(operations).toEqual(['createSession', 'getCurrentSession', 'getProfile', 'getCatalog', 'buyItem', 'craftItem',
      'exchangeMaterials', 'equipItem', 'setAppearance', 'createRoom', 'joinRoom', 'openRealtime']);

    const create = page.locator('#operations-Session-createSession');
    await create.locator('.opblock-summary').click();
    await create.getByRole('button', { name: 'Try it out' }).click();
    await create.getByRole('button', { name: 'Execute' }).click();
    await expect(create.locator('.live-responses-table .response-col_status').first()).toHaveText('201', { timeout: 20_000 });

    // The cookie from that call authenticates the next one on the same origin.
    const current = page.locator('#operations-Session-getCurrentSession');
    await current.locator('.opblock-summary').click();
    await current.getByRole('button', { name: 'Try it out' }).click();
    await current.getByRole('button', { name: 'Execute' }).click();
    await expect(current.locator('.live-responses-table .response-col_status').first()).toHaveText('200', { timeout: 20_000 });
    await page.screenshot({ path: info.outputPath('api-docs.png'), fullPage: false });
    expect(errors).toEqual([]);
  } finally {
    child.kill();
  }
});
