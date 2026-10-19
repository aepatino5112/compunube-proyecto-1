//! Domain layer: types and invariants that are independent of transport and
//! storage (D29). Every economic rule lives here as a pure function so it can
//! be tested without a database and can never be bypassed by a SQL adapter:
//!
//! * no balance goes negative and no item is owned twice;
//! * only owned items are equipped, in the slot of their own type;
//! * buy, craft, exchange, equip and appearance evaluate against one catalog
//!   version and return an [`economy::Effect`] the repository applies;
//! * request fingerprints decide replay versus conflict;
//! * settlement credits only what Go sent and only for `finished` races.

pub mod appearance;
pub mod catalog;
pub mod economy;
pub mod fingerprint;
pub mod profile;
pub mod provisioning;
pub mod settlement;
pub mod validation;

#[cfg(test)]
mod fixtures;

pub use appearance::{AppearanceOption, HAIR_COLORS, SKIN_TONES};
pub use catalog::{Catalog, CatalogItem, ItemType};
pub use economy::{Effect, Material, MutationIntent, MutationRejection};
pub use profile::{Appearance, Equipment, ProfileState, Slot};
pub use settlement::{RaceOutcome, SettlementRejection, SettlementRequest};

/// Persistent profile row (`player.profiles`). Superseded by [`ProfileState`]
/// when the repository ports are reworked.
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
    /// Present exactly when `status` is [`OperationStatus::Rejected`].
    pub rejection: Option<MutationRejection>,
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
