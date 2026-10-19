//! Port implementations over one [`PgPool`]. The queries themselves live in
//! `catalog`, `profile` and `transaction`.

use std::sync::Arc;

use async_trait::async_trait;
use sqlx::PgPool;

use super::{catalog, error::map_sqlx_error, transaction::PgTransaction};
use crate::{
    domain::Catalog,
    repository::{
        CatalogRepository, EconomyTransaction, Repositories, RepositoryError, TransactionManager,
    },
};

pub(super) fn repositories(pool: PgPool) -> Repositories {
    Repositories {
        catalog: Arc::new(PostgresCatalogRepository { pool: pool.clone() }),
        transactions: Arc::new(PostgresTransactionManager { pool }),
    }
}

struct PostgresCatalogRepository {
    pool: PgPool,
}

struct PostgresTransactionManager {
    pool: PgPool,
}

#[async_trait]
impl CatalogRepository for PostgresCatalogRepository {
    async fn find_catalog(
        &self,
        version: Option<&str>,
    ) -> Result<Option<Catalog>, RepositoryError> {
        let mut conn = self.pool.acquire().await.map_err(|e| map_sqlx_error(&e))?;
        catalog::load(&mut conn, version).await
    }
}

#[async_trait]
impl TransactionManager for PostgresTransactionManager {
    async fn begin(&self) -> Result<Box<dyn EconomyTransaction>, RepositoryError> {
        let tx = self.pool.begin().await.map_err(|e| map_sqlx_error(&e))?;
        Ok(Box::new(PgTransaction::new(tx)))
    }
}
