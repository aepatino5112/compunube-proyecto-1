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

// ---- application-level helpers shared by the economy test binaries --------

use player_profile_service::{
    application::{
        ExchangeMaterialsCommand, ItemCommand, MutationOutcome, PlayerProfileApp,
        SetAppearanceCommand,
    },
    domain::{Material, MutationRejection, ProfileState},
    repository::{postgres, LockMode, Repositories},
};

pub const CATALOG: &str = "online-v1";

pub struct Env {
    pub pool: PgPool,
    pub repos: Repositories,
    pub app: PlayerProfileApp,
}

pub async fn env(test: &str) -> Option<Env> {
    let url = database_url(test)?;
    let pool = test_pool(&url, 30).await;
    let repos = postgres::repositories(pool.clone());
    Some(Env {
        app: PlayerProfileApp::new(repos.clone()),
        repos,
        pool,
    })
}

impl Env {
    /// Provisions the player and sets its balances directly (test setup only).
    pub async fn fund(&self, player: &str, coins: i64, plastic: i64, metal: i64) {
        let mut tx = self.repos.transactions.begin().await.unwrap();
        tx.lock_profile(player, LockMode::Update).await.unwrap();
        tx.commit().await.unwrap();
        sqlx::query(
            "UPDATE player.profiles SET coins = $2, plastic = $3, metal = $4 WHERE player_id = $1",
        )
        .bind(player)
        .bind(coins)
        .bind(plastic)
        .bind(metal)
        .execute(&self.pool)
        .await
        .unwrap();
    }

    pub async fn profile(&self, player: &str) -> ProfileState {
        let mut tx = self.repos.transactions.begin().await.unwrap();
        let state = tx.lock_profile(player, LockMode::Share).await.unwrap();
        tx.commit().await.unwrap();
        state
    }

    pub async fn count(&self, sql: &str, player: &str) -> i64 {
        sqlx::query_scalar(sql)
            .bind(player)
            .fetch_one(&self.pool)
            .await
            .unwrap()
    }

    pub async fn buy(&self, player: &str, request: &str, item: &str) -> MutationOutcome {
        self.buy_in(player, request, CATALOG, item).await
    }

    pub async fn buy_in(
        &self,
        player: &str,
        request: &str,
        version: &str,
        item: &str,
    ) -> MutationOutcome {
        self.app
            .buy_item(item_command(player, request, version, item))
            .await
            .unwrap()
            .outcome
    }

    pub async fn craft(&self, player: &str, request: &str, item: &str) -> MutationOutcome {
        self.app
            .craft_item(item_command(player, request, CATALOG, item))
            .await
            .unwrap()
            .outcome
    }

    pub async fn equip(&self, player: &str, request: &str, item: &str) -> MutationOutcome {
        self.app
            .equip_item(item_command(player, request, CATALOG, item))
            .await
            .unwrap()
            .outcome
    }

    pub async fn exchange(
        &self,
        player: &str,
        request: &str,
        material: Material,
        amount: u64,
    ) -> MutationOutcome {
        self.app
            .exchange_materials(ExchangeMaterialsCommand {
                player_id: player.into(),
                request_id: request.into(),
                catalog_version: CATALOG.into(),
                material,
                amount,
            })
            .await
            .unwrap()
            .outcome
    }

    pub async fn appearance(
        &self,
        player: &str,
        request: &str,
        skin: &str,
        hair: &str,
    ) -> MutationOutcome {
        self.app
            .set_appearance(SetAppearanceCommand {
                player_id: player.into(),
                request_id: request.into(),
                catalog_version: CATALOG.into(),
                skin_id: skin.into(),
                hair_color_id: hair.into(),
            })
            .await
            .unwrap()
            .outcome
    }
}

pub fn item_command(player: &str, request: &str, version: &str, item: &str) -> ItemCommand {
    ItemCommand {
        player_id: player.into(),
        request_id: request.into(),
        catalog_version: version.into(),
        item_id: item.into(),
    }
}

pub fn applied(outcome: MutationOutcome) -> (bool, ProfileState) {
    match outcome {
        MutationOutcome::Applied { replayed, profile } => (replayed, profile),
        other => panic!("expected an applied mutation, got {other:?}"),
    }
}

pub fn rejected(outcome: MutationOutcome) -> (MutationRejection, bool) {
    match outcome {
        MutationOutcome::Rejected {
            rejection,
            replayed,
        } => (rejection, replayed),
        other => panic!("expected a rejection, got {other:?}"),
    }
}
