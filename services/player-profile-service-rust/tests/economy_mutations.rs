//! The five mutations against PostgreSQL through the application layer
//! (F52-T4): rules, durable idempotency and concurrency. Needs a migrated
//! database, see `tests/common/mod.rs`.

mod common;

use common::{applied, rejected, unique};
use player_profile_service::{
    application::ApplicationError,
    domain::{Material, MutationRejection as R},
};

macro_rules! env {
    ($name:expr) => {
        match common::env($name).await {
            Some(env) => env,
            None => return,
        }
    };
}

/// Everything a mutation may leave behind for one player: the profile (balances,
/// equipment, appearance, revision) and the raw rows of the ledger and of the
/// ownership/equipment tables. Two equal snapshots mean "nothing happened".
#[derive(Debug, PartialEq)]
struct Persisted {
    profile: player_profile_service::domain::ProfileState,
    operations: Vec<(String, String, String, String, Option<i64>)>,
    owned: Vec<(String, String)>,
    slots: Vec<(String, String)>,
}

async fn persisted(env: &common::Env, player: &str) -> Persisted {
    Persisted {
        profile: env.profile(player).await,
        operations: sqlx::query_as(
            "SELECT request_id, operation_type, request_fingerprint, status::text, profile_revision_after \
             FROM player.economic_operations WHERE player_id = $1 ORDER BY request_id",
        )
        .bind(player)
        .fetch_all(&env.pool)
        .await
        .unwrap(),
        owned: sqlx::query_as(
            "SELECT item_id, acquisition_type FROM player.owned_items WHERE player_id = $1 ORDER BY item_id",
        )
        .bind(player)
        .fetch_all(&env.pool)
        .await
        .unwrap(),
        slots: sqlx::query_as(
            "SELECT slot, item_id FROM player.equipment_slots WHERE player_id = $1 ORDER BY slot",
        )
        .bind(player)
        .fetch_all(&env.pool)
        .await
        .unwrap(),
    }
}

// ---- BuyItem ---------------------------------------------------------------

#[tokio::test]
async fn buy_applies_once_and_a_replay_has_no_extra_effect() {
    let env = env!("buy_applies_once_and_a_replay_has_no_extra_effect");
    let player = unique("buy");
    env.fund(&player, 500, 0, 0).await;

    let (replayed, profile) = applied(env.buy(&player, "r1", "manglar").await);
    assert!(!replayed);
    assert_eq!((profile.coins, profile.revision), (200, 2));
    assert!(profile.owns("manglar"));

    let (replayed, again) = applied(env.buy(&player, "r1", "manglar").await);
    assert!(replayed, "same request and payload is a replay");
    assert_eq!(again, profile, "no second charge, no second revision");
    assert_eq!(
        env.count(
            "SELECT count(*) FROM player.economic_operations WHERE player_id = $1",
            &player
        )
        .await,
        1
    );
    assert_eq!(
        env.count(
            "SELECT count(*) FROM player.owned_items WHERE player_id = $1 AND item_id = 'manglar'",
            &player
        )
        .await,
        1
    );
}

#[tokio::test]
async fn the_same_request_id_with_a_different_payload_is_an_idempotency_conflict() {
    let env = env!("same_request_id_with_a_different_payload");
    let player = unique("conflict");
    env.fund(&player, 500, 0, 0).await;
    applied(env.buy(&player, "r1", "manglar").await);
    let before = env.profile(&player).await;

    assert_eq!(
        rejected(env.buy(&player, "r1", "sol").await),
        (R::IdempotencyConflict, false)
    );
    // different catalog version string is also a different payload
    assert_eq!(
        rejected(env.buy_in(&player, "r1", "online-v1", "manglar").await),
        (R::IdempotencyConflict, false)
    );
    assert_eq!(
        env.profile(&player).await,
        before,
        "a conflict changes nothing"
    );
    // the original record survives and still replays
    let (replayed, _) = applied(env.buy(&player, "r1", "manglar").await);
    assert!(replayed);
    assert_eq!(
        env.count(
            "SELECT count(*) FROM player.economic_operations WHERE player_id = $1",
            &player
        )
        .await,
        1
    );
}

#[tokio::test]
async fn a_rejected_request_replays_as_the_same_rejection_even_after_the_state_changes() {
    let env = env!("a_rejected_request_replays_as_the_same_rejection");
    let player = unique("rejreplay");
    env.fund(&player, 0, 0, 0).await;

    assert_eq!(
        rejected(env.buy(&player, "r1", "manglar").await),
        (R::InsufficientCoins, false)
    );
    let after_reject = env.profile(&player).await;
    assert_eq!(
        after_reject.revision, 1,
        "a rejection does not bump the revision"
    );

    env.fund(&player, 1_000, 0, 0).await; // now the purchase would succeed
    assert_eq!(
        rejected(env.buy(&player, "r1", "manglar").await),
        (R::InsufficientCoins, true),
        "the stored rejection wins over the new state"
    );
    assert!(!env.profile(&player).await.owns("manglar"));
    // a new request id is evaluated against the current state
    applied(env.buy(&player, "r2", "manglar").await);
    // and a conflicting payload on the rejected id still conflicts
    assert_eq!(
        rejected(env.buy(&player, "r1", "sol").await),
        (R::IdempotencyConflict, false)
    );
}

#[tokio::test]
async fn buy_rejections_follow_the_documented_order_and_codes() {
    let env = env!("buy_rejections_follow_the_documented_order");
    let player = unique("buyrej");
    env.fund(&player, 59, 0, 0).await;
    let cases = [
        ("unknown", "ghost", R::InvalidItem),
        ("owned", "coral", R::AlreadyOwned),
        ("craftable", "red-reuso", R::InvalidAction),
        ("poor", "manglar", R::InsufficientCoins),
    ];
    for (request, item, code) in cases {
        assert_eq!(
            rejected(env.buy(&player, request, item).await),
            (code, false),
            "{item}"
        );
    }
    assert_eq!(
        rejected(
            env.buy_in(&player, "nover", "no-such-version", "manglar")
                .await
        ),
        (R::InvalidCatalogVersion, false)
    );
    assert_eq!(
        rejected(env.buy_in(&player, "emptyver", "", "manglar").await),
        (R::InvalidCatalogVersion, false)
    );
    let profile = env.profile(&player).await;
    assert_eq!((profile.coins, profile.revision), (59, 1));

    // unknown versions are stored with a NULL catalog_version (FK) and replay
    let stored: Option<String> = sqlx::query_scalar(
        "SELECT catalog_version FROM player.economic_operations WHERE player_id = $1 AND request_id = 'nover'",
    )
    .bind(&player)
    .fetch_one(&env.pool)
    .await
    .unwrap();
    assert_eq!(stored, None);
    assert_eq!(
        rejected(
            env.buy_in(&player, "nover", "no-such-version", "manglar")
                .await
        ),
        (R::InvalidCatalogVersion, true)
    );
}

#[tokio::test]
async fn an_unpublished_catalog_version_is_invalid() {
    let env = env!("an_unpublished_catalog_version_is_invalid");
    let player = unique("draftver");
    env.fund(&player, 100, 0, 0).await;
    let draft = unique("draft");
    sqlx::query("INSERT INTO player.catalog_versions (catalog_version, active) VALUES ($1, false)")
        .bind(&draft)
        .execute(&env.pool)
        .await
        .unwrap();
    assert_eq!(
        rejected(env.buy_in(&player, "r1", &draft, "manglar").await),
        (R::InvalidCatalogVersion, false)
    );
}

#[tokio::test]
async fn the_first_mutation_provisions_the_profile_lazily() {
    let env = env!("the_first_mutation_provisions_the_profile_lazily");
    let player = unique("lazy");
    let (_, profile) = applied(env.equip(&player, "r1", "luna").await);
    assert_eq!(
        profile.revision, 2,
        "provisioned at 1, then the equip applied"
    );
    assert_eq!(profile.equipment.character_id, "luna");
    assert_eq!(
        env.count(
            "SELECT count(*) FROM player.profiles WHERE player_id = $1",
            &player
        )
        .await,
        1
    );
}

// ---- CraftItem -------------------------------------------------------------

#[tokio::test]
async fn craft_spends_materials_and_grants_the_net() {
    let env = env!("craft_spends_materials_and_grants_the_net");
    let player = unique("craft");
    env.fund(&player, 5, 34, 17).await;
    let (_, profile) = applied(env.craft(&player, "c1", "red-reuso").await);
    assert_eq!((profile.plastic, profile.metal, profile.coins), (4, 2, 5));
    assert!(profile.owns("red-reuso"));
    let acquisition: String = sqlx::query_scalar(
        "SELECT acquisition_type FROM player.owned_items WHERE player_id = $1 AND item_id = 'red-reuso'",
    )
    .bind(&player)
    .fetch_one(&env.pool)
    .await
    .unwrap();
    assert_eq!(acquisition, "craft");

    assert_eq!(
        rejected(env.craft(&player, "c2", "red-reuso").await),
        (R::AlreadyOwned, false)
    );
    assert_eq!(
        rejected(env.craft(&player, "c3", "red-marea").await),
        (R::InsufficientMaterials, false)
    );
    assert_eq!(
        rejected(env.craft(&player, "c4", "manglar").await),
        (R::InvalidAction, false)
    );
    assert_eq!(
        rejected(env.craft(&player, "c5", "ghost").await),
        (R::InvalidItem, false)
    );
    let (replayed, again) = applied(env.craft(&player, "c1", "red-reuso").await);
    assert!(replayed);
    assert_eq!((again.plastic, again.metal), (4, 2));
}

#[tokio::test]
async fn craft_reusing_a_request_id_for_another_payload_is_a_conflict_that_changes_nothing() {
    let env = env!("craft_reusing_a_request_id_for_another_payload");
    let player = unique("craftconf");
    env.fund(&player, 500, 40, 40).await;
    let (_, crafted) = applied(env.craft(&player, "c1", "red-reuso").await);
    let before = persisted(&env, &player).await;
    assert_eq!(before.profile, crafted);

    // another item, another catalog version, another operation: all conflict
    assert_eq!(
        rejected(env.craft(&player, "c1", "red-marea").await),
        (R::IdempotencyConflict, false)
    );
    assert_eq!(
        rejected(
            env.app
                .craft_item(common::item_command(
                    &player,
                    "c1",
                    "online-v1",
                    "red-reuso"
                ))
                .await
                .unwrap()
                .outcome
        ),
        (R::IdempotencyConflict, false)
    );
    // same request id and same item, but a buy is not a craft
    assert_eq!(
        rejected(env.buy(&player, "c1", "red-reuso").await),
        (R::IdempotencyConflict, false)
    );
    assert_eq!(
        persisted(&env, &player).await,
        before,
        "a conflict records nothing and changes no balance, item or revision"
    );
    let (replayed, again) = applied(env.craft(&player, "c1", "red-reuso").await);
    assert!(replayed, "the original record still replays");
    assert_eq!(again, crafted);
    assert_eq!(persisted(&env, &player).await, before);
}

// ---- ExchangeMaterials -----------------------------------------------------

#[tokio::test]
async fn exchange_converts_materials_at_the_online_v1_rates() {
    let env = env!("exchange_converts_materials_at_the_online_v1_rates");
    let player = unique("exch");
    env.fund(&player, 0, 10, 10).await;
    let (_, profile) = applied(env.exchange(&player, "e1", Material::Plastic, 3).await);
    assert_eq!((profile.coins, profile.plastic, profile.metal), (12, 7, 10));
    let (_, profile) = applied(env.exchange(&player, "e2", Material::Metal, 4).await);
    assert_eq!((profile.coins, profile.plastic, profile.metal), (36, 7, 6));
    assert_eq!(profile.revision, 3);
    assert_eq!(
        rejected(env.exchange(&player, "e3", Material::Plastic, 8).await),
        (R::InsufficientMaterials, false)
    );
    let (replayed, again) = applied(env.exchange(&player, "e1", Material::Plastic, 3).await);
    assert!(replayed);
    assert_eq!(again.coins, 36);
    assert_eq!(
        rejected(env.exchange(&player, "e1", Material::Plastic, 4).await),
        (R::IdempotencyConflict, false)
    );
    assert_eq!(
        rejected(env.exchange(&player, "e1", Material::Metal, 3).await),
        (R::IdempotencyConflict, false)
    );
}

#[tokio::test]
async fn exchange_rejects_malformed_amounts_as_invalid_arguments() {
    let env = env!("exchange_rejects_malformed_amounts");
    let player = unique("exchbad");
    for amount in [0, 1_000_000_000, u64::MAX] {
        let result = env
            .app
            .exchange_materials(
                player_profile_service::application::ExchangeMaterialsCommand {
                    player_id: player.clone(),
                    request_id: "e".into(),
                    catalog_version: common::CATALOG.into(),
                    material: Material::Plastic,
                    amount,
                },
            )
            .await;
        assert!(
            matches!(result, Err(ApplicationError::InvalidArgument(_))),
            "{amount}"
        );
    }
    assert_eq!(
        env.count(
            "SELECT count(*) FROM player.profiles WHERE player_id = $1",
            &player
        )
        .await,
        0
    );
}

#[tokio::test]
async fn an_exchange_that_would_overflow_the_coin_column_is_refused_and_replays_as_refused() {
    let env = env!("an_exchange_that_would_overflow_the_coin_column");
    let player = unique("exchfull");
    let limit = i64::MAX;
    env.fund(&player, limit - 3, 10, 10).await;
    // 1 plastic pays 4 coins, 1 metal pays 6: neither fits below the limit
    for (request, material) in [("o1", Material::Plastic), ("o2", Material::Metal)] {
        assert_eq!(
            rejected(env.exchange(&player, request, material, 1).await),
            (R::InvalidAction, false),
            "{request}"
        );
    }
    let profile = env.profile(&player).await;
    assert_eq!(
        (
            profile.coins,
            profile.plastic,
            profile.metal,
            profile.revision
        ),
        (limit as u64 - 3, 10, 10, 1),
        "a refused exchange changes nothing"
    );
    // the refusal is stored, so it replays as the same refusal
    assert_eq!(
        rejected(env.exchange(&player, "o1", Material::Plastic, 1).await),
        (R::InvalidAction, true)
    );
    // what still fits is applied
    env.fund(&player, limit - 4, 10, 10).await;
    let (_, profile) = applied(env.exchange(&player, "o3", Material::Plastic, 1).await);
    assert_eq!((profile.coins, profile.plastic), (limit as u64, 9));
}

// ---- EquipItem -------------------------------------------------------------

#[tokio::test]
async fn equip_needs_ownership_and_uses_the_slot_of_the_items_type() {
    let env = env!("equip_needs_ownership_and_uses_the_slot");
    let player = unique("equip");
    env.fund(&player, 500, 0, 0).await;
    assert_eq!(
        rejected(env.equip(&player, "q1", "manglar").await),
        (R::NotOwned, false)
    );
    assert_eq!(
        rejected(env.equip(&player, "q2", "ghost").await),
        (R::InvalidItem, false)
    );
    assert_eq!(env.profile(&player).await.equipment.board_id, "coral");

    applied(env.buy(&player, "b1", "manglar").await);
    applied(env.buy(&player, "b2", "brisa").await);
    let (_, profile) = applied(env.equip(&player, "q3", "manglar").await);
    assert_eq!(profile.equipment.board_id, "manglar");
    assert_eq!(
        profile.equipment.outfit_id, "costero",
        "other slots stay as they were"
    );
    let (_, profile) = applied(env.equip(&player, "q4", "brisa").await);
    assert_eq!(profile.equipment.outfit_id, "brisa");
    assert_eq!(profile.equipment.board_id, "manglar");
    let (_, profile) = applied(env.equip(&player, "q5", "ponytail").await);
    assert_eq!(profile.equipment.hair_id, "ponytail");

    let slots: Vec<(String, String)> = sqlx::query_as(
        "SELECT slot, item_id FROM player.equipment_slots WHERE player_id = $1 ORDER BY slot",
    )
    .bind(&player)
    .fetch_all(&env.pool)
    .await
    .unwrap();
    assert_eq!(slots.len(), 5);
    // every stored slot holds an item of that type
    for (slot, item) in slots {
        let item_type: String =
            sqlx::query_scalar("SELECT item_type FROM player.item_definitions WHERE item_id = $1")
                .bind(&item)
                .fetch_one(&env.pool)
                .await
                .unwrap();
        assert_eq!(item_type, slot, "{item} sits in the {slot} slot");
    }
}

#[tokio::test]
async fn equipping_a_character_also_sets_hair_and_look_and_equipping_again_still_applies() {
    let env = env!("equipping_a_character_also_sets_hair_and_look");
    let player = unique("char");
    let (_, profile) = applied(env.equip(&player, "q1", "amara").await);
    assert_eq!(profile.equipment.character_id, "amara");
    assert_eq!(profile.equipment.hair_id, "afro");
    assert_eq!(profile.appearance.skin_id, "dark");
    assert_eq!(profile.appearance.hair_color_id, "black");

    // already equipped: applied, revision still advances (E8, E11)
    let (replayed, again) = applied(env.equip(&player, "q2", "amara").await);
    assert!(!replayed);
    assert_eq!(again.revision, profile.revision + 1);
    assert_eq!(again.equipment, profile.equipment);
}

#[tokio::test]
async fn equip_replays_the_same_request_without_extra_effects() {
    let env = env!("equip_replays_the_same_request");
    let player = unique("equiprep");
    env.fund(&player, 500, 0, 0).await;
    applied(env.buy(&player, "b1", "manglar").await);
    let (replayed, equipped) = applied(env.equip(&player, "q1", "manglar").await);
    assert!(!replayed);
    assert_eq!(equipped.equipment.board_id, "manglar");
    assert_eq!(equipped.revision, 3, "profile at 1, buy at 2, equip at 3");
    let before = persisted(&env, &player).await;
    assert_eq!(before.profile, equipped);
    assert_eq!(before.operations.len(), 2, "one buy and one equip");

    for _ in 0..2 {
        let (replayed, again) = applied(env.equip(&player, "q1", "manglar").await);
        assert!(replayed, "same request and payload is a replay");
        assert_eq!(again, equipped, "same profile and same revision");
    }
    assert_eq!(
        persisted(&env, &player).await,
        before,
        "no extra revision, balance, equipment or ledger row"
    );
}

#[tokio::test]
async fn equip_reusing_a_request_id_for_another_payload_is_a_conflict_that_changes_nothing() {
    let env = env!("equip_reusing_a_request_id_for_another_payload");
    let player = unique("equipconf");
    env.fund(&player, 500, 0, 0).await;
    applied(env.buy(&player, "b1", "manglar").await);
    applied(env.buy(&player, "b2", "brisa").await);
    let (_, equipped) = applied(env.equip(&player, "q1", "manglar").await);
    let before = persisted(&env, &player).await;
    assert_eq!(before.profile, equipped);

    // an owned item that would otherwise apply (a different slot, even)
    assert_eq!(
        rejected(env.equip(&player, "q1", "brisa").await),
        (R::IdempotencyConflict, false)
    );
    // an unknown item and another catalog version are different payloads too
    assert_eq!(
        rejected(env.equip(&player, "q1", "ghost").await),
        (R::IdempotencyConflict, false)
    );
    assert_eq!(
        rejected(
            env.app
                .equip_item(common::item_command(&player, "q1", "online-v1", "manglar"))
                .await
                .unwrap()
                .outcome
        ),
        (R::IdempotencyConflict, false)
    );
    // and so is another operation type under the same request id, even with
    // the same item id
    assert_eq!(
        rejected(env.buy(&player, "q1", "manglar").await),
        (R::IdempotencyConflict, false)
    );
    assert_eq!(
        rejected(env.appearance(&player, "q1", "deep", "blue").await),
        (R::IdempotencyConflict, false)
    );
    let after = persisted(&env, &player).await;
    assert_eq!(after, before, "a conflict changes nothing that persists");
    assert_eq!(after.profile.equipment.outfit_id, "costero");
    assert_eq!(after.profile.equipment.board_id, "manglar");

    let (replayed, again) = applied(env.equip(&player, "q1", "manglar").await);
    assert!(replayed, "the original record still replays");
    assert_eq!(again, equipped);
    assert_eq!(persisted(&env, &player).await, before);
}

// ---- SetAppearance ---------------------------------------------------------

#[tokio::test]
async fn appearance_accepts_listed_options_only() {
    let env = env!("appearance_accepts_listed_options_only");
    let player = unique("look");
    let (_, profile) = applied(env.appearance(&player, "a1", "deep", "blue").await);
    assert_eq!(profile.appearance.skin_id, "deep");
    assert_eq!(profile.appearance.hair_color_id, "blue");
    assert_eq!(profile.revision, 2);
    for (request, skin, hair) in [
        ("a2", "nope", "blue"),
        ("a3", "deep", "nope"),
        ("a4", "", ""),
    ] {
        assert_eq!(
            rejected(env.appearance(&player, request, skin, hair).await),
            (R::InvalidAppearance, false)
        );
    }
    assert_eq!(env.profile(&player).await.appearance, profile.appearance);
    // equal to the current look: still applied
    let (_, same) = applied(env.appearance(&player, "a5", "deep", "blue").await);
    assert_eq!(same.revision, 3);
    // a replayed rejection stays rejected
    assert_eq!(
        rejected(env.appearance(&player, "a2", "nope", "blue").await),
        (R::InvalidAppearance, true)
    );
}

#[tokio::test]
async fn appearance_replays_the_same_request_without_extra_effects() {
    let env = env!("appearance_replays_the_same_request");
    let player = unique("lookrep");
    let (replayed, styled) = applied(env.appearance(&player, "a1", "deep", "blue").await);
    assert!(!replayed);
    assert_eq!(
        styled.revision, 2,
        "provisioned at 1, then the look applied"
    );
    let before = persisted(&env, &player).await;
    assert_eq!(before.profile, styled);
    assert_eq!(before.operations.len(), 1);

    for _ in 0..2 {
        let (replayed, again) = applied(env.appearance(&player, "a1", "deep", "blue").await);
        assert!(replayed, "same request and payload is a replay");
        assert_eq!(again, styled, "same profile and same revision");
    }
    assert_eq!(
        persisted(&env, &player).await,
        before,
        "no extra revision or ledger row"
    );
}

#[tokio::test]
async fn appearance_reusing_a_request_id_for_another_payload_is_a_conflict_that_changes_nothing() {
    let env = env!("appearance_reusing_a_request_id_for_another_payload");
    let player = unique("lookconf");
    let (_, styled) = applied(env.appearance(&player, "a1", "deep", "blue").await);
    let before = persisted(&env, &player).await;

    // each field alone, both fields, an invalid look, another catalog version
    for (skin, hair) in [
        ("dark", "blue"),
        ("deep", "black"),
        ("dark", "black"),
        ("nope", "nope"),
    ] {
        assert_eq!(
            rejected(env.appearance(&player, "a1", skin, hair).await),
            (R::IdempotencyConflict, false),
            "{skin}/{hair}"
        );
    }
    assert_eq!(
        rejected(
            env.app
                .set_appearance(player_profile_service::application::SetAppearanceCommand {
                    player_id: player.clone(),
                    request_id: "a1".into(),
                    catalog_version: "online-v1".into(),
                    skin_id: "deep".into(),
                    hair_color_id: "blue".into(),
                })
                .await
                .unwrap()
                .outcome
        ),
        (R::IdempotencyConflict, false)
    );
    // another operation type under the same request id
    assert_eq!(
        rejected(env.equip(&player, "a1", "luna").await),
        (R::IdempotencyConflict, false)
    );
    let after = persisted(&env, &player).await;
    assert_eq!(after, before, "a conflict changes nothing that persists");
    assert_eq!(after.profile.appearance, styled.appearance);

    let (replayed, again) = applied(env.appearance(&player, "a1", "deep", "blue").await);
    assert!(replayed, "the original record still replays");
    assert_eq!(again, styled);
    assert_eq!(persisted(&env, &player).await, before);
}

// ---- concurrency -----------------------------------------------------------

#[tokio::test]
async fn concurrent_buys_of_one_item_with_distinct_requests_apply_exactly_once() {
    let env = std::sync::Arc::new(env!("concurrent_buys_of_one_item"));
    let player = unique("cbuy");
    env.fund(&player, 500, 0, 0).await;
    let mut tasks = Vec::new();
    for n in 0..12 {
        let env = env.clone();
        let player = player.clone();
        tasks.push(tokio::spawn(async move {
            env.buy(&player, &format!("r{n}"), "manglar").await
        }));
    }
    let mut applied_count = 0;
    for task in tasks {
        match task.await.unwrap() {
            player_profile_service::application::MutationOutcome::Applied { replayed, .. } => {
                assert!(!replayed);
                applied_count += 1;
            }
            other => assert_eq!(rejected(other), (R::AlreadyOwned, false)),
        }
    }
    assert_eq!(applied_count, 1);
    let profile = env.profile(&player).await;
    assert_eq!(
        (profile.coins, profile.revision),
        (200, 2),
        "charged exactly once"
    );
    assert_eq!(
        env.count(
            "SELECT count(*) FROM player.owned_items WHERE player_id = $1 AND item_id = 'manglar'",
            &player
        )
        .await,
        1
    );
}

#[tokio::test]
async fn concurrent_duplicates_of_one_request_apply_once_and_replay_the_rest() {
    let env = std::sync::Arc::new(env!("concurrent_duplicates_of_one_request"));
    let player = unique("cdup");
    env.fund(&player, 500, 0, 0).await;
    let mut tasks = Vec::new();
    for _ in 0..12 {
        let env = env.clone();
        let player = player.clone();
        tasks.push(tokio::spawn(async move {
            env.buy(&player, "same-request", "manglar").await
        }));
    }
    let mut fresh = 0;
    let mut replays = 0;
    for task in tasks {
        let (replayed, profile) = applied(task.await.unwrap());
        assert!(profile.owns("manglar"));
        assert_eq!(profile.coins, 200);
        if replayed {
            replays += 1;
        } else {
            fresh += 1;
        }
    }
    assert_eq!(
        (fresh, replays),
        (1, 11),
        "exactly one applied per request_id"
    );
    assert_eq!(env.profile(&player).await.revision, 2);
    assert_eq!(
        env.count(
            "SELECT count(*) FROM player.economic_operations WHERE player_id = $1",
            &player
        )
        .await,
        1
    );
}

#[tokio::test]
async fn concurrent_exchanges_never_spend_more_material_than_the_player_has() {
    let env = std::sync::Arc::new(env!("concurrent_exchanges_never_overspend"));
    let player = unique("cexch");
    env.fund(&player, 0, 100, 0).await;
    let mut tasks = Vec::new();
    for n in 0..20 {
        let env = env.clone();
        let player = player.clone();
        tasks.push(tokio::spawn(async move {
            env.exchange(&player, &format!("e{n}"), Material::Plastic, 7)
                .await
        }));
    }
    let (mut ok, mut short) = (0, 0);
    for task in tasks {
        match task.await.unwrap() {
            player_profile_service::application::MutationOutcome::Applied { .. } => ok += 1,
            other => {
                assert_eq!(rejected(other), (R::InsufficientMaterials, false));
                short += 1;
            }
        }
    }
    assert_eq!(
        (ok, short),
        (14, 6),
        "100 plastic pays for exactly 14 exchanges of 7"
    );
    let profile = env.profile(&player).await;
    assert_eq!((profile.plastic, profile.coins), (2, 14 * 7 * 4));
    assert_eq!(profile.revision, 1 + 14);
}

#[tokio::test]
async fn mixed_concurrent_buy_craft_and_exchange_keep_every_invariant() {
    let env = std::sync::Arc::new(env!("mixed_concurrent_buy_craft_and_exchange"));
    let player = unique("cmix");
    env.fund(&player, 100, 30, 15).await;
    let mut tasks = Vec::new();
    let mut spawn = |request: String, kind: u8, item: &'static str, amount: u64| {
        let env = env.clone();
        let player = player.clone();
        tasks.push(tokio::spawn(async move {
            match kind {
                0 => env.buy(&player, &request, item).await,
                1 => env.craft(&player, &request, item).await,
                _ => {
                    env.exchange(&player, &request, Material::Plastic, amount)
                        .await
                }
            }
        }));
    };
    // 100 coins cover only one of the two boards unless exchanges add more.
    for n in 0..3 {
        spawn(format!("x{n}"), 2, "", 10);
    }
    spawn("b-manglar".into(), 0, "manglar", 0);
    spawn("b-sol".into(), 0, "sol", 0);
    spawn("c-reuso".into(), 1, "red-reuso", 0);
    spawn("c-marea".into(), 1, "red-marea", 0);
    spawn("c-cobre".into(), 1, "red-cobre", 0);
    let mut applied_count = 0i64;
    for task in tasks {
        if matches!(
            task.await.unwrap(),
            player_profile_service::application::MutationOutcome::Applied { .. }
        ) {
            applied_count += 1;
        }
    }

    let profile = env.profile(&player).await;
    assert_eq!(
        profile.revision,
        1 + applied_count as u64,
        "one revision per applied mutation"
    );
    // conservation: balances equal start +/- what the applied operations moved
    let bought: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(e.price_coins), 0)::bigint FROM player.owned_items o \
         JOIN player.catalog_entries e ON e.item_id = o.item_id AND e.catalog_version = 'online-v2' \
         WHERE o.player_id = $1 AND o.acquisition_type = 'buy'",
    )
    .bind(&player)
    .fetch_one(&env.pool)
    .await
    .unwrap();
    let crafted: (i64, i64) = sqlx::query_as(
        "SELECT COALESCE(SUM(e.recipe_plastic), 0)::bigint, COALESCE(SUM(e.recipe_metal), 0)::bigint \
         FROM player.owned_items o \
         JOIN player.catalog_entries e ON e.item_id = o.item_id AND e.catalog_version = 'online-v2' \
         WHERE o.player_id = $1 AND o.acquisition_type = 'craft'",
    )
    .bind(&player)
    .fetch_one(&env.pool)
    .await
    .unwrap();
    let exchange_count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM player.economic_operations \
         WHERE player_id = $1 AND operation_type = 'exchange' AND status = 'applied'",
    )
    .bind(&player)
    .fetch_one(&env.pool)
    .await
    .unwrap();
    let exchanged = exchange_count * 10;
    assert_eq!(profile.coins as i64, 100 + exchanged * 4 - bought);
    assert_eq!(profile.plastic as i64, 30 - exchanged - crafted.0);
    assert_eq!(profile.metal as i64, 15 - crafted.1);
    // balances never negative is enforced by u64 + CHECK; ownership is unique by PK
    let duplicates: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM (SELECT item_id FROM player.owned_items WHERE player_id = $1 \
         GROUP BY item_id HAVING count(*) > 1) d",
    )
    .bind(&player)
    .fetch_one(&env.pool)
    .await
    .unwrap();
    assert_eq!(duplicates, 0);
}
