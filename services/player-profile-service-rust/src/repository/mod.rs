//! Repository ports (D29). The application layer depends only on these traits;
//! every SQL statement lives in [`postgres`].
//!
//! Money-moving use cases run inside one [`EconomyTransaction`]:
//! `begin` -> `lock_profile` -> idempotency lookup -> validate (domain) ->
//! `apply_effect` -> `record_operation` -> `commit`. Dropping a transaction
//! without committing rolls everything back.

pub mod postgres;

use std::{fmt, sync::Arc};

use async_trait::async_trait;

use crate::domain::{
    settlement::Credit, Catalog, EconomicOperationRecord, Effect, ProfileState, SettlementRecord,
};

/// Storage failure categories. Details stay server-side; they never reach the
/// gRPC status (see `transport::error`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RepositoryError {
    /// Storage is not reachable or not configured.
    Unavailable,
    /// Connection pool or database capacity is saturated.
    PoolExhausted,
    /// The storage call did not finish in time.
    Timeout,
    /// Anything else; the payload is a sanitized classification (no SQL text,
    /// no credentials).
    Unexpected(String),
}

impl fmt::Display for RepositoryError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Unavailable => f.write_str("storage unavailable"),
            Self::PoolExhausted => f.write_str("storage capacity exhausted"),
            Self::Timeout => f.write_str("storage timeout"),
            Self::Unexpected(kind) => write!(f, "unexpected storage failure: {kind}"),
        }
    }
}

impl std::error::Error for RepositoryError {}

/// Row lock taken on the profile.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LockMode {
    /// `FOR UPDATE`: serializes every mutation of the same player, across
    /// replicas.
    Update,
    /// `FOR SHARE`: a consistent read that does not block other readers but
    /// waits for an in-flight mutation.
    Share,
}

/// Read access to published catalogs outside a transaction.
#[async_trait]
pub trait CatalogRepository: Send + Sync {
    /// `None` selects the active version. Only published versions are visible.
    async fn find_catalog(&self, version: Option<&str>)
        -> Result<Option<Catalog>, RepositoryError>;
}

#[async_trait]
pub trait TransactionManager: Send + Sync {
    async fn begin(&self) -> Result<Box<dyn EconomyTransaction>, RepositoryError>;
}

/// One database transaction over the `player` schema.
#[async_trait]
pub trait EconomyTransaction: Send {
    /// Locks the player's profile and returns its full state, provisioning the
    /// profile first when it does not exist (E7). Concurrent provisioning of
    /// the same player is safe.
    async fn lock_profile(
        &mut self,
        player_id: &str,
        mode: LockMode,
    ) -> Result<ProfileState, RepositoryError>;

    async fn find_operation(
        &mut self,
        player_id: &str,
        request_id: &str,
    ) -> Result<Option<EconomicOperationRecord>, RepositoryError>;

    async fn find_settlement(
        &mut self,
        race_id: &str,
        player_id: &str,
    ) -> Result<Option<SettlementRecord>, RepositoryError>;

    /// A published catalog version, or `None` when unknown or unpublished.
    async fn find_catalog(&mut self, version: &str) -> Result<Option<Catalog>, RepositoryError>;

    /// Applies an accepted mutation and advances the revision by one; returns
    /// the new revision.
    async fn apply_effect(
        &mut self,
        player_id: &str,
        effect: &Effect,
    ) -> Result<u64, RepositoryError>;

    /// Adds settled materials and advances the revision by one; returns the
    /// new revision.
    async fn credit_materials(
        &mut self,
        player_id: &str,
        credit: Credit,
    ) -> Result<u64, RepositoryError>;

    async fn record_operation(
        &mut self,
        operation: &EconomicOperationRecord,
    ) -> Result<(), RepositoryError>;

    async fn record_settlement(
        &mut self,
        settlement: &SettlementRecord,
    ) -> Result<(), RepositoryError>;

    async fn commit(self: Box<Self>) -> Result<(), RepositoryError>;
}

/// A resource released at the end of the shutdown sequence (e.g. DB pools).
#[async_trait]
pub trait Closeable: Send + Sync {
    async fn close(&self);
}

/// Point-in-time view of a connection pool, for operational metrics only.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PoolSnapshot {
    /// Connections currently open (idle + in use).
    pub size: u32,
    /// Open connections waiting for work.
    pub idle: u32,
    /// Configured upper bound.
    pub max: u32,
}

impl PoolSnapshot {
    pub fn in_use(&self) -> u32 {
        self.size.saturating_sub(self.idle)
    }
}

/// Read-only window into the business pool; implemented by the storage adapter.
pub trait PoolStatsSource: Send + Sync {
    fn snapshot(&self) -> PoolSnapshot;
}

/// The set of ports handed to the application layer.
#[derive(Clone)]
pub struct Repositories {
    pub catalog: Arc<dyn CatalogRepository>,
    pub transactions: Arc<dyn TransactionManager>,
}

impl Repositories {
    /// Ports that always fail with [`RepositoryError::Unavailable`]. Used when
    /// `DATABASE_URL` is missing or invalid so the service can still start and
    /// report `NOT_SERVING` (F47 D4).
    pub fn unavailable() -> Self {
        let unavailable = Arc::new(Unavailable);
        Self {
            catalog: unavailable.clone(),
            transactions: unavailable,
        }
    }
}

struct Unavailable;

#[async_trait]
impl CatalogRepository for Unavailable {
    async fn find_catalog(&self, _: Option<&str>) -> Result<Option<Catalog>, RepositoryError> {
        Err(RepositoryError::Unavailable)
    }
}

#[async_trait]
impl TransactionManager for Unavailable {
    async fn begin(&self) -> Result<Box<dyn EconomyTransaction>, RepositoryError> {
        Err(RepositoryError::Unavailable)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn in_use_is_open_minus_idle_and_never_underflows() {
        let busy = PoolSnapshot {
            size: 5,
            idle: 2,
            max: 10,
        };
        assert_eq!(busy.in_use(), 3);
        let racy = PoolSnapshot {
            size: 1,
            idle: 2,
            max: 10,
        };
        assert_eq!(racy.in_use(), 0);
    }

    #[tokio::test]
    async fn unavailable_ports_fail_closed() {
        let repos = Repositories::unavailable();
        assert!(matches!(
            repos.transactions.begin().await,
            Err(RepositoryError::Unavailable)
        ));
        assert_eq!(
            repos.catalog.find_catalog(None).await,
            Err(RepositoryError::Unavailable)
        );
    }
}
