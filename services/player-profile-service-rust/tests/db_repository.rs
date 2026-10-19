//! PostgreSQL adapter behaviour behind the repository ports (F52-T3). Needs a
//! migrated database, see `tests/common/mod.rs`.

mod common;

use std::time::Duration;

use player_profile_service::{
    domain::{
        economy::{Acquisition, AcquisitionKind},
        provisioning::BASE_OWNED_ITEMS,
        settlement::Credit,
        Appearance, EconomicOperationRecord, Effect, ItemType, MutationRejection, OperationStatus,
        SettlementRecord, Slot,
    },
    repository::{postgres, LockMode, Repositories, RepositoryError},
};
use sqlx::PgPool;

async fn setup(test: &str) -> Option<(Repositories, PgPool)> {
    let url = common::database_url(test)?;
    let pool = common::test_pool(&url, 20).await;
    Some((postgres::repositories(pool.clone()), pool))
}

async fn count(pool: &PgPool, sql: &str, player: &str) -> i64 {
    sqlx::query_scalar(sql)
        .bind(player)
        .fetch_one(pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn lazy_provisioning_creates_the_start_state_at_revision_one() {
    let Some((repos, pool)) = setup("lazy_provisioning_creates_the_start_state").await else {
        return;
    };
    let player = common::unique("prov");
    let mut tx = repos.transactions.begin().await.unwrap();
    let state = tx.lock_profile(&player, LockMode::Update).await.unwrap();
    tx.commit().await.unwrap();

    assert_eq!(state.revision, 1);
    assert_eq!((state.coins, state.plastic, state.metal), (0, 0, 0));
    assert_eq!(state.owned_item_ids.len(), BASE_OWNED_ITEMS.len());
    for id in BASE_OWNED_ITEMS {
        assert!(state.owns(id), "{id}");
    }
    assert_eq!(state.equipment.board_id, "coral");
    assert_eq!(state.equipment.outfit_id, "costero");
    assert_eq!(state.equipment.net_id, "red-base");
    assert_eq!(state.equipment.hair_id, "swept");
    assert_eq!(state.equipment.character_id, "nico");
    assert_eq!(state.appearance.skin_id, "medium");
    assert_eq!(state.appearance.hair_color_id, "brown");

    // A second read returns the same persisted state without re-provisioning.
    let mut tx = repos.transactions.begin().await.unwrap();
    let again = tx.lock_profile(&player, LockMode::Share).await.unwrap();
    tx.commit().await.unwrap();
    assert_eq!(again, state);
    assert_eq!(
        count(
            &pool,
            "SELECT count(*) FROM player.owned_items WHERE player_id = $1",
            &player
        )
        .await,
        12
    );
}

#[tokio::test]
async fn an_uncommitted_provisioning_is_rolled_back() {
    let Some((repos, pool)) = setup("an_uncommitted_provisioning_is_rolled_back").await else {
        return;
    };
    let player = common::unique("rollback");
    {
        let mut tx = repos.transactions.begin().await.unwrap();
        tx.lock_profile(&player, LockMode::Update).await.unwrap();
        // dropped without commit
    }
    assert_eq!(
        count(
            &pool,
            "SELECT count(*) FROM player.profiles WHERE player_id = $1",
            &player
        )
        .await,
        0
    );
    assert_eq!(
        count(
            &pool,
            "SELECT count(*) FROM player.owned_items WHERE player_id = $1",
            &player
        )
        .await,
        0
    );
}

#[tokio::test]
async fn concurrent_first_access_provisions_exactly_once() {
    let Some((repos, pool)) = setup("concurrent_first_access_provisions_exactly_once").await else {
        return;
    };
    let player = common::unique("race-prov");
    let mut tasks = Vec::new();
    for _ in 0..16 {
        let repos = repos.clone();
        let player = player.clone();
        tasks.push(tokio::spawn(async move {
            let mut tx = repos.transactions.begin().await?;
            let state = tx.lock_profile(&player, LockMode::Update).await?;
            tx.commit().await?;
            Ok::<_, RepositoryError>(state)
        }));
    }
    for task in tasks {
        let state = task.await.unwrap().expect("provisioning must be race free");
        assert_eq!(state.revision, 1);
        assert_eq!(state.owned_item_ids.len(), 12);
    }
    assert_eq!(
        count(
            &pool,
            "SELECT count(*) FROM player.profiles WHERE player_id = $1",
            &player
        )
        .await,
        1
    );
    assert_eq!(
        count(
            &pool,
            "SELECT count(*) FROM player.owned_items WHERE player_id = $1",
            &player
        )
        .await,
        12
    );
    assert_eq!(
        count(
            &pool,
            "SELECT count(*) FROM player.equipment_slots WHERE player_id = $1",
            &player
        )
        .await,
        5
    );
}

#[tokio::test]
async fn the_active_catalog_is_online_v1_with_the_prototype_economy() {
    let Some((repos, _pool)) = setup("the_active_catalog_is_online_v1").await else {
        return;
    };
    let catalog = repos.catalog.find_catalog(None).await.unwrap().unwrap();
    assert_eq!(catalog.version, "online-v1");
    assert_eq!(catalog.items.len(), 22);

    let manglar = catalog.get("manglar").unwrap();
    assert_eq!(manglar.item_type, ItemType::Board);
    assert_eq!(manglar.price_coins, Some(60));
    assert!(manglar.purchasable() && !manglar.craftable());
    assert_eq!(manglar.metadata["color"], "#378875");

    let aurora = catalog.get("red-aurora").unwrap();
    assert_eq!(aurora.price_coins, None);
    assert_eq!((aurora.recipe_plastic, aurora.recipe_metal), (20, 12));
    assert!(!aurora.purchasable() && aurora.craftable());
    assert_eq!(aurora.metadata["rarity"], "Especial");
    assert_eq!(
        catalog.get("red-marea").unwrap().metadata["rarity"],
        "Destacada"
    );
    assert_eq!(catalog.get("red-base").unwrap().metadata["rarity"], "Común");

    let luna = catalog.get("luna").unwrap();
    assert_eq!(luna.item_type, ItemType::Character);
    assert_eq!(luna.metadata["hair"], "ponytail");
    assert_eq!(luna.metadata["skin"], "light");
    assert_eq!(luna.metadata["hairColor"], "blonde");
    assert_eq!(luna.metadata["morph"], "Luna");
    assert!(!catalog.get("nico").unwrap().metadata.contains_key("morph"));
    assert!(catalog.items.iter().all(|i| i.enabled));
    assert_eq!(catalog.items[0].item_type, ItemType::Character);

    let explicit = repos
        .catalog
        .find_catalog(Some("online-v1"))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(explicit, catalog);
}

#[tokio::test]
async fn unknown_and_unpublished_catalog_versions_are_not_found() {
    let Some((repos, pool)) = setup("unknown_and_unpublished_catalog_versions").await else {
        return;
    };
    assert_eq!(repos.catalog.find_catalog(Some("nope")).await, Ok(None));
    let draft = common::unique("draft");
    sqlx::query("INSERT INTO player.catalog_versions (catalog_version, active) VALUES ($1, false)")
        .bind(&draft)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(repos.catalog.find_catalog(Some(&draft)).await, Ok(None));
    let mut tx = repos.transactions.begin().await.unwrap();
    assert_eq!(tx.find_catalog(&draft).await, Ok(None));
    assert!(tx.find_catalog("online-v1").await.unwrap().is_some());
}

#[tokio::test]
async fn apply_effect_changes_balances_ownership_equipment_and_revision_together() {
    let Some((repos, pool)) = setup("apply_effect_changes_everything_together").await else {
        return;
    };
    let player = common::unique("effect");
    let mut tx = repos.transactions.begin().await.unwrap();
    tx.lock_profile(&player, LockMode::Update).await.unwrap();
    tx.commit().await.unwrap();
    sqlx::query("UPDATE player.profiles SET coins = 100, plastic = 10 WHERE player_id = $1")
        .bind(&player)
        .execute(&pool)
        .await
        .unwrap();

    let effect = Effect {
        coins_delta: -60,
        plastic_delta: -4,
        metal_delta: 0,
        acquisition: Some(Acquisition {
            item_id: "manglar".into(),
            kind: AcquisitionKind::Buy,
        }),
        equip: vec![(Slot::Board, "manglar".into())],
        appearance: Some(Appearance {
            skin_id: "deep".into(),
            hair_color_id: "blue".into(),
        }),
    };
    let mut tx = repos.transactions.begin().await.unwrap();
    tx.lock_profile(&player, LockMode::Update).await.unwrap();
    assert_eq!(tx.apply_effect(&player, &effect).await, Ok(2));
    tx.commit().await.unwrap();

    let mut tx = repos.transactions.begin().await.unwrap();
    let state = tx.lock_profile(&player, LockMode::Share).await.unwrap();
    tx.commit().await.unwrap();
    assert_eq!(
        (state.coins, state.plastic, state.metal, state.revision),
        (40, 6, 0, 2)
    );
    assert!(state.owns("manglar"));
    assert_eq!(state.equipment.board_id, "manglar");
    assert_eq!(state.appearance.skin_id, "deep");
    assert_eq!(state.appearance.hair_color_id, "blue");
    let acquisition: String = sqlx::query_scalar(
        "SELECT acquisition_type FROM player.owned_items WHERE player_id = $1 AND item_id = 'manglar'",
    )
    .bind(&player)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(acquisition, "buy");
}

#[tokio::test]
async fn the_database_refuses_negative_balances_and_double_ownership() {
    let Some((repos, pool)) = setup("the_database_refuses_negative_balances").await else {
        return;
    };
    let player = common::unique("guard");
    let mut tx = repos.transactions.begin().await.unwrap();
    tx.lock_profile(&player, LockMode::Update).await.unwrap();
    tx.commit().await.unwrap();

    let mut tx = repos.transactions.begin().await.unwrap();
    tx.lock_profile(&player, LockMode::Update).await.unwrap();
    let overdraw = Effect {
        coins_delta: -1,
        ..Effect::default()
    };
    assert!(matches!(
        tx.apply_effect(&player, &overdraw).await,
        Err(RepositoryError::Unexpected(_))
    ));
    drop(tx);

    let mut tx = repos.transactions.begin().await.unwrap();
    tx.lock_profile(&player, LockMode::Update).await.unwrap();
    let again = Effect {
        acquisition: Some(Acquisition {
            item_id: "coral".into(),
            kind: AcquisitionKind::Buy,
        }),
        ..Effect::default()
    };
    assert!(
        tx.apply_effect(&player, &again).await.is_err(),
        "unique ownership"
    );
    drop(tx);

    let mut tx = repos.transactions.begin().await.unwrap();
    tx.lock_profile(&player, LockMode::Update).await.unwrap();
    let unowned = Effect {
        equip: vec![(Slot::Board, "sol".into())],
        ..Effect::default()
    };
    assert!(
        tx.apply_effect(&player, &unowned).await.is_err(),
        "equip needs ownership"
    );
    drop(tx);

    // every failed attempt rolled back, including the revision bump
    let revision: i64 =
        sqlx::query_scalar("SELECT profile_revision FROM player.profiles WHERE player_id = $1")
            .bind(&player)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(revision, 1);
}

#[tokio::test]
async fn settlement_credit_adds_materials_and_bumps_the_revision() {
    let Some((repos, _pool)) = setup("settlement_credit_adds_materials").await else {
        return;
    };
    let player = common::unique("credit");
    let mut tx = repos.transactions.begin().await.unwrap();
    tx.lock_profile(&player, LockMode::Update).await.unwrap();
    let revision = tx
        .credit_materials(
            &player,
            Credit {
                plastic: 7,
                metal: 3,
            },
        )
        .await
        .unwrap();
    assert_eq!(revision, 2);
    let state = tx.lock_profile(&player, LockMode::Update).await.unwrap();
    tx.commit().await.unwrap();
    assert_eq!((state.plastic, state.metal, state.revision), (7, 3, 2));
}

#[tokio::test]
async fn operation_and_settlement_records_round_trip_including_rejections() {
    let Some((repos, pool)) = setup("operation_and_settlement_records_round_trip").await else {
        return;
    };
    let player = common::unique("records");
    let mut tx = repos.transactions.begin().await.unwrap();
    tx.lock_profile(&player, LockMode::Update).await.unwrap();

    assert_eq!(tx.find_operation(&player, "r-1").await, Ok(None));
    let applied = EconomicOperationRecord {
        player_id: player.clone(),
        request_id: "r-1".into(),
        operation_type: "buy".into(),
        request_fingerprint: "fp-1".into(),
        catalog_version: Some("online-v1".into()),
        status: OperationStatus::Applied,
        rejection: None,
        profile_revision_after: Some(2),
    };
    let rejected = EconomicOperationRecord {
        request_id: "r-2".into(),
        request_fingerprint: "fp-2".into(),
        catalog_version: None,
        status: OperationStatus::Rejected,
        rejection: Some(MutationRejection::InvalidCatalogVersion),
        profile_revision_after: Some(1),
        ..applied.clone()
    };
    tx.record_operation(&applied).await.unwrap();
    tx.record_operation(&rejected).await.unwrap();
    assert_eq!(
        tx.find_operation(&player, "r-1").await,
        Ok(Some(applied.clone()))
    );
    assert_eq!(tx.find_operation(&player, "r-2").await, Ok(Some(rejected)));
    assert!(
        tx.record_operation(&applied).await.is_err(),
        "(player_id, request_id) is unique"
    );
    drop(tx);

    let race = common::unique("race");
    let mut tx = repos.transactions.begin().await.unwrap();
    tx.lock_profile(&player, LockMode::Update).await.unwrap();
    assert_eq!(tx.find_settlement(&race, &player).await, Ok(None));
    let settlement = SettlementRecord {
        race_id: race.clone(),
        player_id: player.clone(),
        result_fingerprint: "sfp".into(),
        credited_plastic: 5,
        credited_metal: 2,
        profile_revision_after: 2,
    };
    tx.record_settlement(&settlement).await.unwrap();
    assert_eq!(
        tx.find_settlement(&race, &player).await,
        Ok(Some(settlement.clone()))
    );
    assert!(
        tx.record_settlement(&settlement).await.is_err(),
        "(race_id, player_id) is unique"
    );
    drop(tx);
    // nothing leaked from the rolled back transactions
    assert_eq!(
        count(
            &pool,
            "SELECT count(*) FROM player.economic_operations WHERE player_id = $1",
            &player
        )
        .await,
        0
    );
}

#[tokio::test]
async fn share_locks_do_not_block_each_other_but_wait_for_a_writer() {
    let Some((repos, _pool)) = setup("share_locks_do_not_block_each_other").await else {
        return;
    };
    let player = common::unique("locks");
    let mut tx = repos.transactions.begin().await.unwrap();
    tx.lock_profile(&player, LockMode::Update).await.unwrap();
    tx.commit().await.unwrap();

    // two readers at once
    let mut first = repos.transactions.begin().await.unwrap();
    first.lock_profile(&player, LockMode::Share).await.unwrap();
    let mut second = repos.transactions.begin().await.unwrap();
    tokio::time::timeout(
        Duration::from_secs(5),
        second.lock_profile(&player, LockMode::Share),
    )
    .await
    .expect("a shared read must not wait for another shared read")
    .unwrap();
    first.commit().await.unwrap();
    second.commit().await.unwrap();

    // a writer holds the row: a second writer waits until it commits
    let mut writer = repos.transactions.begin().await.unwrap();
    writer
        .lock_profile(&player, LockMode::Update)
        .await
        .unwrap();
    let waiter = {
        let repos = repos.clone();
        let player = player.clone();
        tokio::spawn(async move {
            let mut tx = repos.transactions.begin().await.unwrap();
            tx.lock_profile(&player, LockMode::Update).await.unwrap();
            tx.commit().await.unwrap();
        })
    };
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert!(
        !waiter.is_finished(),
        "the second writer must wait for the row lock"
    );
    writer.commit().await.unwrap();
    tokio::time::timeout(Duration::from_secs(5), waiter)
        .await
        .expect("the waiter proceeds after commit")
        .unwrap();
}
