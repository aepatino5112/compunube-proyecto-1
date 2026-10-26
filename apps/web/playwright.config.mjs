// Browser E2E against a running Go stack (CI Integration). Not part of `npm test`.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 600_000,
  workers: 1,
  reporter: [['list']],
  outputDir: 'e2e-results',
});
