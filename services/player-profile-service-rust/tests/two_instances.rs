//! Two service instances (separate pools and gRPC servers) against one
//! PostgreSQL (F52-T7): the economy stays correct when requests for the same
//! player land on different replicas, and a replacement instance continues
//! where a stopped one left off. Needs a migrated database, see
//! `tests/common/mod.rs`.

mod common;

use common::{start_instance, unique, Client};
use player_profile_service::pb::{
    profile_mutation_response::Outcome as Arm, settle_race_response::Outcome as SettleArm,
    BuyItemRequest, CraftItemRequest, ExchangeMaterialsRequest, GetProfileRequest, Material,
    MutationRejectionCode as Code, PlayerProfile, ProfileMutationResponse, SettleRaceRequest,
    SettlementRejectionCode,
};
use sqlx::PgPool;

const V: &str = "online-v1";

struct Pair {
    a: Client,
    b: Client,
    pool: PgPool,
    _instances: (common::Instance, common::Instance),
}

async fn pair(test: &str) -> Option<Pair> {
    let url = common::database_url(test)?;
    let (a, _pool_a) = start_instance(&url).await;
    let (b, _pool_b) = start_instance(&url).await;
    let pool = common::test_pool(&url, 5).await;
    Some(Pair {
        a: a.client.clone(),
        b: b.client.clone(),
        pool,
        _instances: (a, b),
    })
}

macro_rules! pair {
    ($name:expr) => {
        match pair($name).await {
            Some(pair) => pair,
            None => return,
        }
    };
}

impl Pair {
    /// Alternates between the two replicas.
    fn pick(&self, n: usize) -> Client {
        if n.is_multiple_of(2) {
            self.a.clone()
        } else {
            self.b.clone()
        }
    }

    async fn fund(&self, player: &str, coins: i64, plastic: i64, metal: i64) {
        // provision through replica A, then set balances directly (test setup)
        self.a
            .clone()
            .get_profile(GetProfileRequest {
                player_id: player.into(),
            })
            .await
            .unwrap();
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

    async fn profile(&self, player: &str) -> PlayerProfile {
        self.b
            .clone()
            .get_profile(GetProfileRequest {
                player_id: player.into(),
            })
            .await
            .unwrap()
            .into_inner()
            .profile
            .unwrap()
    }
}

fn buy(player: &str, request: &str, item: &str) -> BuyItemRequest {
    BuyItemRequest {
        player_id: player.into(),
        request_id: request.into(),
        catalog_version: V.into(),
        item_id: item.into(),
    }
}

fn is_success(response: &ProfileMutationResponse) -> Option<(bool, &PlayerProfile)> {
    match response.outcome.as_ref().unwrap() {
        Arm::Success(s) => Some((s.replayed, s.profile.as_ref().unwrap())),
        Arm::Rejection(_) => None,
    }
}

fn rejection_code(response: &ProfileMutationResponse) -> i32 {
    match response.outcome.as_ref().unwrap() {
        Arm::Rejection(r) => r.code,
        Arm::Success(_) => panic!("expected a rejection"),
    }
}

#[tokio::test]
async fn concurrent_buys_across_replicas_charge_once() {
    let p = pair!("concurrent_buys_across_replicas_charge_once");
    let player = unique("two-buy");
    p.fund(&player, 100, 0, 0).await;
    let mut tasks = Vec::new();
    for n in 0..16 {
        let mut client = p.pick(n);
        let request = buy(&player, &format!("r{n}"), "manglar");
        tasks.push(tokio::spawn(async move {
            client.buy_item(request).await.unwrap().into_inner()
        }));
    }
    let mut applied = 0;
    for task in tasks {
        let response = task.await.unwrap();
        match is_success(&response) {
            Some((replayed, _)) => {
                assert!(!replayed);
                applied += 1;
            }
            None => assert_eq!(
                rejection_code(&response),
                Code::MutationRejectionAlreadyOwned as i32
            ),
        }
    }
    assert_eq!(applied, 1);
    let profile = p.profile(&player).await;
    assert_eq!((profile.coins, profile.profile_revision), (40, 2));
    assert_eq!(
        profile
            .owned_item_ids
            .iter()
            .filter(|i| *i == "manglar")
            .count(),
        1
    );
}

#[tokio::test]
async fn one_request_id_sent_to_both_replicas_is_applied_exactly_once() {
    let p = pair!("one_request_id_sent_to_both_replicas");
    let player = unique("two-dup");
    p.fund(&player, 100, 0, 0).await;
    let mut tasks = Vec::new();
    for n in 0..16 {
        let mut client = p.pick(n);
        let request = buy(&player, "shared-request", "manglar");
        tasks.push(tokio::spawn(async move {
            client.buy_item(request).await.unwrap().into_inner()
        }));
    }
    let (mut fresh, mut replays) = (0, 0);
    for task in tasks {
        let response = task.await.unwrap();
        let (replayed, profile) = is_success(&response).expect("every duplicate succeeds");
        assert_eq!(profile.coins, 40);
        if replayed {
            replays += 1
        } else {
            fresh += 1
        }
    }
    assert_eq!((fresh, replays), (1, 15));
    assert_eq!(p.profile(&player).await.profile_revision, 2);
}

#[tokio::test]
async fn concurrent_exchanges_across_replicas_never_overspend() {
    let p = pair!("concurrent_exchanges_across_replicas");
    let player = unique("two-exch");
    p.fund(&player, 0, 100, 0).await;
    let mut tasks = Vec::new();
    for n in 0..24 {
        let mut client = p.pick(n);
        let request = ExchangeMaterialsRequest {
            player_id: player.clone(),
            request_id: format!("e{n}"),
            catalog_version: V.into(),
            material: Material::Plastic as i32,
            amount: 7,
        };
        tasks.push(tokio::spawn(async move {
            client
                .exchange_materials(request)
                .await
                .unwrap()
                .into_inner()
        }));
    }
    let mut applied = 0;
    for task in tasks {
        let response = task.await.unwrap();
        if is_success(&response).is_some() {
            applied += 1;
        } else {
            assert_eq!(
                rejection_code(&response),
                Code::MutationRejectionInsufficientMaterials as i32
            );
        }
    }
    assert_eq!(applied, 14);
    let profile = p.profile(&player).await;
    assert_eq!((profile.plastic, profile.coins), (2, 14 * 7 * 4));
}

#[tokio::test]
async fn concurrent_crafts_across_replicas_grant_the_net_once_and_spend_once() {
    let p = pair!("concurrent_crafts_across_replicas");
    let player = unique("two-craft");
    p.fund(&player, 0, 20, 10).await;
    let mut tasks = Vec::new();
    for n in 0..12 {
        let mut client = p.pick(n);
        let request = CraftItemRequest {
            player_id: player.clone(),
            request_id: format!("c{n}"),
            catalog_version: V.into(),
            item_id: "red-reuso".into(),
        };
        tasks.push(tokio::spawn(async move {
            client.craft_item(request).await.unwrap().into_inner()
        }));
    }
    let applied = count_applied(tasks).await;
    assert_eq!(applied, 1);
    let profile = p.profile(&player).await;
    assert_eq!(
        (profile.plastic, profile.metal),
        (14, 7),
        "recipe 6/3 charged once"
    );
}

async fn count_applied(tasks: Vec<tokio::task::JoinHandle<ProfileMutationResponse>>) -> usize {
    let mut applied = 0;
    for task in tasks {
        if is_success(&task.await.unwrap()).is_some() {
            applied += 1;
        }
    }
    applied
}

#[tokio::test]
async fn mixed_buy_craft_exchange_and_settlement_across_replicas_keep_the_ledger_consistent() {
    let p = pair!("mixed_across_replicas");
    let player = unique("two-mix");
    p.fund(&player, 50, 30, 15).await;
    let mut tasks = Vec::new();
    for n in 0..30usize {
        let mut client = p.pick(n);
        let player = player.clone();
        tasks.push(tokio::spawn(async move {
            match n % 5 {
                0 => client
                    .buy_item(buy(
                        &player,
                        &format!("m{n}"),
                        if n % 10 == 0 { "manglar" } else { "brisa" },
                    ))
                    .await
                    .unwrap()
                    .into_inner(),
                1 => client
                    .craft_item(CraftItemRequest {
                        player_id: player,
                        request_id: format!("m{n}"),
                        catalog_version: V.into(),
                        item_id: if n.is_multiple_of(2) {
                            "red-marea"
                        } else {
                            "red-reuso"
                        }
                        .into(),
                    })
                    .await
                    .unwrap()
                    .into_inner(),
                2 => client
                    .exchange_materials(ExchangeMaterialsRequest {
                        player_id: player,
                        request_id: format!("m{n}"),
                        catalog_version: V.into(),
                        material: Material::Plastic as i32,
                        amount: 3,
                    })
                    .await
                    .unwrap()
                    .into_inner(),
                3 => client
                    .settle_race(SettleRaceRequest {
                        race_id: format!("race-{n}-{player}"),
                        player_id: player.clone(),
                        outcome: 1,
                        credited_plastic: 2,
                        credited_metal: 1,
                    })
                    .await
                    .map(|_| ProfileMutationResponse::default())
                    .unwrap(),
                _ => client
                    .exchange_materials(ExchangeMaterialsRequest {
                        player_id: player,
                        request_id: format!("m{n}"),
                        catalog_version: V.into(),
                        material: Material::Metal as i32,
                        amount: 2,
                    })
                    .await
                    .unwrap()
                    .into_inner(),
            }
        }));
    }
    for task in tasks {
        task.await.unwrap();
    }

    // The ledger must explain the balances exactly.
    let profile = p.profile(&player).await;
    let (applied_ops, applied_settlements): (i64, i64) = (
        sqlx::query_scalar("SELECT count(*) FROM player.economic_operations WHERE player_id = $1 AND status = 'applied'")
            .bind(&player)
            .fetch_one(&p.pool)
            .await
            .unwrap(),
        sqlx::query_scalar("SELECT count(*) FROM player.settlements WHERE player_id = $1 AND credited_plastic + credited_metal > 0")
            .bind(&player)
            .fetch_one(&p.pool)
            .await
            .unwrap(),
    );
    assert_eq!(
        profile.profile_revision as i64,
        1 + applied_ops + applied_settlements
    );

    let sum = |sql: &'static str| {
        let (pool, player) = (p.pool.clone(), player.clone());
        async move {
            sqlx::query_scalar::<_, i64>(sql)
                .bind(player)
                .fetch_one(&pool)
                .await
                .unwrap()
        }
    };
    let exchanged_plastic = sum("SELECT count(*) * 3 FROM player.economic_operations WHERE player_id = $1 AND operation_type = 'exchange' AND status = 'applied' AND request_id IN (SELECT 'm' || n FROM generate_series(0, 29) n WHERE n % 5 = 2)").await;
    let exchanged_metal = sum("SELECT count(*) * 2 FROM player.economic_operations WHERE player_id = $1 AND operation_type = 'exchange' AND status = 'applied' AND request_id IN (SELECT 'm' || n FROM generate_series(0, 29) n WHERE n % 5 = 4)").await;
    let bought = sum("SELECT COALESCE(SUM(e.price_coins), 0)::bigint FROM player.owned_items o JOIN player.catalog_entries e ON e.item_id = o.item_id AND e.catalog_version = 'online-v1' WHERE o.player_id = $1 AND o.acquisition_type = 'buy'").await;
    let crafted_plastic = sum("SELECT COALESCE(SUM(e.recipe_plastic), 0)::bigint FROM player.owned_items o JOIN player.catalog_entries e ON e.item_id = o.item_id AND e.catalog_version = 'online-v1' WHERE o.player_id = $1 AND o.acquisition_type = 'craft'").await;
    let crafted_metal = sum("SELECT COALESCE(SUM(e.recipe_metal), 0)::bigint FROM player.owned_items o JOIN player.catalog_entries e ON e.item_id = o.item_id AND e.catalog_version = 'online-v1' WHERE o.player_id = $1 AND o.acquisition_type = 'craft'").await;
    let settled_plastic = sum("SELECT COALESCE(SUM(credited_plastic), 0)::bigint FROM player.settlements WHERE player_id = $1").await;
    let settled_metal = sum("SELECT COALESCE(SUM(credited_metal), 0)::bigint FROM player.settlements WHERE player_id = $1").await;

    assert_eq!(
        profile.coins as i64,
        50 + exchanged_plastic * 4 + exchanged_metal * 6 - bought
    );
    assert_eq!(
        profile.plastic as i64,
        30 + settled_plastic - exchanged_plastic - crafted_plastic
    );
    assert_eq!(
        profile.metal as i64,
        15 + settled_metal - exchanged_metal - crafted_metal
    );
}

fn settle(race: &str, player: &str, plastic: u64, metal: u64) -> SettleRaceRequest {
    SettleRaceRequest {
        race_id: race.into(),
        player_id: player.into(),
        outcome: 1,
        credited_plastic: plastic,
        credited_metal: metal,
    }
}

/// `Ok((replayed, profile))` for a settlement, `Err(code)` for a rejection.
fn settlement_result(
    response: player_profile_service::pb::SettleRaceResponse,
) -> Result<(bool, PlayerProfile), i32> {
    match response.outcome.unwrap() {
        SettleArm::Success(s) => Ok((s.replayed, s.profile.unwrap())),
        SettleArm::Rejection(r) => Err(r.code),
    }
}

async fn settlement_rows(p: &Pair, player: &str) -> i64 {
    sqlx::query_scalar("SELECT count(*) FROM player.settlements WHERE player_id = $1")
        .bind(player)
        .fetch_one(&p.pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn one_settlement_sent_to_both_replicas_credits_once() {
    let p = pair!("one_settlement_sent_to_both_replicas");
    let player = unique("two-settle");
    let race = unique("two-race");
    p.fund(&player, 0, 0, 0).await;
    let mut tasks = Vec::new();
    for n in 0..16 {
        let mut client = p.pick(n);
        let request = settle(&race, &player, 6, 4);
        tasks.push(tokio::spawn(async move {
            client.settle_race(request).await.unwrap().into_inner()
        }));
    }
    let (mut fresh, mut replays) = (0, 0);
    for task in tasks {
        let (replayed, profile) =
            settlement_result(task.await.unwrap()).expect("every duplicate succeeds");
        assert_eq!((profile.plastic, profile.metal), (6, 4));
        if replayed {
            replays += 1
        } else {
            fresh += 1
        }
    }
    assert_eq!((fresh, replays), (1, 15));
    assert_eq!(settlement_rows(&p, &player).await, 1);
    assert_eq!(p.profile(&player).await.profile_revision, 2);

    // once settled, no replica accepts different data for the same key
    let mut tasks = Vec::new();
    for n in 0..8 {
        let mut client = p.pick(n);
        let request = settle(&race, &player, 7 + n as u64, 4);
        tasks.push(tokio::spawn(async move {
            client.settle_race(request).await.unwrap().into_inner()
        }));
    }
    for task in tasks {
        assert_eq!(
            settlement_result(task.await.unwrap()),
            Err(SettlementRejectionCode::SettlementRejectionConflict as i32)
        );
    }
    let profile = p.profile(&player).await;
    assert_eq!(
        (profile.plastic, profile.metal, profile.profile_revision),
        (6, 4, 2)
    );
    assert_eq!(settlement_rows(&p, &player).await, 1);
}

#[tokio::test]
async fn racing_settlements_with_different_data_across_replicas_have_exactly_one_winner() {
    let p = pair!("racing_settlements_with_different_data");
    let player = unique("two-race-win");
    let race = unique("two-race");
    p.fund(&player, 0, 0, 0).await;
    // Even tasks settle 5/5, odd tasks 8/2, alternating replicas independently.
    let mut tasks = Vec::new();
    for n in 0..16usize {
        let mut client = if (n / 2).is_multiple_of(2) {
            p.a.clone()
        } else {
            p.b.clone()
        };
        let (plastic, metal) = if n.is_multiple_of(2) { (5, 5) } else { (8, 2) };
        let request = settle(&race, &player, plastic, metal);
        tasks.push(tokio::spawn(async move {
            (
                (plastic, metal),
                client.settle_race(request).await.unwrap().into_inner(),
            )
        }));
    }
    let mut fresh = Vec::new();
    for task in tasks {
        let (wanted, response) = task.await.unwrap();
        match settlement_result(response) {
            Ok((false, _)) => fresh.push(wanted),
            Ok((true, profile)) => {
                assert_eq!(
                    (profile.plastic, profile.metal),
                    wanted,
                    "replay of the winner"
                )
            }
            Err(code) => assert_eq!(
                code,
                SettlementRejectionCode::SettlementRejectionConflict as i32
            ),
        }
    }
    assert_eq!(fresh.len(), 1, "exactly one request is applied: {fresh:?}");
    let profile = p.profile(&player).await;
    assert_eq!((profile.plastic, profile.metal), fresh[0]);
    assert_eq!(profile.profile_revision, 2);
    assert_eq!(settlement_rows(&p, &player).await, 1);
}

#[tokio::test]
async fn a_replacement_instance_continues_where_a_stopped_one_left_off() {
    let Some(url) = common::database_url("a_replacement_instance_continues") else {
        return;
    };
    let player = unique("two-restart");
    let race = unique("race");

    // instance 1 does durable work, then goes away completely (server and pool)
    let (first, first_pool) = start_instance(&url).await;
    let mut c1 = first.client.clone();
    let race_request = SettleRaceRequest {
        race_id: race.clone(),
        player_id: player.clone(),
        outcome: 1,
        credited_plastic: 40,
        credited_metal: 0,
    };
    c1.settle_race(race_request.clone()).await.unwrap();
    let exchange = ExchangeMaterialsRequest {
        player_id: player.clone(),
        request_id: "ex-1".into(),
        catalog_version: V.into(),
        material: Material::Plastic as i32,
        amount: 25,
    };
    let done = c1
        .exchange_materials(exchange.clone())
        .await
        .unwrap()
        .into_inner();
    let (_, before) = is_success(&done).unwrap();
    let before = before.clone();
    drop(c1);
    first.shutdown().await;
    first_pool.close().await;

    // instance 2 sees everything and replays instead of repeating
    let (second, _second_pool) = start_instance(&url).await;
    let mut c2 = second.client.clone();
    let replay = c2.exchange_materials(exchange).await.unwrap().into_inner();
    let (replayed, after) = is_success(&replay).unwrap();
    assert!(replayed, "the restarted service recognises the request id");
    assert_eq!(after, &before);
    match c2
        .settle_race(race_request)
        .await
        .unwrap()
        .into_inner()
        .outcome
        .unwrap()
    {
        SettleArm::Success(s) => {
            assert!(s.replayed);
            assert_eq!(s.profile.unwrap(), before);
        }
        SettleArm::Rejection(r) => panic!("{r:?}"),
    }
    let changed = SettleRaceRequest {
        credited_plastic: 41,
        ..SettleRaceRequest {
            race_id: race,
            player_id: player.clone(),
            outcome: 1,
            credited_plastic: 0,
            credited_metal: 0,
        }
    };
    match c2
        .settle_race(changed)
        .await
        .unwrap()
        .into_inner()
        .outcome
        .unwrap()
    {
        SettleArm::Rejection(r) => assert_eq!(
            r.code,
            SettlementRejectionCode::SettlementRejectionConflict as i32
        ),
        SettleArm::Success(s) => panic!("{s:?}"),
    }
    // and keeps working on top of the old state
    let next = c2
        .buy_item(buy(&player, "buy-after-restart", "manglar"))
        .await
        .unwrap()
        .into_inner();
    let (_, profile) = is_success(&next).unwrap();
    assert_eq!(profile.coins, before.coins - 60);
    assert_eq!(profile.profile_revision, before.profile_revision + 1);
}
