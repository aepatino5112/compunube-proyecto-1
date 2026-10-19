//! Server wiring, health state and ordered shutdown through a real in-process
//! Tonic server and the standard gRPC health client. No PostgreSQL required.

use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};

use async_trait::async_trait;
use player_profile_service::{
    config::Config,
    health::{ProbeFailure, ReadinessProbe, HEALTH_SERVICE_NAME},
    pb::{player_profile_service_client::PlayerProfileServiceClient, GetProfileRequest},
    repository::{Closeable, Repositories},
    runtime::{build_dependencies, serve, Dependencies, RunError, RuntimeSettings},
};
use tokio::{net::TcpListener, sync::oneshot, task::JoinHandle};
use tonic::{transport::Channel, Code};
use tonic_health::pb::{
    health_check_response::ServingStatus, health_client::HealthClient, HealthCheckRequest,
};

const SETTINGS: RuntimeSettings = RuntimeSettings {
    probe_interval: Duration::from_millis(20),
    probe_timeout: Duration::from_millis(200),
    drain_timeout: Duration::from_millis(300),
};

#[derive(Clone)]
struct SwitchProbe {
    healthy: Arc<AtomicBool>,
}

#[async_trait]
impl ReadinessProbe for SwitchProbe {
    async fn check(&self) -> Result<(), ProbeFailure> {
        if self.healthy.load(Ordering::SeqCst) {
            Ok(())
        } else {
            Err(ProbeFailure::new("database unreachable"))
        }
    }
}

fn profile_request() -> GetProfileRequest {
    GetProfileRequest {
        player_id: "lifecycle-player".into(),
    }
}

struct ClosedFlag(Arc<AtomicBool>);

#[async_trait]
impl Closeable for ClosedFlag {
    async fn close(&self) {
        self.0.store(true, Ordering::SeqCst);
    }
}

struct Harness {
    channel: Channel,
    shutdown: oneshot::Sender<()>,
    server: JoinHandle<Result<(), RunError>>,
}

async fn start(dependencies: Dependencies) -> Harness {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let (shutdown, shutdown_rx) = oneshot::channel::<()>();
    let server = tokio::spawn(serve(listener, dependencies, SETTINGS, async {
        let _ = shutdown_rx.await;
    }));
    let channel = Channel::from_shared(format!("http://{addr}"))
        .unwrap()
        .connect()
        .await
        .unwrap();
    Harness {
        channel,
        shutdown,
        server,
    }
}

async fn status(channel: &Channel) -> ServingStatus {
    let mut client = HealthClient::new(channel.clone());
    let response = client
        .check(HealthCheckRequest {
            service: HEALTH_SERVICE_NAME.to_string(),
        })
        .await
        .unwrap();
    ServingStatus::try_from(response.into_inner().status).unwrap()
}

async fn wait_for(channel: &Channel, expected: ServingStatus) {
    for _ in 0..100 {
        if status(channel).await == expected {
            return;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    panic!("health never became {expected:?}");
}

fn dependencies(healthy: &Arc<AtomicBool>, closed: &Arc<AtomicBool>) -> Dependencies {
    Dependencies::new(
        Repositories::unavailable(),
        Arc::new(SwitchProbe {
            healthy: healthy.clone(),
        }),
        vec![Arc::new(ClosedFlag(closed.clone()))],
    )
}

#[tokio::test]
async fn health_follows_the_probe_and_recovers_automatically() {
    let healthy = Arc::new(AtomicBool::new(false));
    let closed = Arc::new(AtomicBool::new(false));
    let harness = start(dependencies(&healthy, &closed)).await;

    wait_for(&harness.channel, ServingStatus::NotServing).await;
    healthy.store(true, Ordering::SeqCst);
    wait_for(&harness.channel, ServingStatus::Serving).await;
    healthy.store(false, Ordering::SeqCst);
    wait_for(&harness.channel, ServingStatus::NotServing).await;
    healthy.store(true, Ordering::SeqCst);
    wait_for(&harness.channel, ServingStatus::Serving).await;

    // The empty service name mirrors the instance status for generic clients.
    let mut client = HealthClient::new(harness.channel.clone());
    let overall = client
        .check(HealthCheckRequest {
            service: String::new(),
        })
        .await
        .unwrap()
        .into_inner()
        .status;
    assert_eq!(
        ServingStatus::try_from(overall).unwrap(),
        ServingStatus::Serving
    );

    // Business RPCs are routed through the same server; with no usable store
    // a well-formed request is UNAVAILABLE.
    let mut business = PlayerProfileServiceClient::new(harness.channel.clone());
    let error = business.get_profile(profile_request()).await.unwrap_err();
    assert_eq!(error.code(), Code::Unavailable);

    drop(client);
    drop(business);
    let _ = harness.shutdown.send(());
    drop(harness.channel);
    harness.server.await.unwrap().unwrap();
    assert!(closed.load(Ordering::SeqCst), "pools must be closed");
}

#[tokio::test]
async fn shutdown_reports_not_serving_while_the_server_still_answers() {
    let healthy = Arc::new(AtomicBool::new(true));
    let closed = Arc::new(AtomicBool::new(false));
    let harness = start(dependencies(&healthy, &closed)).await;
    wait_for(&harness.channel, ServingStatus::Serving).await;

    let mut watcher = HealthClient::new(harness.channel.clone())
        .watch(HealthCheckRequest {
            service: HEALTH_SERVICE_NAME.to_string(),
        })
        .await
        .unwrap()
        .into_inner();
    let first = watcher.message().await.unwrap().unwrap();
    assert_eq!(
        ServingStatus::try_from(first.status).unwrap(),
        ServingStatus::Serving
    );

    let _ = harness.shutdown.send(());

    // NOT_SERVING is delivered by the live server: it was published before the
    // server stopped, and a probe that still succeeds cannot revert it.
    // (tonic-health may repeat the current value once before the update.)
    let observed = tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            let update = watcher.message().await.unwrap().unwrap();
            if ServingStatus::try_from(update.status).unwrap() == ServingStatus::NotServing {
                break;
            }
        }
    })
    .await;
    assert!(
        observed.is_ok(),
        "no NOT_SERVING update after shutdown signal"
    );

    // Probes keep succeeding for a while, but a drained controller must never
    // report SERVING again.
    let relapse = tokio::time::timeout(Duration::from_millis(150), async {
        while let Ok(Some(update)) = watcher.message().await {
            assert_eq!(
                ServingStatus::try_from(update.status).unwrap(),
                ServingStatus::NotServing
            );
        }
    })
    .await;
    assert!(relapse.is_err(), "the watch stream should stay open");

    // The open Watch stream is an in-flight RPC: the drain timeout bounds it.
    let result = tokio::time::timeout(Duration::from_secs(5), harness.server)
        .await
        .expect("shutdown must be bounded by the drain timeout")
        .unwrap();
    assert!(result.is_ok());
    assert!(closed.load(Ordering::SeqCst), "pools must be closed");
    drop(watcher);
}

#[tokio::test]
async fn missing_database_url_keeps_the_instance_alive_but_not_serving() {
    let config = Config::from_lookup(|_| None).unwrap();
    let harness = start(build_dependencies(&config)).await;

    for _ in 0..5 {
        assert_eq!(status(&harness.channel).await, ServingStatus::NotServing);
        tokio::time::sleep(Duration::from_millis(30)).await;
    }

    let mut business = PlayerProfileServiceClient::new(harness.channel.clone());
    assert_eq!(
        business
            .get_profile(profile_request())
            .await
            .unwrap_err()
            .code(),
        Code::Unavailable
    );

    drop(business);
    let _ = harness.shutdown.send(());
    drop(harness.channel);
    harness.server.await.unwrap().unwrap();
}
