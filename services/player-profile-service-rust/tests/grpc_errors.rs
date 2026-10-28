//! In-process Tonic wiring without PostgreSQL: malformed requests map to
//! `INVALID_ARGUMENT` before any storage access and an unreachable store maps
//! to `UNAVAILABLE` with a fixed message (E43). Storage failures of every other
//! category (capacity, timeout, unexpected) are injected through fake
//! repository ports, so the whole E43 status table is checked over the wire
//! without a database. Business behaviour against a real database is covered by
//! `grpc_economy.rs`.

use std::sync::Arc;

use async_trait::async_trait;
use player_profile_service::{
    application::PlayerProfileApp,
    domain::Catalog,
    pb::{
        player_profile_service_client::PlayerProfileServiceClient, BuyItemRequest,
        CraftItemRequest, EquipItemRequest, ExchangeMaterialsRequest, GetCatalogRequest,
        GetProfileRequest, Material, RaceOutcome, SetAppearanceRequest, SettleRaceRequest,
    },
    repository::{
        CatalogRepository, EconomyTransaction, Repositories, RepositoryError, TransactionManager,
    },
    transport::grpc::PlayerProfileGrpc,
};
use tokio::{net::TcpListener, sync::oneshot};
use tokio_stream::wrappers::TcpListenerStream;
use tonic::{transport::Server, Code, Status};

type Client = PlayerProfileServiceClient<tonic::transport::Channel>;

async fn start() -> (Client, oneshot::Sender<()>) {
    start_with(Repositories::unavailable()).await
}

async fn start_with(repositories: Repositories) -> (Client, oneshot::Sender<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let app = Arc::new(PlayerProfileApp::new(repositories));
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
                catalog_version: "online-v2".into(),
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
                catalog_version: "online-v2".into(),
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
    let item = |id: &str| (id.to_string(), "r1".to_string(), "online-v2".to_string());
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

// ---- E43 table over the wire, with injected storage failures ---------------

/// Storage whose every call fails with one fixed error.
struct FailingStore(RepositoryError);

#[async_trait]
impl CatalogRepository for FailingStore {
    async fn find_catalog(&self, _: Option<&str>) -> Result<Option<Catalog>, RepositoryError> {
        Err(self.0.clone())
    }
}

#[async_trait]
impl TransactionManager for FailingStore {
    async fn begin(&self) -> Result<Box<dyn EconomyTransaction>, RepositoryError> {
        Err(self.0.clone())
    }
}

fn failing(error: RepositoryError) -> Repositories {
    let store = Arc::new(FailingStore(error));
    Repositories {
        catalog: store.clone(),
        transactions: store,
    }
}

/// One well-formed request per RPC: every one passes validation and reaches
/// the storage ports.
async fn well_formed_on_every_rpc(c: &mut Client) -> Vec<(&'static str, Option<Status>)> {
    let (player, request, version) = ("p1".to_string(), "r1".to_string(), "online-v2".to_string());
    vec![
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
            "CraftItem",
            c.craft_item(CraftItemRequest {
                player_id: player.clone(),
                request_id: request.clone(),
                catalog_version: version.clone(),
                item_id: "red-reuso".into(),
            })
            .await
            .err(),
        ),
        (
            "ExchangeMaterials",
            c.exchange_materials(ExchangeMaterialsRequest {
                player_id: player.clone(),
                request_id: request.clone(),
                catalog_version: version.clone(),
                material: Material::Plastic as i32,
                amount: 1,
            })
            .await
            .err(),
        ),
        (
            "EquipItem",
            c.equip_item(EquipItemRequest {
                player_id: player.clone(),
                request_id: request.clone(),
                catalog_version: version.clone(),
                item_id: "coral".into(),
            })
            .await
            .err(),
        ),
        (
            "SetAppearance",
            c.set_appearance(SetAppearanceRequest {
                player_id: player.clone(),
                request_id: request,
                catalog_version: version,
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
    ]
}

#[tokio::test]
async fn capacity_timeout_and_unexpected_failures_map_to_the_e43_statuses_on_all_eight_rpcs() {
    // The detail an unexpected failure may carry server-side: SQL, a host and a
    // credential. None of it may reach the client.
    let leaky = "SELECT * FROM player.profiles WHERE password = 'hunter2' (host db.internal:5432)";
    let cases = [
        (
            RepositoryError::PoolExhausted,
            Code::ResourceExhausted,
            "service capacity exhausted",
        ),
        (
            RepositoryError::Timeout,
            Code::DeadlineExceeded,
            "deadline exceeded",
        ),
        (
            RepositoryError::Unexpected(leaky.to_string()),
            Code::Internal,
            "internal error",
        ),
    ];
    for (error, code, message) in cases {
        let (mut c, stop) = start_with(failing(error.clone())).await;
        let results = well_formed_on_every_rpc(&mut c).await;
        assert_eq!(results.len(), 8);
        for (name, status) in results {
            let status = status.unwrap_or_else(|| panic!("{name} unexpectedly succeeded"));
            assert_eq!(status.code(), code, "{name} with {error}");
            assert_eq!(status.message(), message, "{name} with {error}");
            let everything = format!("{status:?}");
            for secret in ["SELECT", "player.profiles", "hunter2", "db.internal"] {
                assert!(
                    !everything.contains(secret),
                    "{name} leaked {secret:?}: {everything}"
                );
            }
        }
        let _ = stop.send(());
    }
}

struct FixedCatalog(Option<Catalog>);

#[async_trait]
impl CatalogRepository for FixedCatalog {
    async fn find_catalog(&self, _: Option<&str>) -> Result<Option<Catalog>, RepositoryError> {
        Ok(self.0.clone())
    }
}

fn with_catalog(catalog: Option<Catalog>) -> Repositories {
    Repositories {
        catalog: Arc::new(FixedCatalog(catalog)),
        transactions: Repositories::unavailable().transactions,
    }
}

#[tokio::test]
async fn without_an_active_version_the_catalog_is_not_found_and_an_empty_one_is_still_served() {
    let (mut c, stop) = start_with(with_catalog(None)).await;
    let status = c
        .get_catalog(GetCatalogRequest::default())
        .await
        .unwrap_err();
    assert_eq!(status.code(), Code::NotFound);
    assert_eq!(status.message(), "no catalog version is active");
    let _ = stop.send(());

    let (mut c, stop) = start_with(with_catalog(Some(Catalog::new("empty-v0", Vec::new())))).await;
    let catalog = c
        .get_catalog(GetCatalogRequest::default())
        .await
        .unwrap()
        .into_inner();
    assert_eq!(catalog.catalog_version, "empty-v0");
    assert!(catalog.items.is_empty());
    assert_eq!(
        (catalog.skin_tones.len(), catalog.hair_colors.len()),
        (5, 6),
        "appearance options do not depend on the catalog entries"
    );
    let _ = stop.send(());
}

#[tokio::test]
async fn oversized_or_control_character_ids_and_out_of_range_amounts_are_invalid_arguments() {
    // The store is unavailable: only a request that fails validation can answer
    // INVALID_ARGUMENT instead of UNAVAILABLE.
    let (mut c, stop) = start().await;
    let long = "x".repeat(129);
    let bad = "bad\nid".to_string();
    let item = |player: &str, request: &str, item_id: &str| {
        (
            player.to_string(),
            request.to_string(),
            "online-v2".to_string(),
            item_id.to_string(),
        )
    };
    let (p, r, v, i) = item(&long, "r", "manglar");
    let buy = c
        .buy_item(BuyItemRequest {
            player_id: p,
            request_id: r,
            catalog_version: v,
            item_id: i,
        })
        .await
        .err();
    let (p, r, v, i) = item("p", &bad, "red-reuso");
    let craft = c
        .craft_item(CraftItemRequest {
            player_id: p,
            request_id: r,
            catalog_version: v,
            item_id: i,
        })
        .await
        .err();
    let (p, r, v, i) = item("p", "r", &long);
    let equip = c
        .equip_item(EquipItemRequest {
            player_id: p,
            request_id: r,
            catalog_version: v,
            item_id: i,
        })
        .await
        .err();
    let appearance = c
        .set_appearance(SetAppearanceRequest {
            player_id: "p".into(),
            request_id: long.clone(),
            catalog_version: "online-v2".into(),
            skin_id: "light".into(),
            hair_color_id: "blue".into(),
        })
        .await
        .err();
    let exchange = c
        .exchange_materials(ExchangeMaterialsRequest {
            player_id: bad.clone(),
            request_id: "r".into(),
            catalog_version: "online-v2".into(),
            material: Material::Metal as i32,
            amount: 1,
        })
        .await
        .err();
    let profile = c
        .get_profile(GetProfileRequest {
            player_id: long.clone(),
        })
        .await
        .err();
    let catalog = c
        .get_catalog(GetCatalogRequest {
            catalog_version: bad.clone(),
        })
        .await
        .err();
    let settle = |race: &str, player: &str, plastic: u64, metal: u64| SettleRaceRequest {
        race_id: race.into(),
        player_id: player.into(),
        outcome: RaceOutcome::Finished as i32,
        credited_plastic: plastic,
        credited_metal: metal,
    };
    let settle_race_id = c.settle_race(settle(&long, "p", 0, 0)).await.err();
    let settle_player = c.settle_race(settle("race", &bad, 0, 0)).await.err();
    let settle_plastic = c
        .settle_race(settle("race", "p", 1_000_000_000, 0))
        .await
        .err();
    let settle_metal = c.settle_race(settle("race", "p", 0, u64::MAX)).await.err();
    for (name, status) in [
        ("BuyItem long player_id", buy),
        ("CraftItem control request_id", craft),
        ("EquipItem long item_id", equip),
        ("SetAppearance long request_id", appearance),
        ("ExchangeMaterials control player_id", exchange),
        ("GetProfile long player_id", profile),
        ("GetCatalog control catalog_version", catalog),
        ("SettleRace long race_id", settle_race_id),
        ("SettleRace control player_id", settle_player),
        ("SettleRace credited_plastic bound", settle_plastic),
        ("SettleRace credited_metal bound", settle_metal),
    ] {
        expect(name, status, Code::InvalidArgument);
    }
    let _ = stop.send(());
}
