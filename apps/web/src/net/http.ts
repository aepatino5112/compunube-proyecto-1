// Same-origin E45 client. The browser authenticates with Go's HttpOnly session
// cookie; this module never reads, stores or sends the session token itself.
import { DEFINITIVE_CODES, UNCERTAIN_CODE, type ApiErrorEnvelope, type SessionIdentity } from './e45.js';

export type Fetch = (input: string, init: RequestInit) => Promise<Response>;

export interface GoHttpOptions {
  /** Origin of the public Go API. Empty means the page's own origin. */
  baseUrl?: string;
  fetch?: Fetch;
}

/** status 0 is a transport failure: the request may or may not have reached Go. */
export class GoApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | undefined;

  constructor(status: number, code: string, requestId?: string) {
    super(`${status} ${code}`);
    this.name = 'GoApiError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }

  /** True when a definitive E45 answer says the operation was not applied. */
  get definitive(): boolean {
    return this.status >= 400 && this.status < 500 && DEFINITIVE_CODES.has(this.code);
  }

  get uncertain(): boolean {
    return this.status === 0 || this.code === UNCERTAIN_CODE || !this.definitive;
  }
}

const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 128;

export interface GoHttp {
  request<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T>;
  ensureSession(signal?: AbortSignal): Promise<string>;
  readonly playerId: string | null;
}

export function createGoHttp({ baseUrl = '', fetch = globalThis.fetch.bind(globalThis) }: GoHttpOptions = {}): GoHttp {
  let playerId: string | null = null;
  let establishing: Promise<string> | null = null;

  async function request<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    const init: RequestInit = { method, headers, credentials: 'same-origin', cache: 'no-store' };
    if (signal) init.signal = signal;
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    let response: Response;
    try {
      response = await fetch(baseUrl + path, init);
    } catch {
      throw new GoApiError(0, 'TRANSPORT_ERROR');
    }
    let payload: unknown = null;
    try { payload = await response.json(); } catch { /* handled below */ }
    if (!response.ok) {
      const envelope = (payload ?? {}) as Partial<ApiErrorEnvelope>;
      const code = text(envelope.code) ? envelope.code : response.status === 504 ? UNCERTAIN_CODE : 'HTTP_ERROR';
      throw new GoApiError(response.status, code, text(envelope.requestId) ? envelope.requestId : undefined);
    }
    if (payload === null || typeof payload !== 'object') throw new GoApiError(0, 'INVALID_RESPONSE');
    return payload as T;
  }

  async function establish(signal?: AbortSignal): Promise<string> {
    try {
      const current = await request<SessionIdentity>('GET', '/v1/sessions/current', undefined, signal);
      if (text(current.playerId)) return current.playerId;
    } catch (error) {
      if (!(error instanceof GoApiError) || error.code !== 'SESSION_REQUIRED') throw error;
    }
    // Go issues both identity and HttpOnly cookie; the returned token is ignored.
    const created = await request<SessionIdentity>('POST', '/v1/sessions', undefined, signal);
    if (!text(created.playerId)) throw new GoApiError(0, 'INVALID_RESPONSE');
    return created.playerId;
  }

  return {
    request,
    get playerId() { return playerId; },
    async ensureSession(signal) {
      if (playerId) return playerId;
      establishing ??= establish(signal).finally(() => { establishing = null; });
      playerId = await establishing;
      return playerId;
    },
  };
}
