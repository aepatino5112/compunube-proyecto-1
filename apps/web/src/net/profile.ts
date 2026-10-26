// Production ProfileAdapter for dist/online-profile.js over E45. Go derives the
// playerId from the session; this module only translates DTOs and keeps every
// requestId bound to the exact body first sent, so a retry never becomes a
// different logical operation.
import type { Catalog, MutationBody, MutationResult, Profile } from './e45.js';
import { GoApiError, type GoHttp } from './http.js';

/** Envelope consumed by createOnlineProfileStore (see docs/backend/PROFILE_ADAPTER.md). */
export interface ProfileEnvelope {
  playerId: string;
  profileRevision: number;
  requestId?: string;
  profile: {
    version: 1;
    coins: number;
    plastic: number;
    metal: number;
    // Not part of E45: the service does not report them, so they stay unknown.
    totalCleaned: null;
    races: null;
    owned: string[];
    equipped: { board: string; outfit: string; net: string; hair: string; character: string };
    appearance: { skin: string; hairColor: string };
  };
}

export type ProfileAction =
  | { type: 'buy' | 'craft' | 'equip'; id: string }
  | { type: 'exchange'; material: 'plastic' | 'metal'; amount: number }
  | { type: 'appearance'; field: 'skin' | 'hairColor'; value: string };

/** Thrown for definitive rejections; the store keeps the confirmed profile. */
export interface ProfileRejection {
  code: string;
  requestId?: string;
}

const ROUTES = { buy: '/v1/profile/purchases', craft: '/v1/profile/crafts', equip: '/v1/profile/equipment' } as const;

export function toEnvelope(profile: Profile, requestId?: string): ProfileEnvelope {
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

interface Pending {
  method: 'POST' | 'PUT';
  path: string;
  body: MutationBody;
}

export function createProfileAdapter(http: GoHttp) {
  let catalogVersion: string | null = null;
  let last: Profile | null = null;
  const pending = new Map<string, Pending>();

  async function activeCatalog(signal?: AbortSignal): Promise<string> {
    catalogVersion ??= (await http.request<Catalog>('GET', '/v1/catalog', undefined, signal)).catalogVersion;
    return catalogVersion;
  }

  function build(requestId: string, action: ProfileAction, version: string): Pending {
    const key = { requestId, catalogVersion: version };
    switch (action.type) {
      case 'buy': case 'craft': case 'equip':
        return { method: 'POST', path: ROUTES[action.type], body: { ...key, itemId: action.id } };
      case 'exchange':
        return { method: 'POST', path: '/v1/profile/exchanges', body: { ...key, material: action.material, amount: action.amount } };
      case 'appearance': {
        // E45 sets both options at once; the other one comes from the last confirmed profile.
        if (!last) throw { code: 'PROFILE_REQUIRED', requestId } satisfies ProfileRejection;
        const skinId = action.field === 'skin' ? action.value : last.appearance.skinId;
        const hairColorId = action.field === 'hairColor' ? action.value : last.appearance.hairColorId;
        return { method: 'PUT', path: '/v1/profile/appearance', body: { ...key, skinId, hairColorId } };
      }
    }
  }

  return {
    async getProfile({ signal }: { signal?: AbortSignal } = {}): Promise<ProfileEnvelope> {
      await http.ensureSession(signal);
      const profile = await http.request<Profile>('GET', '/v1/profile', undefined, signal);
      last = profile;
      return toEnvelope(profile);
    },

    async performAction({ requestId, action }: { requestId: string; action: ProfileAction },
      { signal }: { signal?: AbortSignal } = {}): Promise<ProfileEnvelope> {
      await http.ensureSession(signal);
      let operation = pending.get(requestId);
      if (!operation) {
        operation = build(requestId, action, await activeCatalog(signal));
        pending.set(requestId, operation);
      }
      try {
        const result = await http.request<MutationResult>(operation.method, operation.path, operation.body, signal);
        if (result.requestId !== requestId) throw new GoApiError(0, 'INVALID_RESPONSE', requestId);
        pending.delete(requestId);
        last = result.profile;
        return toEnvelope(result.profile, requestId);
      } catch (error) {
        if (error instanceof GoApiError && error.definitive) {
          pending.delete(requestId);
          if (error.code === 'INVALID_CATALOG_VERSION') catalogVersion = null;
          throw { code: error.code, requestId } satisfies ProfileRejection;
        }
        // Uncertain (timeout, transport, 504, 503): keep the identical body for the retry.
        throw error;
      }
    },
  };
}
