//! The eight RPCs over a real Tonic connection and PostgreSQL (F52-T6): wire
//! shapes, status codes and business outcomes. Needs a migrated database, see
//! `tests/common/mod.rs`.

mod common;

use common::{start_instance, unique, Client};
use player_profile_service::pb::{
    profile_mutation_response::Outcome as MutationArm, settle_race_response::Outcome as SettleArm,
    BuyItemRequest, CraftItemRequest, EquipItemRequest, ExchangeMaterialsRequest,
    GetCatalogRequest, GetProfileRequest, ItemType, Material, MutationRejectionCode, PlayerProfile,
    SetAppearanceRequest, SettleRaceRequest, SettlementRejectionCode,
};
use tonic::Code;

const V: &str = "online-v2";

async fn client(test: &str) -> Option<(Client, common::Instance)> {
    let url = common::database_url(test)?;
    let (instance, _pool) = start_instance(&url).await;
    Some((instance.client.clone(), instance))
}

macro_rules! client {
    ($name:expr) => {
        match client($name).await {
            Some(pair) => pair,
            None => return,
        }
    };
}

fn buy(player: &str, request: &str, item: &str) -> BuyItemRequest {
    BuyItemRequest {
        player_id: player.into(),
        request_id: request.into(),
        catalog_version: V.into(),
        item_id: item.into(),
    }
}

fn finish(race: &str, player: &str, plastic: u64, metal: u64) -> SettleRaceRequest {
    SettleRaceRequest {
        race_id: race.into(),
        player_id: player.into(),
        outcome: 1,
        credited_plastic: plastic,
        credited_metal: metal,
    }
}

fn success(response: player_profile_service::pb::ProfileMutationResponse) -> (bool, PlayerProfile) {
    match response.outcome.expect("outcome") {
        MutationArm::Success(s) => (s.replayed, s.profile.expect("profile")),
        MutationArm::Rejection(r) => panic!("unexpected rejection {r:?}"),
    }
}

fn rejection(
    response: player_profile_service::pb::ProfileMutationResponse,
) -> (MutationRejectionCode, bool) {
    match response.outcome.expect("outcome") {
        MutationArm::Rejection(r) => (MutationRejectionCode::try_from(r.code).unwrap(), r.replayed),
        MutationArm::Success(s) => panic!("unexpected success {s:?}"),
    }
}

#[tokio::test]
async fn a_new_player_gets_a_complete_online_profile_without_any_local_state() {
    let (mut c, instance) = client!("a_new_player_gets_a_complete_online_profile");
    let player = unique("wire-new");
    let profile = c
        .get_profile(GetProfileRequest {
            player_id: player.clone(),
        })
        .await
        .unwrap()
        .into_inner()
        .profile
        .unwrap();
    assert_eq!(profile.player_id, player);
    assert!(profile.profile_revision > 0);
    assert_eq!((profile.coins, profile.plastic, profile.metal), (0, 0, 0));
    assert_eq!(profile.owned_item_ids.len(), 12);
    let equipment = profile.equipment.clone().unwrap();
    assert_eq!(
        (
            equipment.board_id.as_str(),
            equipment.outfit_id.as_str(),
            equipment.net_id.as_str(),
            equipment.hair_id.as_str(),
            equipment.character_id.as_str()
        ),
        ("coral", "costero", "red-base", "swept", "nico")
    );
    let appearance = profile.appearance.clone().unwrap();
    assert_eq!(
        (
            appearance.skin_id.as_str(),
            appearance.hair_color_id.as_str()
        ),
        ("medium", "brown")
    );
    // idempotent read
    let again = c
        .get_profile(GetProfileRequest { player_id: player })
        .await
        .unwrap()
        .into_inner()
        .profile
        .unwrap();
    assert_eq!(again, profile);
    instance.shutdown().await;
}

#[tokio::test]
async fn the_catalog_is_stable_online_v1_with_items_and_appearance_options() {
    let (mut c, instance) = client!("the_catalog_is_stable_online_v1");
    let active = c
        .get_catalog(GetCatalogRequest::default())
        .await
        .unwrap()
        .into_inner();
    assert_eq!(active.catalog_version, V);
    assert_eq!(active.items.len(), 22);
    assert_eq!(active.skin_tones.len(), 5);
    assert_eq!(active.hair_colors.len(), 6);
    let explicit = c
        .get_catalog(GetCatalogRequest {
            catalog_version: V.into(),
        })
        .await
        .unwrap()
        .into_inner();
    assert_eq!(
        explicit, active,
        "the active version is online-v2 and is stable"
    );

    let item = |id: &str| active.items.iter().find(|i| i.item_id == id).unwrap();
    assert_eq!(item("manglar").item_type, ItemType::Board as i32);
    assert!(item("manglar").purchasable && !item("manglar").craftable);
    assert_eq!(item("manglar").price_coins, 300);
    assert!(item("red-sol").craftable && !item("red-sol").purchasable);
    assert_eq!(
        (item("red-sol").recipe_plastic, item("red-sol").recipe_metal),
        (120, 80)
    );
    assert_eq!(item("nico").item_type, ItemType::Character as i32);
    assert!(item("red-aurora")
        .metadata
        .iter()
        .any(|m| m.key == "rarity" && m.value == "Especial"));
    assert!(active.items.iter().all(|i| i.enabled));

    let missing = c
        .get_catalog(GetCatalogRequest {
            catalog_version: "online-v999".into(),
        })
        .await
        .unwrap_err();
    assert_eq!(missing.code(), Code::NotFound);
    instance.shutdown().await;
}

#[tokio::test]
async fn business_outcomes_travel_in_the_body_with_status_ok() {
    let (mut c, instance) = client!("business_outcomes_travel_in_the_body");
    let player = unique("wire-buy");

    // not enough coins: rejection in the body, gRPC OK
    let poor = c
        .buy_item(buy(&player, "r1", "manglar"))
        .await
        .unwrap()
        .into_inner();
    assert_eq!(poor.request_id, "r1");
    assert_eq!(
        rejection(poor),
        (
            MutationRejectionCode::MutationRejectionInsufficientCoins,
            false
        )
    );
    let replay = c
        .buy_item(buy(&player, "r1", "manglar"))
        .await
        .unwrap()
        .into_inner();
    assert_eq!(
        rejection(replay),
        (
            MutationRejectionCode::MutationRejectionInsufficientCoins,
            true
        )
    );

    // earn coins through the authoritative path, then buy
    c.settle_race(finish(&unique("race"), &player, 125, 0))
        .await
        .unwrap();
    let exchanged = c
        .exchange_materials(ExchangeMaterialsRequest {
            player_id: player.clone(),
            request_id: "ex1".into(),
            catalog_version: V.into(),
            material: Material::Plastic as i32,
            amount: 100,
        })
        .await
        .unwrap()
        .into_inner();
    let (_, profile) = success(exchanged);
    assert_eq!((profile.coins, profile.plastic), (400, 25));

    let (replayed, bought) = success(
        c.buy_item(buy(&player, "r2", "manglar"))
            .await
            .unwrap()
            .into_inner(),
    );
    assert!(!replayed);
    assert_eq!(bought.coins, 100);
    assert!(bought.owned_item_ids.contains(&"manglar".to_string()));

    let (replayed, again) = success(
        c.buy_item(buy(&player, "r2", "manglar"))
            .await
            .unwrap()
            .into_inner(),
    );
    assert!(replayed);
    assert_eq!(again, bought);

    let conflict = c
        .buy_item(buy(&player, "r2", "sol"))
        .await
        .unwrap()
        .into_inner();
    assert_eq!(
        rejection(conflict),
        (
            MutationRejectionCode::MutationRejectionIdempotencyConflict,
            false
        )
    );

    let bad_version = c
        .buy_item(BuyItemRequest {
            catalog_version: "nope".into(),
            ..buy(&player, "r3", "sol")
        })
        .await
        .unwrap()
        .into_inner();
    assert_eq!(
        rejection(bad_version),
        (
            MutationRejectionCode::MutationRejectionInvalidCatalogVersion,
            false
        )
    );

    // craft, equip and appearance
    let crafted = c
        .craft_item(CraftItemRequest {
            player_id: player.clone(),
            request_id: "cr1".into(),
            catalog_version: V.into(),
            item_id: "red-reuso".into(),
        })
        .await
        .unwrap()
        .into_inner();
    assert_eq!(
        rejection(crafted),
        (
            MutationRejectionCode::MutationRejectionInsufficientMaterials,
            false
        )
    );
    let (_, equipped) = success(
        c.equip_item(EquipItemRequest {
            player_id: player.clone(),
            request_id: "eq1".into(),
            catalog_version: V.into(),
            item_id: "manglar".into(),
        })
        .await
        .unwrap()
        .into_inner(),
    );
    assert_eq!(equipped.equipment.unwrap().board_id, "manglar");
    let (_, styled) = success(
        c.set_appearance(SetAppearanceRequest {
            player_id: player.clone(),
            request_id: "ap1".into(),
            catalog_version: V.into(),
            skin_id: "deep".into(),
            hair_color_id: "silver".into(),
        })
        .await
        .unwrap()
        .into_inner(),
    );
    assert_eq!(styled.appearance.clone().unwrap().skin_id, "deep");

    // the last mutation's profile is exactly what GetProfile returns
    let read = c
        .get_profile(GetProfileRequest { player_id: player })
        .await
        .unwrap()
        .into_inner()
        .profile
        .unwrap();
    assert_eq!(read, styled);
    instance.shutdown().await;
}

#[tokio::test]
async fn settlement_over_the_wire_is_idempotent_and_never_credits_a_non_finished_race() {
    let (mut c, instance) = client!("settlement_over_the_wire");
    let player = unique("wire-settle");
    let race = unique("race");

    let first = c
        .settle_race(finish(&race, &player, 6, 4))
        .await
        .unwrap()
        .into_inner();
    assert_eq!(
        (first.race_id.as_str(), first.player_id.as_str()),
        (race.as_str(), player.as_str())
    );
    let profile = match first.outcome.unwrap() {
        SettleArm::Success(s) => {
            assert!(!s.replayed);
            s.profile.unwrap()
        }
        SettleArm::Rejection(r) => panic!("{r:?}"),
    };
    assert_eq!((profile.plastic, profile.metal), (6, 4));
    assert!(profile.profile_revision > 1);

    match c
        .settle_race(finish(&race, &player, 6, 4))
        .await
        .unwrap()
        .into_inner()
        .outcome
        .unwrap()
    {
        SettleArm::Success(s) => {
            assert!(s.replayed);
            assert_eq!(s.profile.unwrap(), profile);
        }
        SettleArm::Rejection(r) => panic!("{r:?}"),
    }
    match c
        .settle_race(finish(&race, &player, 7, 4))
        .await
        .unwrap()
        .into_inner()
        .outcome
        .unwrap()
    {
        SettleArm::Rejection(r) => {
            assert_eq!(
                r.code,
                SettlementRejectionCode::SettlementRejectionConflict as i32
            );
            assert!(!r.replayed);
        }
        SettleArm::Success(s) => panic!("{s:?}"),
    }
    // a disqualified race with a credit is refused
    let dq = SettleRaceRequest {
        outcome: 2,
        ..finish(&unique("race"), &player, 1, 0)
    };
    match c
        .settle_race(dq)
        .await
        .unwrap()
        .into_inner()
        .outcome
        .unwrap()
    {
        SettleArm::Rejection(r) => {
            assert_eq!(
                r.code,
                SettlementRejectionCode::SettlementRejectionInvalidSettlement as i32
            )
        }
        SettleArm::Success(s) => panic!("{s:?}"),
    }
    let after = c
        .get_profile(GetProfileRequest { player_id: player })
        .await
        .unwrap()
        .into_inner()
        .profile
        .unwrap();
    assert_eq!(after, profile);
    instance.shutdown().await;
}
