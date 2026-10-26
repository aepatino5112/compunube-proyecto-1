// Production wiring of the online adapters to Go's public API on the page origin.
import { createGoHttp, type GoHttpOptions } from './http.js';
import { createProfileAdapter } from './profile.js';
import { createRoomsAdapter, type RealtimeOptions } from './realtime.js';

export function createGoBackend(options: GoHttpOptions & { realtime?: RealtimeOptions } = {}) {
  const http = createGoHttp(options);
  let rooms: ReturnType<typeof createRoomsAdapter> | null = null;
  return {
    http,
    profileAdapter: createProfileAdapter(http),
    // Same session cookie for rooms, realtime and profile; created on first use
    // because the default WebSocket URL comes from the page location.
    get backendAdapter() { return (rooms ??= createRoomsAdapter(http, options.realtime)); },
  };
}
