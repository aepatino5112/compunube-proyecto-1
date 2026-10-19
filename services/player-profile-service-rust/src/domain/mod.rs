//! Domain layer: types and invariants that are independent of transport and
//! storage (D29). F47 only fixes the persistent records the repository ports
//! exchange, mirroring E41. Economic invariants (no negative balances, no
//! duplicate application, settlement rules for `disqualified`/`left`/`dnf`)
//! are implemented by F52 and must live here, never in transport or SQL
//! adapters alone.

/// Persistent profile row (`player.profiles`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlayerProfile {
    pub player_id: String,
    pub coins: u64,
    pub plastic: u64,
    pub metal: u64,
    pub profile_revision: u64,
}

/// Catalog publication (`player.catalog_versions`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CatalogVersion {
    pub version: String,
    pub active: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OperationStatus {
    Applied,
    Rejected,
}

/// Deduplication record (`player.economic_operations`), keyed by
/// `(player_id, request_id)`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EconomicOperationRecord {
    pub player_id: String,
    pub request_id: String,
    pub request_fingerprint: String,
    pub status: OperationStatus,
    pub profile_revision_after: Option<u64>,
}

/// Single-credit record (`player.settlements`), keyed by `(race_id, player_id)`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SettlementRecord {
    pub race_id: String,
    pub player_id: String,
    pub result_fingerprint: String,
    pub credited_plastic: u64,
    pub credited_metal: u64,
    pub profile_revision_after: u64,
}
