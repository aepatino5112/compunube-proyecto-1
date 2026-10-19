//! In-process Tonic wiring without PostgreSQL: malformed requests map to
//! `INVALID_ARGUMENT` before any storage access and an unreachable store maps
//! to `UNAVAILABLE` with a fixed message (E43). Business behaviour against a
//! real database is covered by `grpc_economy.rs`.

use std::sync::Arc;

use player_profile_service::{
    application::PlayerProfileApp,
    pb::{
        player_profile_service_client::PlayerProfileServiceClient, BuyItemRequest,
        CraftItemRequest, EquipItemRequest, ExchangeMaterialsRequest, GetCatalogRequest,
        GetProfileRequest, Material, RaceOutcome, SetAppearanceRequest, SettleRaceRequest,
    },
    repository::Repositories,
    transport::grpc::PlayerProfileGrpc,
};
use tokio::{net::TcpListener, sync::oneshot};
use tokio_stream::wrappers::TcpListenerStream;
use tonic::{transport::Server, Code, Status};

type Client = PlayerProfileServiceClient<tonic::transport::Channel>;

async fn start() -> (Client, oneshot::Sender<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let app = Arc::new(PlayerProfileApp::new(Repositories::unavailable()));
    let (stop_tx, stop_rx) = oneshot::channel::<()>();
    tokio::spawn(async move {
        Server::builder()
            .add_service(PlayerProfileGrpc::new(app).into_server())
            .serve_with_incoming_shutdown(TcpListenerStream::new(listener), async {
                let _ = stop_rx.await;
            })
            .await
            .unwrap();
    });
    let client = PlayerProfileServiceClient::connect(format!("http://{addr}"))
        .await
        .unwrap();
    (client, stop_tx)
}

fn expect(name: &str, status: Option<Status>, code: Code) {
    let status = status.unwrap_or_else(|| panic!("{name} unexpectedly succeeded"));
    assert_eq!(status.code(), code, "{name}: {}", status.message());
}

#[tokio::test]
async fn malformed_requests_are_invalid_arguments_on_all_eight_rpcs() {
    let (mut c, stop) = start().await;
    let cases = [
        (
            "GetProfile",
            c.get_profile(GetProfileRequest::default()).await.err(),
        ),
        (
            "GetCatalog",
            c.get_catalog(GetCatalogRequest {
                catalog_version: "x".repeat(300),
            })
            .await
            .err(),
        ),
        ("BuyItem", c.buy_item(BuyItemRequest::default()).await.err()),
        (
            "CraftItem",
            c.craft_item(CraftItemRequest::default()).await.err(),
        ),
        (
            "ExchangeMaterials",
            c.exchange_materials(ExchangeMaterialsRequest::default())
                .await
                .err(),
        ),
        (
            "EquipItem",
            c.equip_item(EquipItemRequest::default()).await.err(),
        ),
        (
            "SetAppearance",
            c.set_appearance(SetAppearanceRequest::default())
                .await
                .err(),
        ),
        (
            "SettleRace",
            c.settle_race(SettleRaceRequest::default()).await.err(),
        ),
    ];
    assert_eq!(cases.len(), 8);
    for (name, status) in cases {
        expect(name, status, Code::InvalidArgument);
    }
    let _ = stop.send(());
}

#[tokio::test]
async fn enums_must_be_specified_and_known() {
    let (mut c, stop) = start().await;
    for material in [Material::Unspecified as i32, 99] {
        let status = c
            .exchange_materials(ExchangeMaterialsRequest {
                player_id: "p".into(),
                request_id: "r".into(),
                catalog_version: "online-v1".into(),
                material,
                amount: 1,
            })
            .await
            .err();
        expect("ExchangeMaterials", status, Code::InvalidArgument);
    }
    for amount in [0, 1_000_000_000] {
        let status = c
            .exchange_materials(ExchangeMaterialsRequest {
                player_id: "p".into(),
                request_id: "r".into(),
                catalog_version: "online-v1".into(),
                material: Material::Plastic as i32,
                amount,
            })
            .await
            .err();
        expect("ExchangeMaterials amount", status, Code::InvalidArgument);
    }
    for outcome in [RaceOutcome::Unspecified as i32, 42] {
        let status = c
            .settle_race(SettleRaceRequest {
                race_id: "race".into(),
                player_id: "p".into(),
                outcome,
                credited_plastic: 0,
                credited_metal: 0,
            })
            .await
            .err();
        expect("SettleRace", status, Code::InvalidArgument);
    }
    let _ = stop.send(());
}

#[tokio::test]
async fn an_unreachable_store_is_unavailable_with_a_fixed_message() {
    let (mut c, stop) = start().await;
    let item = |id: &str| (id.to_string(), "r1".to_string(), "online-v1".to_string());
    let (player, request, version) = item("p1");
    let results = [
        (
            "GetProfile",
            c.get_profile(GetProfileRequest {
                player_id: player.clone(),
            })
            .await
            .err(),
        ),
        (
            "GetCatalog",
            c.get_catalog(GetCatalogRequest::default()).await.err(),
        ),
        (
            "BuyItem",
            c.buy_item(BuyItemRequest {
                player_id: player.clone(),
                request_id: request.clone(),
                catalog_version: version.clone(),
                item_id: "manglar".into(),
            })
            .await
            .err(),
        ),
        (
            "SetAppearance",
            c.set_appearance(SetAppearanceRequest {
                player_id: player.clone(),
                request_id: request.clone(),
                catalog_version: version.clone(),
                skin_id: "light".into(),
                hair_color_id: "blue".into(),
            })
            .await
            .err(),
        ),
        (
            "SettleRace",
            c.settle_race(SettleRaceRequest {
                race_id: "race".into(),
                player_id: player,
                outcome: RaceOutcome::Finished as i32,
                credited_plastic: 1,
                credited_metal: 1,
            })
            .await
            .err(),
        ),
    ];
    for (name, status) in results {
        let status = status.unwrap_or_else(|| panic!("{name} unexpectedly succeeded"));
        assert_eq!(status.code(), Code::Unavailable, "{name}");
        assert_eq!(
            status.message(),
            "service temporarily unavailable",
            "{name}"
        );
    }
    let _ = stop.send(());
}
