//! Read-only readiness probe (E40). It runs on its own single-connection pool
//! and never mutates anything:
//!
//! 1. `SELECT 1` proves the application credentials can run a query;
//! 2. `public.schema_migrations` must contain the required version (`0002`);
//! 3. every `player.*` table the service owns must exist.
//!
//! Failure reasons are fixed texts plus a SQLSTATE; driver messages are never
//! included because they may contain connection details.

use async_trait::async_trait;
use sqlx::{pool::PoolConnection, PgPool, Postgres};

use super::error::describe_sqlx_error;
use crate::health::{ProbeFailure, ReadinessProbe};

/// Latest migration the service needs (database/migrations): `0002` publishes
/// the `online-v1` catalog, the characters and the rejection storage the
/// economy relies on. It can only be applied after `0001`, which creates the
/// `player` schema, so one version proves both.
pub const REQUIRED_MIGRATION: &str = "0002";

/// Tables of schema `player` defined by E41.
pub const REQUIRED_PLAYER_TABLES: [&str; 9] = [
    "profiles",
    "catalog_versions",
    "item_definitions",
    "catalog_entries",
    "owned_items",
    "equipment_slots",
    "profile_appearance",
    "economic_operations",
    "settlements",
];

pub struct PostgresReadinessProbe {
    pool: PgPool,
    required_migration: String,
}

impl PostgresReadinessProbe {
    pub fn new(pool: PgPool) -> Self {
        Self::with_required_migration(pool, REQUIRED_MIGRATION)
    }

    /// Probe that demands a specific migration version. Production code uses
    /// [`PostgresReadinessProbe::new`]; this exists so tests can prove that a
    /// missing migration keeps the instance `NOT_SERVING`.
    pub fn with_required_migration(pool: PgPool, version: impl Into<String>) -> Self {
        Self {
            pool,
            required_migration: version.into(),
        }
    }
}

/// Tables from `required` that are absent from `present`, in `required` order.
pub fn missing_tables(required: &[&str], present: &[String]) -> Vec<String> {
    required
        .iter()
        .filter(|name| !present.iter().any(|found| found == **name))
        .map(|name| (*name).to_string())
        .collect()
}

fn query_failure(context: &str, error: &sqlx::Error) -> ProbeFailure {
    if let sqlx::Error::Database(db) = error {
        match db.code().as_deref() {
            Some("42P01") => {
                return ProbeFailure::new(format!("{context}: relation does not exist"));
            }
            Some("42501") => {
                return ProbeFailure::new(format!("{context}: permission denied for role"));
            }
            _ => {}
        }
    }
    ProbeFailure::new(format!("{context}: {}", describe_sqlx_error(error)))
}

async fn run_checks(
    conn: &mut PoolConnection<Postgres>,
    required_migration: &str,
) -> Result<(), ProbeFailure> {
    sqlx::query("SELECT 1")
        .execute(&mut **conn)
        .await
        .map_err(|e| query_failure("database query failed", &e))?;

    let migrated: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM public.schema_migrations WHERE version = $1)",
    )
    .bind(required_migration)
    .fetch_one(&mut **conn)
    .await
    .map_err(|e| query_failure("schema migration check failed", &e))?;
    if !migrated {
        return Err(ProbeFailure::new(format!(
            "migration {required_migration} has not been applied"
        )));
    }

    let required: Vec<String> = REQUIRED_PLAYER_TABLES
        .iter()
        .map(|name| (*name).to_string())
        .collect();
    let present: Vec<String> = sqlx::query_scalar(
        "SELECT tablename::text FROM pg_catalog.pg_tables \
         WHERE schemaname = 'player' AND tablename = ANY($1)",
    )
    .bind(&required)
    .fetch_all(&mut **conn)
    .await
    .map_err(|e| query_failure("player schema check failed", &e))?;

    let missing = missing_tables(&REQUIRED_PLAYER_TABLES, &present);
    if !missing.is_empty() {
        return Err(ProbeFailure::new(format!(
            "player schema is incomplete, missing tables: {}",
            missing.join(", ")
        )));
    }
    Ok(())
}

#[async_trait]
impl ReadinessProbe for PostgresReadinessProbe {
    async fn check(&self) -> Result<(), ProbeFailure> {
        let mut conn = self.pool.acquire().await.map_err(|error| {
            ProbeFailure::new(format!(
                "database unreachable: {}",
                describe_sqlx_error(&error)
            ))
        })?;
        run_checks(&mut conn, &self.required_migration).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn readiness_requires_the_economy_migration() {
        assert_eq!(REQUIRED_MIGRATION, "0002");
    }

    #[test]
    fn required_tables_match_the_e41_player_schema() {
        assert_eq!(REQUIRED_PLAYER_TABLES.len(), 9);
        assert!(REQUIRED_PLAYER_TABLES.contains(&"settlements"));
        assert!(REQUIRED_PLAYER_TABLES.contains(&"economic_operations"));
    }

    #[test]
    fn missing_tables_reports_only_absent_ones_in_order() {
        let present = vec!["profiles".to_string(), "settlements".to_string()];
        let missing = missing_tables(&["profiles", "owned_items", "settlements", "x"], &present);
        assert_eq!(missing, vec!["owned_items".to_string(), "x".to_string()]);
        assert!(missing_tables(&["profiles"], &present).is_empty());
    }

    #[tokio::test]
    async fn unreachable_database_fails_without_leaking_connection_details() {
        use sqlx::postgres::PgConnectOptions;
        use std::str::FromStr;
        let options =
            PgConnectOptions::from_str("postgres://user:s3cr3t-passw0rd@127.0.0.1:1/db").unwrap();
        let pool = super::super::probe_pool(&options, std::time::Duration::from_millis(300));
        let failure = PostgresReadinessProbe::new(pool).check().await.unwrap_err();
        assert!(failure.reason.starts_with("database unreachable"));
        assert!(!failure.reason.contains("s3cr3t"));
        assert!(!failure.reason.contains("127.0.0.1"));
    }
}
