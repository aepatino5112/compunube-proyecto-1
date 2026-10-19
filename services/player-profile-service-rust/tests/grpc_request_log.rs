//! The per-request log line through the real Tonic stack, with an unreachable
//! store so no PostgreSQL is needed. Kept in its own test binary: it installs a
//! scoped subscriber, and tracing caches callsite interest process-wide, so a
//! sibling test hitting the same callsites without a subscriber could disable
//! them.

use std::{
    io::Write,
    sync::{Arc, Mutex},
};

use player_profile_service::{
    application::PlayerProfileApp,
    logging,
    metrics::Metrics,
    pb::{player_profile_service_client::PlayerProfileServiceClient, BuyItemRequest},
    repository::Repositories,
    transport::grpc::PlayerProfileGrpc,
};
use tokio::{net::TcpListener, sync::oneshot};
use tokio_stream::wrappers::TcpListenerStream;
use tonic::transport::Server;
use tracing_subscriber::fmt::writer::MakeWriter;

const SECRET: &str = "s3cr3t-passw0rd";

#[derive(Clone, Default)]
struct Buffer(Arc<Mutex<Vec<u8>>>);

impl Write for Buffer {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.0.lock().unwrap().extend_from_slice(buf);
        Ok(buf.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

impl<'a> MakeWriter<'a> for Buffer {
    type Writer = Buffer;
    fn make_writer(&'a self) -> Self::Writer {
        self.clone()
    }
}

impl Buffer {
    fn lines(&self) -> Vec<serde_json::Value> {
        String::from_utf8(self.0.lock().unwrap().clone())
            .unwrap()
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect()
    }
}

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

#[tokio::test]
async fn request_log_has_identity_outcome_and_latency_but_no_secrets_or_ids() {
    let buffer = Buffer::default();
    let _guard = tracing::subscriber::set_default(logging::build_subscriber(buffer.clone()));
    let mut h = start("rust-obs-2").await;

    let player = format!("player-{SECRET}");
    let _ = h
        .client
        .buy_item(BuyItemRequest {
            player_id: player.clone(),
            request_id: format!("req-{SECRET}"),
            catalog_version: "online-v1".into(),
            item_id: "kart".into(),
        })
        .await;
    let _ = h.client.buy_item(BuyItemRequest::default()).await;
    let _ = h.stop.send(());

    let lines = buffer.lines();
    let rpc_lines: Vec<_> = lines
        .iter()
        .filter(|line| line["message"] == "rpc completed")
        .collect();
    assert_eq!(rpc_lines.len(), 2, "{lines:?}");
    let unavailable = rpc_lines
        .iter()
        .find(|line| line["code"] == "UNAVAILABLE")
        .expect("UNAVAILABLE request line");
    assert_eq!(unavailable["service"], "player-profile-service");
    assert_eq!(unavailable["instance_id"], "rust-obs-2");
    assert_eq!(unavailable["rpc"], "BuyItem");
    assert_eq!(unavailable["outcome"], "error");
    assert_eq!(unavailable["error_class"], "server");
    assert!(unavailable["latency_ms"].as_f64().unwrap() >= 0.0);
    assert_eq!(unavailable["level"], "WARN");
    let invalid = rpc_lines
        .iter()
        .find(|line| line["code"] == "INVALID_ARGUMENT")
        .expect("INVALID_ARGUMENT request line");
    assert_eq!(invalid["error_class"], "client");

    // Neither the ids sent by the client nor anything secret is logged.
    let everything = serde_json::to_string(&lines).unwrap();
    assert!(!everything.contains(SECRET), "{everything}");
    assert!(!everything.contains("online-v1"), "{everything}");
    assert!(!everything.contains("postgres://"), "{everything}");
    let metrics_text = h.metrics.render();
    assert!(!metrics_text.contains(SECRET));
}
