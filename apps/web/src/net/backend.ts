// Production wiring of the online adapters to Go's public API on the page origin.
import { createGoHttp, type GoHttpOptions } from './http.js';
import { createProfileAdapter } from './profile.js';

export function createGoBackend(options: GoHttpOptions = {}) {
  const http = createGoHttp(options);
  return { http, profileAdapter: createProfileAdapter(http) };
}
