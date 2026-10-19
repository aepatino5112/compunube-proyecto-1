//! In-process Tonic wiring: the 8 contract RPCs exist and answer UNIMPLEMENTED
//! until F52. No PostgreSQL required.

use std::sync::Arc;

use player_profile_service::{
    application::PlayerProfileApp,
    pb::{
        player_profile_service_client::PlayerProfileServiceClient, BuyItemRequest,
        CraftItemRequest, EquipItemRequest, ExchangeMaterialsRequest, GetCatalogRequest,
        GetProfileRequest, SetAppearanceRequest, SettleRaceRequest,
    },
    repository::Repositories,
    transport::grpc::PlayerProfileGrpc,
};
use tokio::{net::TcpListener, sync::oneshot};
use tokio_stream::wrappers::TcpListenerStream;
use tonic::{transport::Server, Code};

async fn start() -> (
    PlayerProfileServiceClient<tonic::transport::Channel>,
    oneshot::Sender<()>,
) {
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

#[tokio::test]
async fn mutations_validate_requests_and_the_remaining_rpcs_are_seams() {
    let (mut client, stop) = start().await;

    // Empty ids are structurally invalid (E43), before any storage access.
    let invalid = [
        (
            "BuyItem",
            client.buy_item(BuyItemRequest::default()).await.err(),
        ),
        (
            "CraftItem",
            client.craft_item(CraftItemRequest::default()).await.err(),
        ),
        (
            "ExchangeMaterials",
            client
                .exchange_materials(ExchangeMaterialsRequest::default())
                .await
                .err(),
        ),
        (
            "EquipItem",
            client.equip_item(EquipItemRequest::default()).await.err(),
        ),
        (
            "SetAppearance",
            client
                .set_appearance(SetAppearanceRequest::default())
                .await
                .err(),
        ),
    ];
    for (name, status) in invalid {
        let status = status.unwrap_or_else(|| panic!("{name} unexpectedly succeeded"));
        assert_eq!(status.code(), Code::InvalidArgument, "{name}");
    }

    // Still delivered by later F52 tasks.
    let seams = [
        (
            "GetProfile",
            client.get_profile(GetProfileRequest::default()).await.err(),
        ),
        (
            "GetCatalog",
            client.get_catalog(GetCatalogRequest::default()).await.err(),
        ),
        (
            "SettleRace",
            client.settle_race(SettleRaceRequest::default()).await.err(),
        ),
    ];
    for (name, status) in seams {
        let status = status.unwrap_or_else(|| panic!("{name} unexpectedly succeeded"));
        assert_eq!(status.code(), Code::Unimplemented, "{name}");
    }

    let _ = stop.send(());
}
