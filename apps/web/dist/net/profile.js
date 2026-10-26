import { GoApiError } from './http.js';
const ROUTES = { buy: '/v1/profile/purchases', craft: '/v1/profile/crafts', equip: '/v1/profile/equipment' };
export function toEnvelope(profile, requestId) {
    const { equipment: e, appearance: a } = profile;
    return {
        playerId: profile.playerId,
        profileRevision: profile.profileRevision,
        ...(requestId === undefined ? {} : { requestId }),
        profile: {
            version: 1,
            coins: profile.coins,
            plastic: profile.plastic,
            metal: profile.metal,
            totalCleaned: null,
            races: null,
            owned: [...profile.ownedItemIds],
            equipped: { board: e.boardId, outfit: e.outfitId, net: e.netId, hair: e.hairId, character: e.characterId },
            appearance: { skin: a.skinId, hairColor: a.hairColorId },
        },
    };
}
export function createProfileAdapter(http) {
    let catalogVersion = null;
    let last = null;
    const pending = new Map();
    async function activeCatalog(signal) {
        catalogVersion ??= (await http.request('GET', '/v1/catalog', undefined, signal)).catalogVersion;
        return catalogVersion;
    }
    function build(requestId, action, version) {
        const key = { requestId, catalogVersion: version };
        switch (action.type) {
            case 'buy':
            case 'craft':
            case 'equip':
                return { method: 'POST', path: ROUTES[action.type], body: { ...key, itemId: action.id } };
            case 'exchange':
                return { method: 'POST', path: '/v1/profile/exchanges', body: { ...key, material: action.material, amount: action.amount } };
            case 'appearance': {
                // E45 sets both options at once; the other one comes from the last confirmed profile.
                if (!last)
                    throw { code: 'PROFILE_REQUIRED', requestId };
                const skinId = action.field === 'skin' ? action.value : last.appearance.skinId;
                const hairColorId = action.field === 'hairColor' ? action.value : last.appearance.hairColorId;
                return { method: 'PUT', path: '/v1/profile/appearance', body: { ...key, skinId, hairColorId } };
            }
        }
    }
    return {
        async getProfile({ signal } = {}) {
            await http.ensureSession(signal);
            const profile = await http.request('GET', '/v1/profile', undefined, signal);
            last = profile;
            return toEnvelope(profile);
        },
        async performAction({ requestId, action }, { signal } = {}) {
            await http.ensureSession(signal);
            let operation = pending.get(requestId);
            if (!operation) {
                operation = build(requestId, action, await activeCatalog(signal));
                pending.set(requestId, operation);
            }
            try {
                const result = await http.request(operation.method, operation.path, operation.body, signal);
                if (result.requestId !== requestId)
                    throw new GoApiError(0, 'INVALID_RESPONSE', requestId);
                pending.delete(requestId);
                last = result.profile;
                return toEnvelope(result.profile, requestId);
            }
            catch (error) {
                if (error instanceof GoApiError && error.definitive) {
                    pending.delete(requestId);
                    if (error.code === 'INVALID_CATALOG_VERSION')
                        catalogVersion = null;
                    throw { code: error.code, requestId };
                }
                // Uncertain (timeout, transport, 504, 503): keep the identical body for the retry.
                throw error;
            }
        },
    };
}
