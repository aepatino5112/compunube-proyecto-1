// Confirmed online account data only. This boundary never reads or writes the
// local save, computes rewards, or changes a balance before backend confirmation.
import {CATALOG} from './economy.js';
import {SKIN_TONES, HAIR_COLORS} from './appearance.js';

const ITEMS = new Map(CATALOG.map(item => [item.id, item]));
const EQUIPMENT = ['board', 'outfit', 'net', 'hair', 'character'];
const APPEARANCE = {skin: new Set(SKIN_TONES.map(value => value.id)),
  hairColor: new Set(HAIR_COLORS.map(value => value.id))};
const COUNTERS = ['coins', 'plastic', 'metal'];
// Local-only history counters; the online service (E45) does not report them.
const OPTIONAL_COUNTERS = ['totalCleaned', 'races'];
const BUSINESS_ERRORS = new Set(['INVALID_ACTION', 'INVALID_ITEM', 'INSUFFICIENT_COINS',
  'INSUFFICIENT_MATERIALS', 'NOT_OWNED', 'ALREADY_OWNED', 'INVALID_APPEARANCE', 'SESSION_REQUIRED',
  'INVALID_REQUEST', 'IDEMPOTENCY_CONFLICT', 'INVALID_CATALOG_VERSION', 'PROFILE_REQUIRED']);
const MESSAGES = {
  NOT_CONFIGURED: 'El perfil online todavía no tiene conectado el backend.',
  INVALID_ACTION: 'Elige una acción válida para tu perfil online.',
  INVALID_ITEM: 'Ese objeto no está disponible en el servidor.',
  INSUFFICIENT_COINS: 'No tienes suficientes monedas en tu perfil online.',
  INSUFFICIENT_MATERIALS: 'No tienes suficientes materiales en tu perfil online.',
  NOT_OWNED: 'Ese objeto no pertenece a tu perfil online.',
  ALREADY_OWNED: 'Ese objeto ya pertenece a tu perfil online.',
  INVALID_APPEARANCE: 'El servidor no reconoce esa apariencia.',
  SESSION_REQUIRED: 'El servidor necesita una sesión válida para continuar.',
  INVALID_REQUEST: 'El servidor no aceptó esa solicitud. Actualiza el perfil antes de continuar.',
  IDEMPOTENCY_CONFLICT: 'Esa operación ya se registró con otros datos. Actualiza el perfil antes de continuar.',
  INVALID_CATALOG_VERSION: 'El catálogo cambió. Actualiza el perfil y vuelve a elegir.',
  PROFILE_UNAVAILABLE: 'El perfil y la economía online no están disponibles ahora. Tu última confirmación se conserva.',
  PROFILE_REQUIRED: 'Carga tu perfil online antes de usarlo.',
  ACTION_PENDING: 'Espera la confirmación de la operación online pendiente.',
  LOAD_FAILED: 'No pudimos cargar el perfil online. Puedes volver a intentarlo.',
  INVALID_RESPONSE: 'El servidor envió un perfil online incompatible.',
  IDENTITY_CHANGED: 'La cuenta recibida es distinta. Reinicia la sesión online antes de cambiar de cuenta.',
  INVALID_REQUEST_ID: 'No se pudo crear un identificador seguro para la operación.',
  ACTION_UNCERTAIN: 'No sabemos si el servidor aplicó la operación. Reintenta para consultar la misma solicitud.',
};
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 128 &&
  value.trim() === value && !/[\x00-\x1f\x7f]/.test(value);
const count = value => Number.isSafeInteger(value) && value >= 0 && value < 1e9;
const revision = value => Number.isSafeInteger(value) && value >= 0;
function freeze(value) {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value)) if (child && typeof child === 'object' && !Object.isFrozen(child)) freeze(child);
  }
  return value;
}
function profileDTO(value) {
  if (!record(value) || value.version !== 1 || COUNTERS.some(key => !count(value[key])) ||
      OPTIONAL_COUNTERS.some(key => value[key] !== null && !count(value[key])) ||
      !Array.isArray(value.owned) || value.owned.length > ITEMS.size ||
      value.owned.some(key => !ITEMS.has(key)) || new Set(value.owned).size !== value.owned.length ||
      !record(value.equipped) || !record(value.appearance)) return null;
  if (EQUIPMENT.some(type => ITEMS.get(value.equipped[type])?.type !== type || !value.owned.includes(value.equipped[type])) ||
      Object.entries(APPEARANCE).some(([key, choices]) => !choices.has(value.appearance[key]))) return null;
  return {version: 1, ...Object.fromEntries([...COUNTERS, ...OPTIONAL_COUNTERS].map(key => [key, value[key]])), owned: [...value.owned],
    equipped: Object.fromEntries(EQUIPMENT.map(key => [key, value.equipped[key]])),
    appearance: Object.fromEntries(Object.keys(APPEARANCE).map(key => [key, value.appearance[key]]))};
}
function envelopeDTO(value) {
  if (!record(value) || !id(value.playerId) || !revision(value.profileRevision) ||
      (value.requestId !== undefined && !id(value.requestId))) return null;
  const profile = profileDTO(value.profile);
  return profile ? {playerId: value.playerId, profileRevision: value.profileRevision, profile,
    ...(value.requestId === undefined ? {} : {requestId: value.requestId})} : null;
}
function actionDTO(value) {
  if (!record(value)) return null;
  if (['buy', 'craft', 'equip'].includes(value.type)) {
    const item = ITEMS.get(value.id);
    if (!item || (value.type === 'buy' && (item.recipe || item.price === undefined)) ||
        (value.type === 'craft' && !item.recipe)) return null;
    return {type: value.type, id: value.id};
  }
  if (value.type === 'appearance' && Object.hasOwn(APPEARANCE, value.field) && APPEARANCE[value.field].has(value.value))
    return {type: 'appearance', field: value.field, value: value.value};
  if (value.type === 'exchange' && ['plastic', 'metal'].includes(value.material) && count(value.amount) && value.amount > 0)
    return {type: 'exchange', material: value.material, amount: value.amount};
  return null;
}
function secureRequestId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  if (typeof globalThis.crypto?.getRandomValues !== 'function') throw new Error('Secure random unavailable');
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return `profile-${Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('')}`;
}
function errorDTO(code, retryable = false) { return freeze({code, message: MESSAGES[code], retryable}); }

/**
 * Inject getProfile({signal}) and performAction({requestId, action}, {signal}).
 * performAction must be idempotent by account + requestId, including retries.
 * Explicit business rejections throw {code, requestId?}; all other failures
 * after sending leave an uncertain operation with the same request ID.
 */
export function createOnlineProfileStore({adapter = null, requestIdFactory = secureRequestId, timeoutMs = 12000} = {}) {
  const configured = !!adapter && typeof adapter.getProfile === 'function' && typeof adapter.performAction === 'function';
  const initial = () => freeze({status: configured ? 'idle' : 'unconfigured', playerId: null,
    profileRevision: null, profile: null, operation: null, error: null});
  let state = initial(), generation = 0, controller = null, disposed = false, operationRevision = null;
  const listeners = new Set(), usedRequestIds = new Set();
  const acknowledged = new WeakSet();
  const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 12000;
  async function request(method, args, pending) {
    let timer, onAbort;
    try {
      return await Promise.race([
        Promise.resolve().then(() => {
          if (pending.signal.aborted) throw new Error('Profile request cancelled');
          return adapter[method](...args, {signal: pending.signal});
        }),
        new Promise((resolve, reject) => {
          onAbort = () => reject(new Error('Profile request cancelled'));
          pending.signal.addEventListener('abort', onAbort, {once: true});
          if (pending.signal.aborted) onAbort();
          else timer = setTimeout(() => pending.abort(), timeout);
        }),
      ]);
    } finally { clearTimeout(timer); pending.signal.removeEventListener('abort', onAbort); }
  }
  function update(patch) {
    if (disposed) return;
    state = freeze({...state, ...patch});
    for (const listener of [...listeners]) {
      try { listener(state); } catch { listeners.delete(listener); }
    }
  }
  function invalidate() { generation++; controller?.abort(); controller = null; }
  function blocked() {
    if (disposed) return true;
    if (!configured) { update({error: errorDTO('NOT_CONFIGURED')}); return true; }
    return false;
  }
  function confirmedData(data) {
    return state.profileRevision === null || data.profileRevision > state.profileRevision
      ? {playerId: data.playerId, profileRevision: data.profileRevision, profile: data.profile} : {};
  }
  async function load() {
    if (blocked()) return false;
    if (state.operation || state.status === 'loading') return false;
    const token = ++generation, pending = new AbortController(); controller = pending;
    update({status: 'loading', error: null});
    if (disposed || token !== generation) return false;
    try {
      const raw = await request('getProfile', [], pending);
      if (disposed || token !== generation) return false;
      const data = envelopeDTO(raw);
      if (!data) { update({status: 'error', error: errorDTO('INVALID_RESPONSE', true)}); return false; }
      if (state.playerId !== null && data.playerId !== state.playerId) {
        update({status: 'error', error: errorDTO('IDENTITY_CHANGED')}); return false;
      }
      update({...confirmedData(data), status: 'ready', error: null});
      return true;
    } catch (error) {
      if (disposed || token !== generation) return false;
      const code = ['PROFILE_UNAVAILABLE', 'SESSION_REQUIRED'].includes(error?.code) ? error.code : 'LOAD_FAILED';
      update({status: 'error', error: errorDTO(code, true)});
      return false;
    } finally { if (token === generation) controller = null; }
  }
  async function sendOperation(operation) {
    const token = ++generation, pending = new AbortController(); controller = pending;
    update({status: 'pending', operation, error: null});
    if (disposed || token !== generation) return false;
    try {
      const raw = await request('performAction', [operation], pending);
      if (disposed || token !== generation || state.operation !== operation) return !disposed && acknowledged.has(operation);
      const data = envelopeDTO(raw);
      if (!data || data.requestId !== operation.requestId || data.playerId !== state.playerId ||
          data.profileRevision < operationRevision) {
        update({status: 'uncertain', error: errorDTO('INVALID_RESPONSE', true)}); return false;
      }
      operationRevision = null;
      update({...confirmedData(data), status: 'ready', operation: null, error: null});
      return true;
    } catch (error) {
      if (disposed || token !== generation || state.operation !== operation) return !disposed && acknowledged.has(operation);
      // An error belonging to another request cannot conclusively reject this one.
      if (BUSINESS_ERRORS.has(error?.code) && (error.requestId === undefined || error.requestId === operation.requestId)) {
        operationRevision = null;
        update({status: 'ready', operation: null, error: errorDTO(error.code)});
      } else update({status: 'uncertain', error: errorDTO(error?.code === 'PROFILE_UNAVAILABLE' ? 'PROFILE_UNAVAILABLE' : 'ACTION_UNCERTAIN', true)});
      return false;
    } finally { if (token === generation) controller = null; }
  }
  async function transact(value) {
    if (blocked()) return false;
    if (state.operation || state.status === 'loading') return false;
    if (!state.profile || state.status !== 'ready') { update({error: errorDTO('PROFILE_REQUIRED')}); return false; }
    const action = actionDTO(value);
    if (!action) { update({error: errorDTO('INVALID_ACTION')}); return false; }
    let requestId;
    try { requestId = requestIdFactory(); } catch { /* Fail closed if secure generation is unavailable. */ }
    if (!id(requestId) || usedRequestIds.has(requestId)) { update({error: errorDTO('INVALID_REQUEST_ID')}); return false; }
    usedRequestIds.add(requestId);
    operationRevision = state.profileRevision;
    return sendOperation(freeze({requestId, action}));
  }
  function accept(raw) {
    if (disposed || !state.playerId) return false;
    const data = envelopeDTO(raw);
    if (!data || data.playerId !== state.playerId) return false;
    const settles = state.operation && data.requestId === state.operation.requestId && data.profileRevision >= operationRevision;
    if (data.profileRevision <= state.profileRevision && !settles) return false;
    const patch = confirmedData(data);
    if (settles) {
      acknowledged.add(state.operation);
      invalidate(); operationRevision = null;
      update({...patch, status: 'ready', operation: null, error: null});
    } else update(patch);
    return true;
  }
  async function retry() {
    if (blocked()) return false;
    if (state.status === 'uncertain' && state.operation) return sendOperation(state.operation);
    if (state.status === 'error' && !state.operation) return load();
    return false;
  }
  function reset() {
    if (disposed) return false;
    invalidate(); operationRevision = null; state = initial();
    update({}); return true;
  }
  function subscribe(listener) {
    if (typeof listener !== 'function' || disposed) return () => {};
    listeners.add(listener);
    try { listener(state); } catch { listeners.delete(listener); }
    return () => listeners.delete(listener);
  }
  function dispose() {
    if (disposed) return;
    invalidate(); disposed = true; listeners.clear();
  }
  return Object.freeze({get state() { return state; }, subscribe, load, transact, retry, accept, reset, dispose});
}
