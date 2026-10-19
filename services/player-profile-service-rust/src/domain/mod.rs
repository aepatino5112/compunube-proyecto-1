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
    /// `buy`, `craft`, `exchange`, `equip` or `appearance`.
    pub operation_type: String,
    pub request_fingerprint: String,
    /// `None` when the request named a catalog version that does not exist
    /// (the column is a foreign key).
    pub catalog_version: Option<String>,
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
