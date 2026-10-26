// E45 public HTTP DTOs, mirrored from contracts/http/openapi.yaml (the normative
// source). Only the shapes this client reads or sends are declared here.

export type MapId = 'maracaibo' | 'orinoco';
export type Material = 'plastic' | 'metal';

export interface SessionIdentity {
  playerId: string;
}

export interface Equipment {
  boardId: string;
  outfitId: string;
  netId: string;
  hairId: string;
  characterId: string;
}

export interface Appearance {
  skinId: string;
  hairColorId: string;
}

export interface Profile {
  playerId: string;
  profileRevision: number;
  coins: number;
  plastic: number;
  metal: number;
  ownedItemIds: string[];
  equipment: Equipment;
  appearance: Appearance;
}

export interface Catalog {
  catalogVersion: string;
  items: Array<{ itemId: string; itemType: string }>;
}

export interface MutationKey {
  requestId: string;
  catalogVersion: string;
}

export type MutationBody =
  | (MutationKey & { itemId: string })
  | (MutationKey & { material: Material; amount: number })
  | (MutationKey & Appearance);

export interface MutationResult {
  requestId: string;
  replayed: boolean;
  profile: Profile;
}

export interface RoomMembership {
  roomId: string;
  mapId: MapId;
  state: 'LOBBY';
  playerId: string;
}

export interface ApiErrorEnvelope {
  code: string;
  message: string;
  requestId?: string;
}

// E45 4xx codes: a definitive rejection means the operation produced no change.
// 503 is deliberately absent: Go can answer PROFILE_UNAVAILABLE after a mutation
// already reached Rust, so the client keeps the requestId and retries it.
export const DEFINITIVE_CODES = new Set([
  'INVALID_REQUEST', 'SESSION_REQUIRED', 'ROOM_NOT_FOUND', 'ROOM_FULL', 'INCOMPATIBLE_VERSION',
  'INVALID_STATE', 'IDEMPOTENCY_CONFLICT', 'INVALID_ACTION', 'INVALID_ITEM', 'INSUFFICIENT_COINS',
  'INSUFFICIENT_MATERIALS', 'NOT_OWNED', 'ALREADY_OWNED', 'INVALID_APPEARANCE',
  'INVALID_CATALOG_VERSION',
]);
export const UNCERTAIN_CODE = 'MUTATION_OUTCOME_UNKNOWN';
