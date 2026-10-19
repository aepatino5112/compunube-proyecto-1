//! Shared helpers for the PostgreSQL-backed integration tests.
//!
//! The tests need a database migrated with `database/scripts/migrate.sh`.
//! Point `PLAYER_TEST_DATABASE_URL` at it. When the variable is unset the tests
//! skip with a loud message so a plain `cargo test` keeps working on a laptop;
//! CI sets `PLAYER_TEST_REQUIRE_DB=1`, which turns a missing database into a
//! hard failure so the suite can never pass by skipping.
#![allow(dead_code)] // each test binary uses a different subset

use std::{
    io::Write,
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

use sqlx::{postgres::PgPoolOptions, PgPool};

pub const URL_VAR: &str = "PLAYER_TEST_DATABASE_URL";
pub const REQUIRE_VAR: &str = "PLAYER_TEST_REQUIRE_DB";

/// The database URL, or `None` (after a loud notice) when DB tests must skip.
pub fn database_url(test: &str) -> Option<String> {
    match std::env::var(URL_VAR) {
        Ok(url) if !url.trim().is_empty() => Some(url),
        _ => {
            assert!(
                std::env::var(REQUIRE_VAR).map_or(true, |v| v != "1"),
                "{URL_VAR} is required ({REQUIRE_VAR}=1) but not set"
            );
            // Written straight to stderr: `eprintln!` would be swallowed by the
            // test harness' output capture and the skip would go unnoticed.
            let _ = writeln!(
                std::io::stderr(),
                "\n!!! SKIPPED `{test}`: {URL_VAR} is not set. Run database/scripts/migrate.sh \
                 against a throwaway PostgreSQL and export the URL to execute DB tests. !!!\n"
            );
            None
        }
    }
}

pub async fn test_pool(url: &str, max_connections: u32) -> PgPool {
    PgPoolOptions::new()
        .max_connections(max_connections)
        .acquire_timeout(std::time::Duration::from_secs(10))
        .connect(url)
        .await
        .expect("cannot connect to PLAYER_TEST_DATABASE_URL")
}

static COUNTER: AtomicU64 = AtomicU64::new(0);

/// A player/request/race id that no other test (or earlier run) can collide
/// with, so tests never depend on global ordering or a clean database.
pub fn unique(prefix: &str) -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let n = COUNTER.fetch_add(1, Ordering::SeqCst);
    format!("{prefix}-{}-{nanos}-{n}", std::process::id())
}
