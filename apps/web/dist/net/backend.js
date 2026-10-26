// Production wiring of the online adapters to Go's public API on the page origin.
import { createGoHttp } from './http.js';
import { createProfileAdapter } from './profile.js';
export function createGoBackend(options = {}) {
    const http = createGoHttp(options);
    return { http, profileAdapter: createProfileAdapter(http) };
}
