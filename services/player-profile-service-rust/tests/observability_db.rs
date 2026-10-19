//! Business metrics against a real database: RPC outcomes, idempotency replays
//! and conflicts, settlement results and the pool gauges, observed through the
//! same wiring the runtime uses. Needs a migrated database, see
//! `tests/common/mod.rs`.

mod common;

use std::sync::Arc;

use common::{start_instance_with_metrics, unique};
use player_profile_service::{
    metrics::Metrics,
    pb::{
        BuyItemRequest, ExchangeMaterialsRequest, GetProfileRequest, Material, SettleRaceRequest,
    },
};

const V: &str = "online-v1";

/// Value of the first series of `name` that carries every label, or 0.
fn series(text: &str, name: &str, labels: &[&str]) -> f64 {
    text.lines()
        .find(|line| {
            line.starts_with(name)
                && line[name.len()..].starts_with(['{', ' '])
                && labels.iter().all(|label| line.contains(label))
        })
        .map(|line| line.rsplit(' ').next().unwrap().parse().unwrap())
        .unwrap_or_else(|| panic!("no series {name} with {labels:?} in:\n{text}"))
}

fn rpc(text: &str, rpc: &str, outcome: &str, code: &str) -> f64 {
    let labels = [
        format!(r#"rpc="{rpc}""#),
        format!(r#"outcome="{outcome}""#),
        format!(r#"code="{code}""#),
    ];
    let labels: Vec<&str> = labels.iter().map(String::as_str).collect();
    text.lines()
        .find(|l| {
            l.starts_with("player_profile_rpc_requests_total{")
                && labels.iter().all(|label| l.contains(label))
        })
        .map(|l| l.rsplit(' ').next().unwrap().parse().unwrap())
        .unwrap_or(0.0)
}

fn buy(player: &str, request: &str, item: &str) -> BuyItemRequest {
    BuyItemRequest {
        player_id: player.into(),
        request_id: request.into(),
        catalog_version: V.into(),
        item_id: item.into(),
    }
}

fn settle(race: &str, player: &str, outcome: i32, plastic: u64) -> SettleRaceRequest {
    SettleRaceRequest {
        race_id: race.into(),
        player_id: player.into(),
        outcome,
        credited_plastic: plastic,
        credited_metal: 0,
    }
}

#[tokio::test]
async fn business_outcomes_replays_conflicts_and_settlements_are_counted() {
    let Some(url) = common::database_url("business_outcomes_replays_conflicts_and_settlements")
    else {
        return;
    };
    let metrics = Arc::new(Metrics::new("rust-db-1"));
    let (instance, pool) = start_instance_with_metrics(&url, metrics.clone()).await;
    let mut c = instance.client.clone();
    let player = unique("obs");
    let race = unique("race");

    // Settlement: credited, replayed, conflict, invalid.
    c.settle_race(settle(&race, &player, 1, 25)).await.unwrap();
    c.settle_race(settle(&race, &player, 1, 25)).await.unwrap();
    c.settle_race(settle(&race, &player, 1, 26)).await.unwrap();
    c.settle_race(settle(&unique("race"), &player, 2, 5))
        .await
        .unwrap();

    // Mutations: exchange, buy, replay, conflict, plain rejection.
    c.exchange_materials(ExchangeMaterialsRequest {
        player_id: player.clone(),
        request_id: "ex1".into(),
        catalog_version: V.into(),
        material: Material::Plastic as i32,
        amount: 20,
    })
    .await
    .unwrap();
    c.buy_item(buy(&player, "r2", "manglar")).await.unwrap();
    c.buy_item(buy(&player, "r2", "manglar")).await.unwrap();
    c.buy_item(buy(&player, "r2", "sol")).await.unwrap();
    c.buy_item(buy(&player, "r3", "sol")).await.unwrap();
    c.get_profile(GetProfileRequest {
        player_id: player.clone(),
    })
    .await
    .unwrap();

    let text = metrics.render();
    assert_eq!(rpc(&text, "SettleRace", "applied", "OK"), 1.0);
    assert_eq!(rpc(&text, "SettleRace", "replayed", "OK"), 1.0);
    assert_eq!(rpc(&text, "SettleRace", "conflict", "CONFLICT"), 1.0);
    assert_eq!(
        rpc(&text, "SettleRace", "rejected", "INVALID_SETTLEMENT"),
        1.0
    );
    assert_eq!(rpc(&text, "ExchangeMaterials", "applied", "OK"), 1.0);
    assert_eq!(rpc(&text, "BuyItem", "applied", "OK"), 1.0);
    assert_eq!(rpc(&text, "BuyItem", "replayed", "OK"), 1.0);
    assert_eq!(
        rpc(&text, "BuyItem", "conflict", "IDEMPOTENCY_CONFLICT"),
        1.0
    );
    assert_eq!(rpc(&text, "BuyItem", "rejected", "INSUFFICIENT_COINS"), 1.0);
    assert_eq!(rpc(&text, "GetProfile", "applied", "OK"), 1.0);

    for (outcome, expected) in [
        ("credited", 1.0),
        ("replayed", 1.0),
        ("conflict", 1.0),
        ("invalid", 1.0),
    ] {
        let label = format!(r#"outcome="{outcome}""#);
        assert_eq!(
            series(&text, "player_profile_settlements_total", &[&label]),
            expected,
            "{outcome}"
        );
    }
    let op = |name: &str, operation: &str| {
        series(&text, name, &[&format!(r#"operation="{operation}""#)])
    };
    assert_eq!(op("player_profile_idempotency_replays_total", "buy"), 1.0);
    assert_eq!(op("player_profile_idempotency_conflicts_total", "buy"), 1.0);
    assert_eq!(
        op("player_profile_idempotency_replays_total", "settle_race"),
        1.0
    );
    assert_eq!(
        op("player_profile_idempotency_conflicts_total", "settle_race"),
        1.0
    );
    assert_eq!(
        op("player_profile_idempotency_replays_total", "exchange"),
        0.0
    );

    // Pool: the business pool of this instance, consistent with itself.
    let size = series(&text, "player_profile_db_pool_connections", &[]);
    let idle = series(&text, "player_profile_db_pool_idle_connections", &[]);
    let in_use = series(&text, "player_profile_db_pool_in_use_connections", &[]);
    assert!(
        size >= 1.0,
        "the pool opened connections for the traffic above"
    );
    assert_eq!(size, idle + in_use);
    assert_eq!(
        series(&text, "player_profile_db_pool_max_connections", &[]),
        10.0
    );

    // Nothing the database or the client sent leaks into the exposition.
    assert!(!text.contains(&player));
    assert!(!text.contains(&url));
    assert!(!text.contains("postgres://"));

    instance.shutdown().await;
    pool.close().await;
}

#[tokio::test]
async fn two_replicas_expose_their_own_series_under_distinct_instance_ids() {
    let Some(url) = common::database_url("two_replicas_expose_their_own_series") else {
        return;
    };
    let (m1, m2) = (
        Arc::new(Metrics::new("rust-1")),
        Arc::new(Metrics::new("rust-2")),
    );
    let (i1, pool1) = start_instance_with_metrics(&url, m1.clone()).await;
    let (i2, pool2) = start_instance_with_metrics(&url, m2.clone()).await;
    let player = unique("obs-two");

    let mut c1 = i1.client.clone();
    let mut c2 = i2.client.clone();
    c1.get_profile(GetProfileRequest {
        player_id: player.clone(),
    })
    .await
    .unwrap();
    c1.get_profile(GetProfileRequest {
        player_id: player.clone(),
    })
    .await
    .unwrap();
    c2.get_profile(GetProfileRequest { player_id: player })
        .await
        .unwrap();

    let (t1, t2) = (m1.render(), m2.render());
    assert_eq!(rpc(&t1, "GetProfile", "applied", "OK"), 2.0);
    assert_eq!(rpc(&t2, "GetProfile", "applied", "OK"), 1.0);
    assert!(t1.contains(r#"instance_id="rust-1""#) && !t1.contains(r#"instance_id="rust-2""#));
    assert!(t2.contains(r#"instance_id="rust-2""#) && !t2.contains(r#"instance_id="rust-1""#));

    i1.shutdown().await;
    i2.shutdown().await;
    pool1.close().await;
    pool2.close().await;
}
