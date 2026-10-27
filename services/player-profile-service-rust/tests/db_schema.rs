//! Structural expectations of migration 0002 (F52) and the integrity
//! constraints of the `player` schema (I71). Needs PostgreSQL, see
//! `tests/common/mod.rs`.

mod common;

use sqlx::{PgPool, Row};

async fn pool(test: &str) -> Option<sqlx::PgPool> {
    let url = common::database_url(test)?;
    Some(common::test_pool(&url, 2).await)
}

#[tokio::test]
async fn economic_operations_can_store_a_rejection_code() {
    let Some(pool) = pool("economic_operations_can_store_a_rejection_code").await else {
        return;
    };
    let column: Option<String> = sqlx::query_scalar(
        "SELECT data_type FROM information_schema.columns \
         WHERE table_schema = 'player' AND table_name = 'economic_operations' \
           AND column_name = 'rejection_code'",
    )
    .fetch_optional(&pool)
    .await
    .unwrap();
    assert_eq!(
        column.as_deref(),
        Some("text"),
        "economic_operations has no rejection storage: a rejected request cannot be replayed"
    );
}

#[tokio::test]
async fn rejection_code_is_constrained_to_the_contract_codes() {
    let Some(pool) = pool("rejection_code_is_constrained_to_the_contract_codes").await else {
        return;
    };
    let player = common::unique("schema-rej");
    sqlx::query("INSERT INTO player.profiles (player_id, profile_revision) VALUES ($1, 1)")
        .bind(&player)
        .execute(&pool)
        .await
        .unwrap();
    let insert = |request: &'static str, status: &'static str, code: Option<&'static str>| {
        let pool = pool.clone();
        let player = player.clone();
        async move {
            sqlx::query(
                "INSERT INTO player.economic_operations \
                 (player_id, request_id, operation_type, request_fingerprint, status, \
                  rejection_code, profile_revision_after) \
                 VALUES ($1, $2, 'buy', 'fp', $3, $4, 1)",
            )
            .bind(player)
            .bind(request)
            .bind(status)
            .bind(code)
            .execute(&pool)
            .await
        }
    };
    assert!(insert("ok-applied", "applied", None).await.is_ok());
    assert!(insert("ok-rejected", "rejected", Some("NOT_OWNED"))
        .await
        .is_ok());
    assert!(
        insert("bad-code", "rejected", Some("MADE_UP"))
            .await
            .is_err(),
        "unknown rejection code accepted"
    );
    assert!(
        insert("rejected-without-code", "rejected", None)
            .await
            .is_err(),
        "a rejected operation must carry its code"
    );
    assert!(
        insert("applied-with-code", "applied", Some("NOT_OWNED"))
            .await
            .is_err(),
        "an applied operation must not carry a rejection code"
    );
}

#[tokio::test]
async fn the_four_characters_are_item_definitions() {
    let Some(pool) = pool("the_four_characters_are_item_definitions").await else {
        return;
    };
    let ids: Vec<String> = sqlx::query_scalar(
        "SELECT item_id FROM player.item_definitions WHERE item_type = 'character' ORDER BY item_id",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(ids, ["amara", "luna", "nico", "samuel"]);
    let total: i64 = sqlx::query_scalar("SELECT count(*) FROM player.item_definitions")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(total, 22);
}

#[tokio::test]
async fn online_v2_is_the_published_active_catalog_with_all_items() {
    let Some(pool) = pool("online_v2_is_the_published_active_catalog_with_all_items").await else {
        return;
    };
    let version = sqlx::query(
        "SELECT active, published_at IS NOT NULL AS published \
         FROM player.catalog_versions WHERE catalog_version = 'online-v2'",
    )
    .fetch_one(&pool)
    .await
    .expect("online-v2 is not registered");
    assert!(version.get::<bool, _>("active"));
    assert!(version.get::<bool, _>("published"));
    let entries: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM player.catalog_entries WHERE catalog_version = 'online-v2' AND enabled",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(entries, 22);

    // Migration 0004 retired online-v1: kept with its 22 entries, unpublished.
    let retired = sqlx::query(
        "SELECT active, published_at IS NOT NULL AS published \
         FROM player.catalog_versions WHERE catalog_version = 'online-v1'",
    )
    .fetch_one(&pool)
    .await
    .expect("online-v1 is still registered");
    assert!(!retired.get::<bool, _>("active"));
    assert!(!retired.get::<bool, _>("published"));
}

#[tokio::test]
async fn online_v2_economy_values_are_five_times_the_prototype() {
    let Some(pool) = pool("online_v2_economy_values_are_five_times_the_prototype").await else {
        return;
    };
    let rows = sqlx::query(
        "SELECT item_id, price_coins, recipe_plastic, recipe_metal \
         FROM player.catalog_entries WHERE catalog_version = 'online-v2'",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    let get = |id: &str| {
        let row = rows
            .iter()
            .find(|r| r.get::<String, _>("item_id") == id)
            .unwrap_or_else(|| panic!("{id} missing"));
        (
            row.get::<Option<i64>, _>("price_coins"),
            row.get::<i64, _>("recipe_plastic"),
            row.get::<i64, _>("recipe_metal"),
        )
    };
    assert_eq!(get("manglar"), (Some(300), 0, 0));
    assert_eq!(get("sol"), (Some(500), 0, 0));
    assert_eq!(get("brisa"), (Some(200), 0, 0));
    assert_eq!(get("uva"), (Some(400), 0, 0));
    assert_eq!(get("coral"), (Some(0), 0, 0));
    assert_eq!(get("nico"), (Some(0), 0, 0));
    assert_eq!(get("red-reuso"), (None, 30, 15));
    assert_eq!(get("red-marea"), (None, 50, 25));
    assert_eq!(get("red-cobre"), (None, 60, 40));
    assert_eq!(get("red-faro"), (None, 80, 50));
    assert_eq!(get("red-aurora"), (None, 100, 60));
    assert_eq!(get("red-sol"), (None, 120, 80));
}

// ---- integrity constraints (I71) --------------------------------------------
//
// The application keeps the economy consistent, but the database is the last
// line of defence (E41): these tests talk to it directly, bypassing every
// application rule, and check the SQLSTATE so a constraint cannot be replaced
// by an unrelated failure.

const CHECK_VIOLATION: &str = "23514";
const FOREIGN_KEY_VIOLATION: &str = "23503";
const UNIQUE_VIOLATION: &str = "23505";

/// The SQLSTATE a statement fails with, or `None` when it succeeds.
async fn sqlstate(pool: &PgPool, sql: &str, binds: &[&str]) -> Option<String> {
    let mut query = sqlx::query(sql);
    for value in binds {
        query = query.bind(*value);
    }
    match query.execute(pool).await {
        Ok(_) => None,
        Err(sqlx::Error::Database(error)) => error.code().map(|code| code.to_string()),
        Err(other) => panic!("not a database error: {other}"),
    }
}

async fn provisioned(pool: &PgPool, prefix: &str) -> String {
    let player = common::unique(prefix);
    assert_eq!(
        sqlstate(
            pool,
            "INSERT INTO player.profiles (player_id, profile_revision) VALUES ($1, 1)",
            &[&player],
        )
        .await,
        None
    );
    player
}

#[tokio::test]
async fn balances_revision_and_settlement_credits_can_never_be_negative() {
    let Some(pool) = pool("balances_revision_and_settlement_credits_can_never_be_negative").await
    else {
        return;
    };
    let player = provisioned(&pool, "schema-neg").await;
    for column in ["coins", "plastic", "metal", "profile_revision"] {
        let sql = format!("UPDATE player.profiles SET {column} = -1 WHERE player_id = $1");
        assert_eq!(
            sqlstate(&pool, &sql, &[&player]).await.as_deref(),
            Some(CHECK_VIOLATION),
            "{column} accepted a negative value"
        );
    }
    // zero is fine, so the failures above come from the sign check alone
    assert_eq!(
        sqlstate(
            &pool,
            "UPDATE player.profiles SET coins = 0, plastic = 0, metal = 0 WHERE player_id = $1",
            &[&player],
        )
        .await,
        None
    );
    let revision: i64 =
        sqlx::query_scalar("SELECT profile_revision FROM player.profiles WHERE player_id = $1")
            .bind(&player)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(revision, 1, "refused statements changed nothing");

    for (plastic, metal, revision) in [(-1, 0, 1), (0, -1, 1), (0, 0, -1)] {
        let sql = format!(
            "INSERT INTO player.settlements \
             (race_id, player_id, result_fingerprint, credited_plastic, credited_metal, \
              profile_revision_after) VALUES ($1, $2, 'fp', {plastic}, {metal}, {revision})"
        );
        assert_eq!(
            sqlstate(&pool, &sql, &[&common::unique("race"), &player])
                .await
                .as_deref(),
            Some(CHECK_VIOLATION),
            "settlement {plastic}/{metal}/{revision} accepted"
        );
    }
}

#[tokio::test]
async fn ownership_equipment_and_records_refuse_orphans_duplicates_and_unknown_values() {
    let Some(pool) =
        pool("ownership_equipment_and_records_refuse_orphans_duplicates_and_unknown_values").await
    else {
        return;
    };
    let player = provisioned(&pool, "schema-keys").await;
    let own = "INSERT INTO player.owned_items (player_id, item_id, acquisition_type) \
               VALUES ($1, $2, 'buy')";

    // ownership: one row per (player, item), both sides must exist
    assert_eq!(sqlstate(&pool, own, &[&player, "manglar"]).await, None);
    assert_eq!(
        sqlstate(&pool, own, &[&player, "manglar"]).await.as_deref(),
        Some(UNIQUE_VIOLATION),
        "double ownership"
    );
    assert_eq!(
        sqlstate(&pool, own, &[&player, "no-such-item"])
            .await
            .as_deref(),
        Some(FOREIGN_KEY_VIOLATION)
    );
    assert_eq!(
        sqlstate(&pool, own, &["no-such-player", "sol"])
            .await
            .as_deref(),
        Some(FOREIGN_KEY_VIOLATION)
    );

    // equipment: a known slot and an owned item, one item per slot
    let equip = "INSERT INTO player.equipment_slots (player_id, slot, item_id) VALUES ($1, $2, $3)";
    assert_eq!(
        sqlstate(&pool, equip, &[&player, "board", "manglar"]).await,
        None
    );
    assert_eq!(
        sqlstate(&pool, equip, &[&player, "board", "manglar"])
            .await
            .as_deref(),
        Some(UNIQUE_VIOLATION),
        "one item per slot"
    );
    assert_eq!(
        sqlstate(&pool, equip, &[&player, "cape", "manglar"])
            .await
            .as_deref(),
        Some(CHECK_VIOLATION),
        "unknown slot"
    );
    assert_eq!(
        sqlstate(&pool, equip, &[&player, "outfit", "brisa"])
            .await
            .as_deref(),
        Some(FOREIGN_KEY_VIOLATION),
        "equipping an item the player does not own"
    );

    // operations and settlements: the idempotency keys are primary keys
    let operation = "INSERT INTO player.economic_operations \
                     (player_id, request_id, operation_type, request_fingerprint, status, \
                      profile_revision_after) VALUES ($1, $2, $3, 'fp', 'applied', 1)";
    assert_eq!(
        sqlstate(&pool, operation, &[&player, "req-1", "buy"]).await,
        None
    );
    assert_eq!(
        sqlstate(&pool, operation, &[&player, "req-1", "craft"])
            .await
            .as_deref(),
        Some(UNIQUE_VIOLATION),
        "(player_id, request_id) is the idempotency key"
    );
    assert_eq!(
        sqlstate(&pool, operation, &[&player, "req-2", "teleport"])
            .await
            .as_deref(),
        Some(CHECK_VIOLATION),
        "unknown operation type"
    );
    assert_eq!(
        sqlstate(&pool, operation, &["no-such-player", "req-1", "buy"])
            .await
            .as_deref(),
        Some(FOREIGN_KEY_VIOLATION)
    );
    assert_eq!(
        sqlstate(
            &pool,
            "INSERT INTO player.economic_operations \
             (player_id, request_id, operation_type, request_fingerprint, status, catalog_version) \
             VALUES ($1, 'req-3', 'buy', 'fp', 'applied', 'no-such-version')",
            &[&player],
        )
        .await
        .as_deref(),
        Some(FOREIGN_KEY_VIOLATION),
        "unknown catalog version"
    );
    assert_eq!(
        sqlstate(
            &pool,
            "INSERT INTO player.economic_operations \
             (player_id, request_id, operation_type, request_fingerprint, status) \
             VALUES ($1, 'req-4', 'buy', 'fp', 'pending')",
            &[&player],
        )
        .await
        .as_deref(),
        Some(CHECK_VIOLATION),
        "unknown status"
    );

    let settlement = "INSERT INTO player.settlements \
                      (race_id, player_id, result_fingerprint, credited_plastic, credited_metal, \
                       profile_revision_after) VALUES ($1, $2, 'fp', 1, 1, 2)";
    let race = common::unique("race");
    assert_eq!(sqlstate(&pool, settlement, &[&race, &player]).await, None);
    assert_eq!(
        sqlstate(&pool, settlement, &[&race, &player])
            .await
            .as_deref(),
        Some(UNIQUE_VIOLATION),
        "(race_id, player_id) is the settlement key"
    );
    assert_eq!(
        sqlstate(
            &pool,
            settlement,
            &[&common::unique("race"), "no-such-player"]
        )
        .await
        .as_deref(),
        Some(FOREIGN_KEY_VIOLATION)
    );
}

#[tokio::test]
async fn at_most_one_catalog_version_can_be_active() {
    let Some(pool) = pool("at_most_one_catalog_version_can_be_active").await else {
        return;
    };
    // online-v2 is already active, so a second active version must be refused
    // (and, being refused, leaves the shared database untouched).
    assert_eq!(
        sqlstate(
            &pool,
            "INSERT INTO player.catalog_versions (catalog_version, active) VALUES ($1, true)",
            &[&common::unique("second-active")],
        )
        .await
        .as_deref(),
        Some(UNIQUE_VIOLATION)
    );
    assert_eq!(
        sqlstate(
            &pool,
            "INSERT INTO player.catalog_versions (catalog_version, active) VALUES ($1, false)",
            &[&common::unique("inactive")],
        )
        .await,
        None,
        "any number of inactive versions is fine"
    );
}
