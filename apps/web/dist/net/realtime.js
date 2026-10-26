import { GoApiError } from './http.js';
import * as translate from './translate.js';
export const SUBPROTOCOL = 'compunube.realtime.v1';
const OPEN = 1;
const fail = (code) => new GoApiError(0, code);
const record = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
function defaultUrl() {
    const { protocol, host } = globalThis.location;
    return `${protocol === 'https:' ? 'wss' : 'ws'}://${host}/v1/realtime`;
}
async function defaultManifest(courseVersion, signal) {
    const init = { cache: 'no-store' };
    if (signal)
        init.signal = signal;
    const response = await fetch(`courses/${encodeURIComponent(courseVersion)}.json`, init);
    if (!response.ok)
        throw fail('INVALID_RESPONSE');
    return await response.json();
}
function openSocket(url, create, timeoutMs, signal) {
    return new Promise((resolve, reject) => {
        let socket;
        try {
            socket = create(url, [SUBPROTOCOL]);
        }
        catch {
            reject(fail('CONNECTION_FAILED'));
            return;
        }
        const done = (error) => {
            clearTimeout(timer);
            signal?.removeEventListener('abort', abort);
            socket.removeEventListener('open', opened);
            socket.removeEventListener('error', failed);
            socket.removeEventListener('close', failed);
            if (error) {
                try {
                    socket.close();
                }
                catch { /* already closed */ }
                reject(error);
            }
            else
                resolve(socket);
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
class Link {
    selfPlayerId;
    roomId;
    options;
    socket = null;
    buffer = [];
    onMessage = null;
    onDisconnect = null;
    onStatus = null;
    closed = false;
    reconnecting = false;
    stateTimer = null;
    room = null;
    snapshot = null;
    stateWaiters = [];
    constructor(selfPlayerId, roomId, options) {
        this.selfPlayerId = selfPlayerId;
        this.roomId = roomId;
        this.options = options;
    }
    attach(socket) {
        this.socket = socket;
        socket.addEventListener('message', event => this.receive(event.data));
        socket.addEventListener('close', () => { if (this.socket === socket)
            void this.lost(); });
    }
    waitForRoom(timeoutMs) {
        if (this.room)
            return Promise.resolve(this.room);
        return new Promise(resolve => {
            const timer = setTimeout(() => resolve(null), timeoutMs);
            this.stateWaiters.push(room => { clearTimeout(timer); resolve(room); });
        });
    }
    emit(message) {
        if (this.onMessage)
            this.onMessage(message);
        else
            this.buffer.push(message);
    }
    /** Insert a message before anything received after the current buffer head. */
    prepend(message, afterRoomState = true) {
        const index = afterRoomState ? this.buffer.findIndex(item => item.type === 'room.state') + 1 : 0;
        this.buffer.splice(index, 0, message);
    }
    receive(data) {
        if (this.closed)
            return;
        let message;
        try {
            message = JSON.parse(String(data));
        }
        catch {
            this.disconnect('INVALID_RESPONSE');
            return;
        }
        if (!record(message) || message.protocolVersion !== 1) {
            // multiplayer-client turns a foreign protocolVersion into INCOMPATIBLE_VERSION.
            if (record(message))
                this.emit(message);
            else
                this.disconnect('INVALID_RESPONSE');
            return;
        }
        try {
            this.translate(message);
        }
        catch {
            this.disconnect('INVALID_RESPONSE');
        }
    }
    translate(message) {
        switch (message.type) {
            case 'room.state': {
                const { room } = message;
                if (message.selfPlayerId !== this.selfPlayerId || (this.roomId && room.roomId !== this.roomId)) {
                    this.disconnect('INVALID_RESPONSE');
                    return;
                }
                if (room.state === 'CLOSED') {
                    this.disconnect('ROOM_CLOSED');
                    return;
                }
                if (!room.members.some(member => member.playerId === this.selfPlayerId)) {
                    this.disconnect('NOT_A_MEMBER');
                    return;
                }
                this.room = room;
                if (this.stateTimer) {
                    clearTimeout(this.stateTimer);
                    this.stateTimer = null;
                }
                this.emit({ type: 'room.state', protocolVersion: 1, selfPlayerId: message.selfPlayerId, room: translate.roomState(room) });
                for (const resolve of this.stateWaiters.splice(0))
                    resolve(room);
                return;
            }
            case 'race.start':
                this.emit(translate.raceStart(message, this.room));
                return;
            case 'race.snapshot':
                this.snapshot = message.snapshot;
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
                if (message.error.fatal)
                    this.disconnect(message.error.code);
                return;
            default:
                // v1 clients ignore unknown additive message types.
                return;
        }
    }
    async lost() {
        if (this.closed || this.reconnecting)
            return;
        if (!this.room) {
            this.disconnect('DISCONNECTED');
            return;
        }
        this.reconnecting = true;
        this.onStatus?.('reconnecting');
        const deadline = Date.now() + this.options.reentryWindowMs;
        let delay = 250;
        while (!this.closed && Date.now() < deadline) {
            try {
                const socket = await openSocket(this.options.url(), this.options.createSocket, Math.min(this.options.openTimeoutMs, Math.max(500, deadline - Date.now())));
                if (this.closed) {
                    socket.close(1000);
                    return;
                }
                this.reconnecting = false;
                this.attach(socket);
                // Go rebinds the identity and replays room.state (+ snapshot or result).
                this.stateTimer = setTimeout(() => this.disconnect('NOT_A_MEMBER'), this.options.stateTimeoutMs);
                this.onStatus?.('live');
                return;
            }
            catch {
                await new Promise(resolve => setTimeout(resolve, delay));
                delay = Math.min(2000, delay * 2);
            }
        }
        this.reconnecting = false;
        this.disconnect('DISCONNECTED');
    }
    disconnect(code) {
        if (this.closed)
            return;
        this.close();
        this.onDisconnect?.(code);
    }
    close() {
        if (this.closed)
            return;
        this.closed = true;
        if (this.stateTimer)
            clearTimeout(this.stateTimer);
        const socket = this.socket;
        this.socket = null;
        try {
            socket?.close(1000);
        }
        catch { /* already closed */ }
    }
    session(room) {
        return {
            selfPlayerId: this.selfPlayerId,
            room,
            send: message => {
                if (this.closed)
                    return false;
                // While the channel is being reopened, intents are dropped: Go keeps the
                // last valid intent, and readiness is confirmed only by a later room.state.
                if (this.reconnecting || this.socket?.readyState !== OPEN)
                    return undefined;
                this.socket.send(JSON.stringify(message));
                return true;
            },
            subscribe: (onMessage, onDisconnect, onStatus) => {
                this.onMessage = onMessage;
                this.onDisconnect = onDisconnect;
                this.onStatus = onStatus ?? null;
                for (const message of this.buffer.splice(0)) {
                    if (this.onMessage !== onMessage)
                        break;
                    onMessage(message);
                }
                return () => {
                    if (this.onMessage === onMessage) {
                        this.onMessage = null;
                        this.onDisconnect = null;
                        this.onStatus = null;
                    }
                };
            },
            close: () => this.close(),
        };
    }
}
export function createRoomsAdapter(http, options = {}) {
    const settings = {
        // Resolved on use: the default comes from the page location.
        url: () => options.url ?? defaultUrl(),
        createSocket: options.createSocket ?? ((url, protocols) => new WebSocket(url, protocols)),
        openTimeoutMs: options.openTimeoutMs ?? 8000,
        reentryWindowMs: options.reentryWindowMs ?? 15000,
        stateTimeoutMs: options.stateTimeoutMs ?? 3000,
    };
    const loadManifest = options.loadManifest ?? defaultManifest;
    async function connect(membership, signal) {
        const link = new Link(membership.playerId, membership.roomId, settings);
        link.attach(await openSocket(settings.url(), settings.createSocket, settings.openTimeoutMs, signal));
        const room = await link.waitForRoom(settings.openTimeoutMs);
        const internal = room && translate.roomState(room);
        if (!internal || signal?.aborted) {
            link.close();
            throw fail(signal?.aborted ? 'CANCELLED' : 'TIMEOUT');
        }
        return link.session(internal);
    }
    return {
        async createRoom(intent, { signal } = {}) {
            await http.ensureSession(signal);
            const membership = await http.request('POST', '/v1/rooms', { mapId: intent.mapId }, signal);
            return connect(membership, signal);
        },
        async joinRoom(intent, { signal } = {}) {
            await http.ensureSession(signal);
            const membership = await http.request('POST', `/v1/rooms/${encodeURIComponent(intent.roomId)}/memberships`, undefined, signal);
            return connect(membership, signal);
        },
        /**
         * Reentry after a reload: with a still-valid session, Go rebinds the identity
         * to its room and replays room.state (+ snapshot during RACING, + result in
         * RESULTS). Resolves null when there is no session or no room to recover.
         */
        async resume({ signal } = {}) {
            let playerId;
            try {
                playerId = (await http.request('GET', '/v1/sessions/current', undefined, signal)).playerId;
            }
            catch (error) {
                if (error instanceof GoApiError && (error.code === 'SESSION_REQUIRED' || error.status === 503))
                    return null;
                throw error;
            }
            const link = new Link(playerId, null, settings);
            try {
                link.attach(await openSocket(settings.url(), settings.createSocket, settings.openTimeoutMs, signal));
            }
            catch {
                return null;
            }
            const room = await link.waitForRoom(settings.stateTimeoutMs);
            const internal = room && translate.roomState(room);
            if (!room || !internal) {
                link.close();
                return null;
            }
            if (room.state === 'RACING') {
                const deadline = Date.now() + settings.stateTimeoutMs;
                while (!link.snapshot && Date.now() < deadline)
                    await new Promise(resolve => setTimeout(resolve, 50));
                const snapshot = link.snapshot;
                const manifest = snapshot && await loadManifest(room.courseVersion, signal).catch(() => null);
                const start = snapshot && manifest && translate.resumedStart(room, manifest, snapshot);
                if (!start) {
                    link.close();
                    return null;
                }
                link.prepend(translate.raceStart(start, room));
            }
            return link.session(internal);
        },
    };
}
