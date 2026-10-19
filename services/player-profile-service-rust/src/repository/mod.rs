//! Repository ports (D29). The application layer depends only on these traits;
//! every SQL statement lives in [`postgres`].

pub mod postgres;

use std::{fmt, sync::Arc};

use async_trait::async_trait;

use crate::domain::{CatalogVersion, EconomicOperationRecord, PlayerProfile, SettlementRecord};

/// Storage failure categories. Details stay server-side; they never reach the
/// gRPC status (see `transport::error`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RepositoryError {
    /// Port exists but its adapter is delivered by F52.
    NotImplemented(&'static str),
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
            Self::NotImplemented(what) => write!(f, "{what} is not implemented"),
            Self::Unavailable => f.write_str("storage unavailable"),
            Self::PoolExhausted => f.write_str("storage capacity exhausted"),
            Self::Timeout => f.write_str("storage timeout"),
            Self::Unexpected(kind) => write!(f, "unexpected storage failure: {kind}"),
        }
    }
}

impl std::error::Error for RepositoryError {}

#[async_trait]
pub trait PlayerProfileRepository: Send + Sync {
    async fn find_profile(&self, player_id: &str)
        -> Result<Option<PlayerProfile>, RepositoryError>;
}

#[async_trait]
pub trait InventoryRepository: Send + Sync {
    async fn list_owned_item_ids(&self, player_id: &str) -> Result<Vec<String>, RepositoryError>;
}

#[async_trait]
pub trait CatalogRepository: Send + Sync {
    /// `None` selects the active catalog version.
    async fn find_catalog_version(
        &self,
        catalog_version: Option<&str>,
    ) -> Result<Option<CatalogVersion>, RepositoryError>;
}

#[async_trait]
pub trait EconomicOperationRepository: Send + Sync {
    async fn find_operation(
        &self,
        player_id: &str,
        request_id: &str,
    ) -> Result<Option<EconomicOperationRecord>, RepositoryError>;
}

#[async_trait]
pub trait SettlementRepository: Send + Sync {
    async fn find_settlement(
        &self,
        race_id: &str,
        player_id: &str,
    ) -> Result<Option<SettlementRecord>, RepositoryError>;
}

/// A resource released at the end of the shutdown sequence (e.g. DB pools).
#[async_trait]
pub trait Closeable: Send + Sync {
    async fn close(&self);
}

/// The set of ports handed to the application layer.
#[derive(Clone)]
pub struct Repositories {
    pub profiles: Arc<dyn PlayerProfileRepository>,
    pub inventory: Arc<dyn InventoryRepository>,
    pub catalog: Arc<dyn CatalogRepository>,
    pub operations: Arc<dyn EconomicOperationRepository>,
    pub settlements: Arc<dyn SettlementRepository>,
}

impl Repositories {
    /// Ports that always fail with [`RepositoryError::Unavailable`]. Used when
    /// `DATABASE_URL` is missing or invalid so the service can still start and
    /// report `NOT_SERVING` (F47 D4).
    pub fn unavailable() -> Self {
        let unavailable = Arc::new(Unavailable);
        Self {
            profiles: unavailable.clone(),
            inventory: unavailable.clone(),
            catalog: unavailable.clone(),
            operations: unavailable.clone(),
            settlements: unavailable,
        }
    }
}

struct Unavailable;

#[async_trait]
impl PlayerProfileRepository for Unavailable {
    async fn find_profile(&self, _: &str) -> Result<Option<PlayerProfile>, RepositoryError> {
        Err(RepositoryError::Unavailable)
    }
}

#[async_trait]
impl InventoryRepository for Unavailable {
    async fn list_owned_item_ids(&self, _: &str) -> Result<Vec<String>, RepositoryError> {
        Err(RepositoryError::Unavailable)
    }
}

#[async_trait]
impl CatalogRepository for Unavailable {
    async fn find_catalog_version(
        &self,
        _: Option<&str>,
    ) -> Result<Option<CatalogVersion>, RepositoryError> {
        Err(RepositoryError::Unavailable)
    }
}

#[async_trait]
impl EconomicOperationRepository for Unavailable {
    async fn find_operation(
        &self,
        _: &str,
        _: &str,
    ) -> Result<Option<EconomicOperationRecord>, RepositoryError> {
        Err(RepositoryError::Unavailable)
    }
}

#[async_trait]
impl SettlementRepository for Unavailable {
    async fn find_settlement(
        &self,
        _: &str,
        _: &str,
    ) -> Result<Option<SettlementRecord>, RepositoryError> {
        Err(RepositoryError::Unavailable)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn unavailable_ports_fail_closed() {
        let repos = Repositories::unavailable();
        assert_eq!(
            repos.profiles.find_profile("p").await,
            Err(RepositoryError::Unavailable)
        );
        assert_eq!(
            repos.settlements.find_settlement("r", "p").await,
            Err(RepositoryError::Unavailable)
        );
        assert_eq!(
            repos.catalog.find_catalog_version(None).await,
            Err(RepositoryError::Unavailable)
        );
    }
}
