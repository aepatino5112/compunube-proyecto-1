// Same-origin E45 client. The browser authenticates with Go's HttpOnly session
// cookie; this module never reads, stores or sends the session token itself.
import { DEFINITIVE_CODES, UNCERTAIN_CODE } from './e45.js';
/** status 0 is a transport failure: the request may or may not have reached Go. */
export class GoApiError extends Error {
    status;
    code;
    requestId;
    constructor(status, code, requestId) {
        super(`${status} ${code}`);
        this.name = 'GoApiError';
        this.status = status;
        this.code = code;
        this.requestId = requestId;
    }
    /** True when a definitive E45 answer says the operation was not applied. */
    get definitive() {
        return this.status >= 400 && this.status < 500 && DEFINITIVE_CODES.has(this.code);
    }
    get uncertain() {
        return this.status === 0 || this.code === UNCERTAIN_CODE || !this.definitive;
    }
}
const text = (value) => typeof value === 'string' && value.length > 0 && value.length <= 128;
export function createGoHttp({ baseUrl = '', fetch = globalThis.fetch.bind(globalThis) } = {}) {
    let playerId = null;
    let establishing = null;
    async function request(method, path, body, signal) {
        const headers = { Accept: 'application/json' };
        const init = { method, headers, credentials: 'same-origin', cache: 'no-store' };
        if (signal)
            init.signal = signal;
        if (body !== undefined) {
            headers['Content-Type'] = 'application/json';
            init.body = JSON.stringify(body);
        }
        let response;
        try {
            response = await fetch(baseUrl + path, init);
        }
        catch {
            throw new GoApiError(0, 'TRANSPORT_ERROR');
        }
        let payload = null;
        try {
            payload = await response.json();
        }
        catch { /* handled below */ }
        if (!response.ok) {
            const envelope = (payload ?? {});
            const code = text(envelope.code) ? envelope.code : response.status === 504 ? UNCERTAIN_CODE : 'HTTP_ERROR';
            throw new GoApiError(response.status, code, text(envelope.requestId) ? envelope.requestId : undefined);
        }
        if (payload === null || typeof payload !== 'object')
            throw new GoApiError(0, 'INVALID_RESPONSE');
        return payload;
    }
    async function establish(signal) {
        try {
            const current = await request('GET', '/v1/sessions/current', undefined, signal);
            if (text(current.playerId))
                return current.playerId;
        }
        catch (error) {
            if (!(error instanceof GoApiError) || error.code !== 'SESSION_REQUIRED')
                throw error;
        }
        // Go issues both identity and HttpOnly cookie; the returned token is ignored.
        const created = await request('POST', '/v1/sessions', undefined, signal);
        if (!text(created.playerId))
            throw new GoApiError(0, 'INVALID_RESPONSE');
        return created.playerId;
    }
    return {
        request,
        get playerId() { return playerId; },
        async ensureSession(signal) {
            if (playerId)
                return playerId;
            establishing ??= establish(signal).finally(() => { establishing = null; });
            playerId = await establishing;
            return playerId;
        },
    };
}
