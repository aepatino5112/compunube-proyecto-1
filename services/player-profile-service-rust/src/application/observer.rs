//! Outbound port for operational facts the business flow produces (replays,
//! conflicts, settlement results). The application layer only reports what it
//! decided; counting and exposing it is the adapter's job (`crate::metrics`).
//!
//! Implementations receive outcomes, never request data: no player id, request
//! id or payload crosses this port.

use super::{MutationOutcome, SettlementOutcome};

pub trait OperationObserver: Send + Sync {
    /// A profile mutation reached its final outcome. `operation` is the stored
    /// operation type (`buy`, `craft`, `exchange`, `equip`, `appearance`).
    fn mutation_resolved(&self, operation: &'static str, outcome: &MutationOutcome);

    /// A settlement reached its final outcome.
    fn settlement_resolved(&self, outcome: &SettlementOutcome);
}

/// Observer for callers that do not collect anything.
pub struct NoopObserver;

impl OperationObserver for NoopObserver {
    fn mutation_resolved(&self, _: &'static str, _: &MutationOutcome) {}
    fn settlement_resolved(&self, _: &SettlementOutcome) {}
}
