//! PostgreSQL adapter. This is the only place allowed to depend on `sqlx` or to
//! contain SQL. Rust owns schema `player` only; `match` belongs to Go and must
//! never be referenced (the only other relation read is the administrative
//! `public.schema_migrations`, for readiness).
//!
//! Queries are plain runtime statements; no compile-time `sqlx` macros so the
//! crate builds without a live database (ci-rust has none).

mod adapters;
mod catalog;
mod convert;
mod error;
pub mod probe;
mod profile;
mod transaction;

use std::str::FromStr;

use sqlx::{
    postgres::{PgConnectOptions, PgPoolOptions},
    PgPool,
};

use async_trait::async_trait;

use super::{Closeable, Repositories};
use crate::config::{PoolConfig, SecretString};

pub use error::{describe_sqlx_error, map_sqlx_error};
pub use probe::PostgresReadinessProbe;

/// The URL could not be parsed. Deliberately carries no detail because parser
/// messages may echo parts of the URL.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InvalidDatabaseUrl;

impl std::fmt::Display for InvalidDatabaseUrl {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("DATABASE_URL is not a valid PostgreSQL connection URL")
    }
}

impl std::error::Error for InvalidDatabaseUrl {}

pub fn connect_options(
    url: &SecretString,
    instance_id: &str,
) -> Result<PgConnectOptions, InvalidDatabaseUrl> {
    PgConnectOptions::from_str(url.expose())
        .map(|options| options.application_name(&format!("player-profile-service/{instance_id}")))
        .map_err(|_| InvalidDatabaseUrl)
}

/// Business pool. Lazy: building it never touches the network, so an
/// unreachable database cannot prevent the service from starting (D4).
pub fn business_pool(options: &PgConnectOptions, pool: &PoolConfig) -> PgPool {
    PgPoolOptions::new()
        .max_connections(pool.max_connections)
        .min_connections(pool.min_connections)
        .acquire_timeout(pool.acquire_timeout)
        .connect_lazy_with(options.clone())
}

/// Dedicated single-connection pool for the readiness probe so probes can
/// neither starve nor be starved by business traffic (E40).
pub fn probe_pool(options: &PgConnectOptions, acquire_timeout: std::time::Duration) -> PgPool {
    PgPoolOptions::new()
        .max_connections(1)
        .min_connections(0)
        .acquire_timeout(acquire_timeout)
        .connect_lazy_with(options.clone())
}

pub fn repositories(pool: PgPool) -> Repositories {
    adapters::repositories(pool)
}

/// Pools that must be closed at the end of the shutdown sequence.
pub struct PostgresResources {
    business: PgPool,
    probe: PgPool,
}

#[async_trait]
impl Closeable for PostgresResources {
    async fn close(&self) {
        self.probe.close().await;
        self.business.close().await;
    }
}

/// Everything the runtime needs from PostgreSQL, built without touching the
/// network.
pub struct PostgresRuntime {
    pub repositories: Repositories,
    pub probe: PostgresReadinessProbe,
    pub resources: PostgresResources,
}

pub fn connect(
    url: &SecretString,
    instance_id: &str,
    pool: &PoolConfig,
    probe_timeout: std::time::Duration,
) -> Result<PostgresRuntime, InvalidDatabaseUrl> {
    let options = connect_options(url, instance_id)?;
    let business = business_pool(&options, pool);
    let probe = probe_pool(&options, probe_timeout);
    Ok(PostgresRuntime {
        repositories: repositories(business.clone()),
        probe: PostgresReadinessProbe::new(probe.clone()),
        resources: PostgresResources { business, probe },
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn pools_are_lazy_and_do_not_connect() {
        // Port 1 on localhost refuses connections; construction must not fail.
        let url = SecretString::new("postgres://u:p@127.0.0.1:1/db");
        let options = connect_options(&url, "rust-test").unwrap();
        let config = PoolConfig {
            max_connections: 2,
            min_connections: 0,
            acquire_timeout: std::time::Duration::from_millis(100),
        };
        let business = business_pool(&options, &config);
        let probe = probe_pool(&options, config.acquire_timeout);
        assert_eq!(business.size(), 0);
        assert_eq!(probe.size(), 0);
    }

    #[test]
    fn invalid_url_error_does_not_echo_the_input() {
        let secret = "s3cr3t-passw0rd";
        let url = SecretString::new(format!("postgres://user:{secret}@host:notaport/db"));
        let error = connect_options(&url, "rust-test").unwrap_err();
        assert!(!error.to_string().contains(secret));
        assert!(!format!("{error:?}").contains(secret));
    }
}
