//! Structural expectations of migration 0002 (F52). Needs PostgreSQL, see
//! `tests/common/mod.rs`.

mod common;

use sqlx::Row;

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
async fn online_v1_is_the_published_active_catalog_with_all_items() {
    let Some(pool) = pool("online_v1_is_the_published_active_catalog_with_all_items").await else {
        return;
    };
    let version = sqlx::query(
        "SELECT active, published_at IS NOT NULL AS published \
         FROM player.catalog_versions WHERE catalog_version = 'online-v1'",
    )
    .fetch_one(&pool)
    .await
    .expect("online-v1 is not registered");
    assert!(version.get::<bool, _>("active"));
    assert!(version.get::<bool, _>("published"));
    let entries: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM player.catalog_entries WHERE catalog_version = 'online-v1' AND enabled",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(entries, 22);
}

#[tokio::test]
async fn online_v1_economy_values_match_the_prototype() {
    let Some(pool) = pool("online_v1_economy_values_match_the_prototype").await else {
        return;
    };
    let rows = sqlx::query(
        "SELECT item_id, price_coins, recipe_plastic, recipe_metal \
         FROM player.catalog_entries WHERE catalog_version = 'online-v1'",
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
    assert_eq!(get("manglar"), (Some(60), 0, 0));
    assert_eq!(get("sol"), (Some(100), 0, 0));
    assert_eq!(get("brisa"), (Some(40), 0, 0));
    assert_eq!(get("uva"), (Some(80), 0, 0));
    assert_eq!(get("coral"), (Some(0), 0, 0));
    assert_eq!(get("nico"), (Some(0), 0, 0));
    assert_eq!(get("red-reuso"), (None, 6, 3));
    assert_eq!(get("red-marea"), (None, 10, 5));
    assert_eq!(get("red-cobre"), (None, 12, 8));
    assert_eq!(get("red-faro"), (None, 16, 10));
    assert_eq!(get("red-aurora"), (None, 20, 12));
    assert_eq!(get("red-sol"), (None, 24, 16));
}
