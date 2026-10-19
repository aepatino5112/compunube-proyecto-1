//! Adapter skeletons: one struct per port. The SQL for the economy lands with
//! F52; until then each method reports `NotImplemented` so nothing can be
//! mistaken for a working persistence path.

use async_trait::async_trait;
use sqlx::PgPool;

use crate::{
    domain::{CatalogVersion, EconomicOperationRecord, PlayerProfile, SettlementRecord},
    repository::{
        CatalogRepository, EconomicOperationRepository, InventoryRepository,
        PlayerProfileRepository, Repositories, RepositoryError, SettlementRepository,
    },
};

pub(super) fn repositories(pool: PgPool) -> Repositories {
    use std::sync::Arc;
    Repositories {
        profiles: Arc::new(PostgresPlayerProfileRepository { pool: pool.clone() }),
        inventory: Arc::new(PostgresInventoryRepository { pool: pool.clone() }),
        catalog: Arc::new(PostgresCatalogRepository { pool: pool.clone() }),
        operations: Arc::new(PostgresEconomicOperationRepository { pool: pool.clone() }),
        settlements: Arc::new(PostgresSettlementRepository { pool }),
    }
}

struct PostgresPlayerProfileRepository {
    #[allow(dead_code)] // used by the F52 queries
    pool: PgPool,
}

struct PostgresInventoryRepository {
    #[allow(dead_code)] // used by the F52 queries
    pool: PgPool,
}

struct PostgresCatalogRepository {
    #[allow(dead_code)] // used by the F52 queries
    pool: PgPool,
}

struct PostgresEconomicOperationRepository {
    #[allow(dead_code)] // used by the F52 queries
    pool: PgPool,
}

struct PostgresSettlementRepository {
    #[allow(dead_code)] // used by the F52 queries
    pool: PgPool,
}

#[async_trait]
impl PlayerProfileRepository for PostgresPlayerProfileRepository {
    async fn find_profile(&self, _: &str) -> Result<Option<PlayerProfile>, RepositoryError> {
        Err(RepositoryError::NotImplemented("PlayerProfileRepository"))
    }
}

#[async_trait]
impl InventoryRepository for PostgresInventoryRepository {
    async fn list_owned_item_ids(&self, _: &str) -> Result<Vec<String>, RepositoryError> {
        Err(RepositoryError::NotImplemented("InventoryRepository"))
    }
}

#[async_trait]
impl CatalogRepository for PostgresCatalogRepository {
    async fn find_catalog_version(
        &self,
        _: Option<&str>,
    ) -> Result<Option<CatalogVersion>, RepositoryError> {
        Err(RepositoryError::NotImplemented("CatalogRepository"))
    }
}

#[async_trait]
impl EconomicOperationRepository for PostgresEconomicOperationRepository {
    async fn find_operation(
        &self,
        _: &str,
        _: &str,
    ) -> Result<Option<EconomicOperationRecord>, RepositoryError> {
        Err(RepositoryError::NotImplemented(
            "EconomicOperationRepository",
        ))
    }
}

#[async_trait]
impl SettlementRepository for PostgresSettlementRepository {
    async fn find_settlement(
        &self,
        _: &str,
        _: &str,
    ) -> Result<Option<SettlementRecord>, RepositoryError> {
        Err(RepositoryError::NotImplemented("SettlementRepository"))
    }
}
