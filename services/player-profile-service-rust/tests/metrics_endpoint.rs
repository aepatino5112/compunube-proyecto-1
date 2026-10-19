//! The metrics listener through the real runtime wiring: separate port,
//! Prometheus text, no database needed, and it stops with the service. No
//! PostgreSQL required.

use std::{sync::Arc, time::Duration};

use player_profile_service::{
    health::UnconfiguredProbe,
    metrics::Metrics,
    repository::Repositories,
    runtime::{serve, Dependencies, RuntimeSettings},
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    sync::oneshot,
};

const SETTINGS: RuntimeSettings = RuntimeSettings {
    probe_interval: Duration::from_millis(20),
    probe_timeout: Duration::from_millis(200),
    drain_timeout: Duration::from_millis(300),
};

async fn scrape(addr: std::net::SocketAddr) -> String {
    let mut stream = TcpStream::connect(addr).await.unwrap();
    stream
        .write_all(b"GET /metrics HTTP/1.1\r\nHost: test\r\n\r\n")
        .await
        .unwrap();
    let mut out = Vec::new();
    stream.read_to_end(&mut out).await.unwrap();
    String::from_utf8(out).unwrap()
}

#[tokio::test]
async fn metrics_are_scrapable_without_a_database_and_stop_with_the_service() {
    let grpc = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let grpc_addr = grpc.local_addr().unwrap();
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    assert_ne!(addr.port(), grpc_addr.port());

    // The probe always fails (no database): the endpoint must still answer.
    let dependencies = Dependencies::new(
        Repositories::unavailable(),
        Arc::new(UnconfiguredProbe::new("DATABASE_URL is not configured")),
        Vec::new(),
    )
    .with_metrics(Arc::new(Metrics::new("rust-scrape")))
    .with_metrics_listener(listener);
    let (stop, stop_rx) = oneshot::channel::<()>();
    let server = tokio::spawn(serve(grpc, dependencies, SETTINGS, async {
        let _ = stop_rx.await;
    }));

    let body = scrape(addr).await;
    assert!(body.starts_with("HTTP/1.1 200 OK\r\n"), "{body}");
    assert!(body.contains(r#"instance_id="rust-scrape""#), "{body}");
    assert!(
        body.contains(r#"service="player-profile-service""#),
        "{body}"
    );

    // The gRPC port does not speak HTTP/1 metrics.
    let wrong = {
        let mut stream = TcpStream::connect(grpc_addr).await.unwrap();
        stream
            .write_all(b"GET /metrics HTTP/1.1\r\nHost: test\r\n\r\n")
            .await
            .unwrap();
        let mut out = Vec::new();
        let _ = stream.read_to_end(&mut out).await;
        String::from_utf8_lossy(&out).into_owned()
    };
    assert!(!wrong.contains("player_profile_up"), "{wrong}");

    let _ = stop.send(());
    server.await.unwrap().unwrap();
    assert!(
        TcpStream::connect(addr).await.is_err(),
        "metrics listener must stop with the service"
    );
}
