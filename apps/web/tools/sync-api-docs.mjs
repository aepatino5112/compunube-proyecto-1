// Publishes the E45 OpenAPI contract with Swagger UI at /api-docs/. The spec is
// a byte-identical copy of contracts/http/openapi.yaml and the UI assets come
// from the pinned swagger-ui-dist package; CI fails if the copies drift.
import { copyFile, mkdir } from 'node:fs/promises';

const target = new URL('../dist/api-docs/', import.meta.url);
const ui = new URL('../node_modules/swagger-ui-dist/', import.meta.url);
await mkdir(target, { recursive: true });
await copyFile(new URL('../../../contracts/http/openapi.yaml', import.meta.url), new URL('openapi.yaml', target));
for (const name of ['swagger-ui-bundle.js', 'swagger-ui.css', 'favicon-32x32.png', 'LICENSE', 'NOTICE']) {
  await copyFile(new URL(name, ui), new URL(name, target));
}
console.log('api-docs: openapi.yaml + swagger-ui-dist assets -> dist/api-docs/');
