// Production wiring of the online adapters to Go's public API on the page origin.
import { createGoHttp } from './http.js';
import { createProfileAdapter } from './profile.js';
import { createRoomsAdapter } from './realtime.js';
export function createGoBackend(options = {}) {
    const http = createGoHttp(options);
    let rooms = null;
    return {
        http,
        profileAdapter: createProfileAdapter(http),
        // Same session cookie for rooms, realtime and profile; created on first use
        // because the default WebSocket URL comes from the page location.
        get backendAdapter() { return (rooms ??= createRoomsAdapter(http, options.realtime)); },
    };
}
