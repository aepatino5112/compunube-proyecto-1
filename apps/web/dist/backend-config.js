// Production adapters for Go's public API on this page's origin (E45 + E43).
// server.mjs forwards /v1 to the Go Match Service when COMPUNUBE_GO_URL is set;
// otherwise the online paths answer 503 and the local demo keeps working.
import { createGoBackend } from './net/backend.js';

const backend = createGoBackend();
// Rooms and realtime are connected by G59; until then "Con amigos" stays offline.
export const backendAdapter = null;
// Same authenticated session as the room adapter; see PROFILE_ADAPTER.md.
export const profileAdapter = backend.profileAdapter;
