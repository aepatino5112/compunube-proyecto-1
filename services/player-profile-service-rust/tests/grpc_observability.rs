//! RPC metrics and the per-request log line through the real Tonic stack, with
//! an unreachable store so no PostgreSQL is needed: every RPC outcome here is
//! either an argument error (decided before storage) or UNAVAILABLE. Business
//! outcomes (applied, replayed, conflict, settlement) are covered against a
//! real database in `observability_db.rs`.

use std::sync::Arc;

use player_profile_service::{
    application::PlayerProfileApp,
    metrics::Metrics,
    pb::{
        player_profile_service_client::PlayerProfileServiceClient, GetCatalogRequest,
        GetProfileRequest, SettleRaceRequest,
    },
    repository::Repositories,
    transport::grpc::PlayerProfileGrpc,
};
use tokio::{net::TcpListener, sync::oneshot};
use tokio_stream::wrappers::TcpListenerStream;
use tonic::{transport::Server, Code};

struct Harness {
    client: PlayerProfileServiceClient<tonic::transport::Channel>,
    metrics: Arc<Metrics>,
    stop: oneshot::Sender<()>,
}

async fn start(instance_id: &str) -> Harness {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let metrics = Arc::new(Metrics::new(instance_id));
    let app = Arc::new(PlayerProfileApp::new(Repositories::unavailable()));
    let grpc = PlayerProfileGrpc::with_metrics(app, metrics.clone());
    let (stop, stop_rx) = oneshot::channel::<()>();
    tokio::spawn(async move {
        Server::builder()
            .add_service(grpc.into_server())
            .serve_with_incoming_shutdown(TcpListenerStream::new(listener), async {
                let _ = stop_rx.await;
            })
            .await
            .unwrap();
    });
    let client = PlayerProfileServiceClient::connect(format!("http://{addr}"))
        .await
        .unwrap();
    Harness {
        client,
        metrics,
        stop,
    }
}

fn counter(text: &str, labels: &[&str]) -> f64 {
    text.lines()
        .find(|line| {
            line.starts_with("player_profile_rpc_requests_total{")
                && labels.iter().all(|label| line.contains(label))
        })
        .map(|line| line.rsplit(' ').next().unwrap().parse().unwrap())
        .unwrap_or(0.0)
}

#[tokio::test]
async fn rpc_errors_are_counted_with_the_closed_status_code() {
    let mut h = start("rust-obs-1").await;

    // Rejected before storage: INVALID_ARGUMENT.
    let status = h
        .client
        .get_profile(GetProfileRequest::default())
        .await
        .unwrap_err();
    assert_eq!(status.code(), Code::InvalidArgument);
    // Valid request, store unreachable: UNAVAILABLE.
    let status = h
        .client
        .get_profile(GetProfileRequest {
            player_id: "somebody".into(),
        })
        .await
        .unwrap_err();
    assert_eq!(status.code(), Code::Unavailable);
    let status = h
        .client
        .get_catalog(GetCatalogRequest::default())
        .await
        .unwrap_err();
    assert_eq!(status.code(), Code::Unavailable);
    // An undecodable enum is an argument error that never reaches the app.
    let status = h
        .client
        .settle_race(SettleRaceRequest {
            race_id: "r".into(),
            player_id: "p".into(),
            outcome: 99,
            ..Default::default()
        })
        .await
        .unwrap_err();
    assert_eq!(status.code(), Code::InvalidArgument);

    let text = h.metrics.render();
    let get_profile = [r#"rpc="GetProfile""#, r#"outcome="error""#];
    assert_eq!(
        counter(
            &text,
            &[get_profile[0], get_profile[1], r#"code="INVALID_ARGUMENT""#]
        ),
        1.0
    );
    assert_eq!(
        counter(
            &text,
            &[get_profile[0], get_profile[1], r#"code="UNAVAILABLE""#]
        ),
        1.0
    );
    assert_eq!(
        counter(
            &text,
            &[
                r#"rpc="GetCatalog""#,
                r#"outcome="error""#,
                r#"code="UNAVAILABLE""#
            ]
        ),
        1.0
    );
    assert_eq!(
        counter(
            &text,
            &[
                r#"rpc="SettleRace""#,
                r#"outcome="error""#,
                r#"code="INVALID_ARGUMENT""#
            ]
        ),
        1.0
    );
    // Nothing is in flight once every call has returned.
    for line in text
        .lines()
        .filter(|l| l.starts_with("player_profile_rpc_in_flight{"))
    {
        assert!(line.ends_with(" 0"), "{line}");
    }
    let count = text
        .lines()
        .find(|l| {
            l.starts_with("player_profile_rpc_duration_seconds_count{")
                && l.contains(r#"rpc="GetProfile""#)
        })
        .unwrap();
    assert!(count.ends_with(" 2"), "{count}");
    let _ = h.stop.send(());
}
