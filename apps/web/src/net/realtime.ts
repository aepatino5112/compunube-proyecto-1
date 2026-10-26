// E43 realtime transport and production BackendAdapter for multiplayer-client.
// Rooms are created/joined over E45; state, readiness, inputs and race flow use
// the WebSocket /v1/realtime (subprotocol compunube.realtime.v1). The browser
// authenticates with Go's same-origin session cookie during the handshake.
import type { REALTIME_SUBPROTOCOL, RoomState, ServerRealtimeMessage } from '../../../../contracts/realtime/v1.js';
import type { RoomMembership } from './e45.js';
import { GoApiError, type GoHttp } from './http.js';
import * as translate from './translate.js';

export const SUBPROTOCOL: typeof REALTIME_SUBPROTOCOL = 'compunube.realtime.v1';
const OPEN = 1;

type Message = Record<string, unknown>;
type SocketFactory = (url: string, protocols: string[]) => WebSocket;

export interface RealtimeOptions {
  url?: string;
  createSocket?: SocketFactory;
  openTimeoutMs?: number;
}

/** The session object multiplayer-client expects (docs/backend/FRONT_ADAPTER.md). */
export interface RoomSession {
  selfPlayerId: string;
  room: translate.InternalRoom;
  send(message: Message): boolean | undefined;
  subscribe(onMessage: (message: Message) => void, onDisconnect: (code?: string) => void): () => void;
  close(): void;
}

const fail = (code: string) => new GoApiError(0, code);
const record = (value: unknown): value is Message => !!value && typeof value === 'object' && !Array.isArray(value);

function defaultUrl(): string {
  const { protocol, host } = globalThis.location;
  return `${protocol === 'https:' ? 'wss' : 'ws'}://${host}/v1/realtime`;
}

function openSocket(url: string, create: SocketFactory, timeoutMs: number, signal?: AbortSignal): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    let socket: WebSocket;
    try { socket = create(url, [SUBPROTOCOL]); } catch { reject(fail('CONNECTION_FAILED')); return; }
    const done = (error: GoApiError | null) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      socket.removeEventListener('open', opened);
      socket.removeEventListener('error', failed);
      socket.removeEventListener('close', failed);
      if (error) { try { socket.close(); } catch { /* already closed */ } reject(error); } else resolve(socket);
    };
    // A server that does not accept the subprotocol is an incompatible version.
    const opened = () => done(socket.protocol === SUBPROTOCOL ? null : fail('INCOMPATIBLE_VERSION'));
    const failed = () => done(fail('CONNECTION_FAILED'));
    const abort = () => done(fail('CANCELLED'));
    const timer = setTimeout(() => done(fail('TIMEOUT')), timeoutMs);
    socket.addEventListener('open', opened);
    socket.addEventListener('error', failed);
    socket.addEventListener('close', failed);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

interface Settings {
  url: () => string;
  createSocket: SocketFactory;
  openTimeoutMs: number;
}

class Link {
  private socket: WebSocket | null = null;
  private buffer: Message[] = [];
  private onMessage: ((message: Message) => void) | null = null;
  private onDisconnect: ((code?: string) => void) | null = null;
  private closed = false;
  room: RoomState | null = null;
  private stateWaiters: Array<(room: RoomState) => void> = [];

  constructor(readonly selfPlayerId: string, readonly roomId: string | null,
    private readonly options: Settings) {}

  attach(socket: WebSocket) {
    this.socket = socket;
    socket.addEventListener('message', event => this.receive(event.data));
    // Reentry inside the race window is not implemented yet: a lost channel ends the session.
    socket.addEventListener('close', () => { if (this.socket === socket) this.disconnect('DISCONNECTED'); });
  }

  waitForRoom(timeoutMs: number): Promise<RoomState | null> {
    if (this.room) return Promise.resolve(this.room);
    return new Promise(resolve => {
      const timer = setTimeout(() => resolve(null), timeoutMs);
      this.stateWaiters.push(room => { clearTimeout(timer); resolve(room); });
    });
  }

  private emit(message: Message) {
    if (this.onMessage) this.onMessage(message); else this.buffer.push(message);
  }

  private receive(data: unknown) {
    if (this.closed) return;
    let message: unknown;
    try { message = JSON.parse(String(data)); } catch { this.disconnect('INVALID_RESPONSE'); return; }
    if (!record(message) || message.protocolVersion !== 1) {
      // multiplayer-client turns a foreign protocolVersion into INCOMPATIBLE_VERSION.
      if (record(message)) this.emit(message); else this.disconnect('INVALID_RESPONSE');
      return;
    }
    try {
      this.translate(message as unknown as ServerRealtimeMessage);
    } catch {
      this.disconnect('INVALID_RESPONSE');
    }
  }

  private translate(message: ServerRealtimeMessage) {
    switch (message.type) {
      case 'room.state': {
        const { room } = message;
        if (message.selfPlayerId !== this.selfPlayerId || (this.roomId && room.roomId !== this.roomId)) {
          this.disconnect('INVALID_RESPONSE'); return;
        }
        if (room.state === 'CLOSED') { this.disconnect('ROOM_CLOSED'); return; }
        if (!room.members.some(member => member.playerId === this.selfPlayerId)) { this.disconnect('NOT_A_MEMBER'); return; }
        this.room = room;
        this.emit({ type: 'room.state', protocolVersion: 1, selfPlayerId: message.selfPlayerId, room: translate.roomState(room) });
        for (const resolve of this.stateWaiters.splice(0)) resolve(room);
        return;
      }
      case 'race.start':
        this.emit(translate.raceStart(message, this.room) as unknown as Message);
        return;
      case 'race.snapshot':
        this.emit({ type: 'race.snapshot', protocolVersion: 1, snapshot: translate.raceSnapshot(message.snapshot) });
        return;
      case 'race.event':
        this.emit({ type: 'race.event', protocolVersion: 1, event: translate.raceEvent(message.event) });
        return;
      case 'race.ended':
        this.emit({ type: 'race.ended', protocolVersion: 1, result: translate.raceResult(message.result) });
        return;
      case 'error':
        this.emit({ type: 'error', protocolVersion: 1, error: { ...message.error } });
        if (message.error.fatal) this.disconnect(message.error.code);
        return;
      default:
        // v1 clients ignore unknown additive message types.
        return;
    }
  }

  disconnect(code?: string) {
    if (this.closed) return;
    this.close();
    this.onDisconnect?.(code);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    const socket = this.socket;
    this.socket = null;
    try { socket?.close(1000); } catch { /* already closed */ }
  }

  session(room: translate.InternalRoom): RoomSession {
    return {
      selfPlayerId: this.selfPlayerId,
      room,
      send: message => {
        if (this.closed || this.socket?.readyState !== OPEN) return false;
        this.socket.send(JSON.stringify(message));
        return true;
      },
      subscribe: (onMessage, onDisconnect) => {
        this.onMessage = onMessage; this.onDisconnect = onDisconnect;
        for (const message of this.buffer.splice(0)) {
          if (this.onMessage !== onMessage) break;
          onMessage(message);
        }
        return () => {
          if (this.onMessage === onMessage) { this.onMessage = null; this.onDisconnect = null; }
        };
      },
      close: () => this.close(),
    };
  }
}

export function createRoomsAdapter(http: GoHttp, options: RealtimeOptions = {}) {
  const settings: Settings = {
    // Resolved on use: the default comes from the page location.
    url: () => options.url ?? defaultUrl(),
    createSocket: options.createSocket ?? ((url: string, protocols: string[]) => new WebSocket(url, protocols)),
    openTimeoutMs: options.openTimeoutMs ?? 8000,
  };

  async function connect(membership: RoomMembership, signal?: AbortSignal): Promise<RoomSession> {
    const link = new Link(membership.playerId, membership.roomId, settings);
    link.attach(await openSocket(settings.url(), settings.createSocket, settings.openTimeoutMs, signal));
    const room = await link.waitForRoom(settings.openTimeoutMs);
    const internal = room && translate.roomState(room);
    if (!internal || signal?.aborted) { link.close(); throw fail(signal?.aborted ? 'CANCELLED' : 'TIMEOUT'); }
    return link.session(internal);
  }

  return {
    async createRoom(intent: { mapId: 'maracaibo' | 'orinoco' }, { signal }: { signal?: AbortSignal } = {}) {
      await http.ensureSession(signal);
      const membership = await http.request<RoomMembership>('POST', '/v1/rooms', { mapId: intent.mapId }, signal);
      return connect(membership, signal);
    },

    async joinRoom(intent: { roomId: string }, { signal }: { signal?: AbortSignal } = {}) {
      await http.ensureSession(signal);
      const membership = await http.request<RoomMembership>('POST', `/v1/rooms/${encodeURIComponent(intent.roomId)}/memberships`, undefined, signal);
      return connect(membership, signal);
    },
  };
}
