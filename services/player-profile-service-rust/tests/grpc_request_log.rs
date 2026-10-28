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
            catalog_version: "online-v2".into(),
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
    assert!(!everything.contains("online-v2"), "{everything}");
    assert!(!everything.contains("postgres://"), "{everything}");
    let metrics_text = h.metrics.render();
    assert!(!metrics_text.contains(SECRET));
}

// ---- correlation id (H67-Final, I71-R2) -------------------------------------
//
// Go sends `x-correlation-id` as gRPC metadata. Rust logs it verbatim in the
// `rpc completed` line when it is 1..=64 ASCII alphanumerics, `-` or `_`, and
// logs the empty string otherwise, without ever echoing the rejected input. It
// never reaches a Prometheus label and never replaces the business requestId.
// These tests go through the real Tonic stack (client -> server -> observer).

use std::collections::BTreeSet;

use tonic::metadata::{Ascii, MetadataValue};

const HEADER: &str = "x-correlation-id";
const PLAYER: &str = "player-corr-7731";
const BUSINESS_REQUEST: &str = "business-req-9142";
const TOKEN: &str = "bearer-tok-5521";

/// A well-formed purchase (the unavailable store answers `UNAVAILABLE`), with
/// the correlation header exactly as given, or without it for `None`.
async fn buy(h: &mut Harness, correlation: Option<&[u8]>) {
    let mut request = tonic::Request::new(BuyItemRequest {
        player_id: PLAYER.into(),
        request_id: BUSINESS_REQUEST.into(),
        catalog_version: "online-v2".into(),
        item_id: "manglar".into(),
    });
    if let Some(bytes) = correlation {
        let value: MetadataValue<Ascii> = MetadataValue::try_from(bytes).unwrap();
        request.metadata_mut().insert(HEADER, value);
    }
    let _ = h.client.buy_item(request).await;
}

fn rpc_completed(buffer: &Buffer) -> Vec<serde_json::Value> {
    buffer
        .lines()
        .into_iter()
        .filter(|line| line["message"] == "rpc completed")
        .collect()
}

/// `correlation_id` of every `rpc completed` line, in emission order.
fn correlation_ids(buffer: &Buffer) -> Vec<String> {
    rpc_completed(buffer)
        .iter()
        .map(|line| {
            line["correlation_id"]
                .as_str()
                .unwrap_or_else(|| panic!("correlation_id must be a string: {line}"))
                .to_owned()
        })
        .collect()
}

#[tokio::test]
async fn a_valid_correlation_id_is_logged_exactly() {
    let buffer = Buffer::default();
    let _guard = tracing::subscriber::set_default(logging::build_subscriber(buffer.clone()));
    let mut h = start("rust-corr-1").await;

    let longest = "a1-_".repeat(16);
    assert_eq!(longest.len(), 64, "the documented maximum");
    let valid = [
        "client-ABC_123",
        "a",
        "0",
        "___",
        "---",
        "7f9c2ba4-e88f-4f6a-9d1b-0123456789ab",
        longest.as_str(),
    ];
    for id in valid {
        buy(&mut h, Some(id.as_bytes())).await;
    }
    // the same request without any correlation id does not inherit the last one
    buy(&mut h, None).await;
    let _ = h.stop.send(());

    let mut expected: Vec<&str> = valid.to_vec();
    expected.push("");
    assert_eq!(correlation_ids(&buffer), expected);
    for line in rpc_completed(&buffer) {
        assert_eq!(line["rpc"], "BuyItem");
        assert_eq!(
            line["code"], "UNAVAILABLE",
            "the id never changes the outcome"
        );
    }
}

#[tokio::test]
async fn a_missing_or_empty_correlation_id_logs_the_empty_string() {
    let buffer = Buffer::default();
    let _guard = tracing::subscriber::set_default(logging::build_subscriber(buffer.clone()));
    let mut h = start("rust-corr-2").await;

    buy(&mut h, None).await;
    buy(&mut h, Some(b"")).await;
    // an unrelated RPC without the header behaves the same
    let _ = h.client.buy_item(BuyItemRequest::default()).await;
    let _ = h.stop.send(());

    let lines = rpc_completed(&buffer);
    assert_eq!(lines.len(), 3, "{lines:?}");
    for line in &lines {
        // present as an empty string: no null, no placeholder, no generated id
        assert_eq!(line["correlation_id"], "", "{line}");
    }
}

#[tokio::test]
async fn invalid_or_overlong_correlation_ids_are_dropped_not_reflected() {
    let buffer = Buffer::default();
    let _guard = tracing::subscriber::set_default(logging::build_subscriber(buffer.clone()));
    let mut h = start("rust-corr-3").await;

    let overlong = "L".repeat(65);
    let way_overlong = "W".repeat(4096);
    let rejected: Vec<(&str, Vec<u8>)> = vec![
        ("path separator", b"unsafe/path".to_vec()),
        ("space", b"has space".to_vec()),
        ("leading space", b" lead".to_vec()),
        ("semicolon", b"id;DROP-TABLE".to_vec()),
        ("markup", b"<script>alert(1)</script>".to_vec()),
        ("json", br#"{"k":"v"}"#.to_vec()),
        ("quote", br#"a"b"#.to_vec()),
        ("backslash", b"a\\b".to_vec()),
        ("dot", b"a.b".to_vec()),
        ("colon", b"a:b".to_vec()),
        ("percent", b"%0d%0a".to_vec()),
        ("non-ascii", "caf\u{e9}-id".as_bytes().to_vec()),
        ("high byte", vec![b'o', b'k', 0xff]),
        ("65 characters", overlong.clone().into_bytes()),
        ("4096 characters", way_overlong.clone().into_bytes()),
    ];
    for (_, value) in &rejected {
        buy(&mut h, Some(value)).await;
    }
    let _ = h.stop.send(());

    let ids = correlation_ids(&buffer);
    assert_eq!(ids.len(), rejected.len());
    for ((why, _), id) in rejected.iter().zip(&ids) {
        assert_eq!(id, "", "{why} must log the empty string");
    }

    // nothing of the rejected values leaks anywhere in the log, not even as a
    // truncated prefix of the overlong ones
    let everything = serde_json::to_string(&buffer.lines()).unwrap();
    for needle in [
        "unsafe/path",
        "has space",
        "DROP-TABLE",
        "script",
        "alert",
        "caf",
        "%0d",
        &overlong[..64],
        &way_overlong[..64],
    ] {
        assert!(
            !everything.contains(needle),
            "{needle} leaked: {everything}"
        );
    }
}

#[tokio::test]
async fn request_logs_carry_only_the_documented_fields_and_no_business_data() {
    let buffer = Buffer::default();
    let _guard = tracing::subscriber::set_default(logging::build_subscriber(buffer.clone()));
    let mut h = start("rust-corr-4").await;

    let mut request = tonic::Request::new(BuyItemRequest {
        player_id: PLAYER.into(),
        request_id: BUSINESS_REQUEST.into(),
        catalog_version: "online-v2".into(),
        item_id: "manglar".into(),
    });
    let metadata = request.metadata_mut();
    metadata.insert(HEADER, "corr-4821".parse().unwrap());
    metadata.insert("authorization", format!("Bearer {TOKEN}").parse().unwrap());
    metadata.insert("cookie", format!("session={TOKEN}").parse().unwrap());
    metadata.insert("x-request-id", BUSINESS_REQUEST.parse().unwrap());
    let _ = h.client.buy_item(request).await;
    let _ = h.stop.send(());

    let lines = rpc_completed(&buffer);
    assert_eq!(lines.len(), 1, "{lines:?}");
    let line = &lines[0];
    assert_eq!(line["correlation_id"], "corr-4821");

    // every top-level key of the line is on the documented list: a new field
    // (player id, request id, payload, token, DSN...) has to be added here on
    // purpose
    let keys: BTreeSet<&str> = line
        .as_object()
        .expect("a JSON object")
        .keys()
        .map(String::as_str)
        .collect();
    let documented: BTreeSet<&str> = [
        "code",
        "correlation_id",
        "error_class",
        "instance_id",
        "latency_ms",
        "level",
        "message",
        "outcome",
        "rpc",
        "service",
        "target",
        "timestamp",
    ]
    .into_iter()
    .collect();
    assert_eq!(keys, documented, "{line}");

    // and no value anywhere in the log (parsed, not grepped line by line)
    let everything = serde_json::to_string(&buffer.lines()).unwrap();
    for secret in [
        PLAYER,
        BUSINESS_REQUEST,
        TOKEN,
        "manglar",
        "online-v2",
        "postgres://",
    ] {
        assert!(
            !everything.contains(secret),
            "{secret} leaked: {everything}"
        );
    }
    // the correlation id and the business request id are different things
    assert_ne!(line["correlation_id"], BUSINESS_REQUEST);
}

/// Series identities (`name{labels}`) without their values.
fn series(exposition: &str) -> BTreeSet<String> {
    exposition
        .lines()
        .filter(|line| !line.starts_with('#') && !line.trim().is_empty())
        .map(|line| {
            line.rsplit_once(' ')
                .map_or(line, |(name, _)| name)
                .to_owned()
        })
        .collect()
}

/// Every label name used by a series of the exposition.
fn label_names(exposition: &str) -> BTreeSet<String> {
    series(exposition)
        .iter()
        .filter_map(|series| series.split_once('{'))
        .flat_map(|(_, labels)| {
            labels
                .trim_end_matches('}')
                .split("\",")
                .filter_map(|pair| pair.split_once('=').map(|(name, _)| name.to_owned()))
                .collect::<Vec<_>>()
        })
        .collect()
}

#[tokio::test]
async fn the_correlation_id_is_never_a_prometheus_label_nor_adds_series() {
    let buffer = Buffer::default();
    let _guard = tracing::subscriber::set_default(logging::build_subscriber(buffer.clone()));
    let mut h = start("rust-corr-5").await;

    buy(&mut h, None).await;
    let baseline = h.metrics.render();
    let baseline_series = series(&baseline);
    assert!(
        baseline_series
            .iter()
            .any(|s| s.starts_with("player_profile_rpc_requests_total{")),
        "{baseline}"
    );

    // many distinct (valid and invalid) ids: no new series, no label, no value
    for n in 0..25 {
        buy(&mut h, Some(format!("unique-corr-{n}").as_bytes())).await;
    }
    buy(&mut h, Some(b"bad/unique-corr")).await;
    let _ = h.stop.send(());

    let after = h.metrics.render();
    assert_eq!(series(&after), baseline_series, "cardinality must not grow");
    assert!(!after.contains("unique-corr"), "{after}");
    let labels = label_names(&after);
    assert!(
        labels.contains("instance_id") && labels.contains("rpc"),
        "the parser must see the real labels: {labels:?}"
    );
    for label in &labels {
        assert!(
            !label.contains("correlation") && !label.contains("request_id"),
            "{label} must not be a label: {labels:?}"
        );
    }
    assert!(!after.contains("correlation"), "{after}");
}
