// E45 public HTTP DTOs, mirrored from contracts/http/openapi.yaml (the normative
// source). Only the shapes this client reads or sends are declared here.
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
