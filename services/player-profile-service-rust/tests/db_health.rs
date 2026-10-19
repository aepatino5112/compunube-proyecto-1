//! Readiness against a real PostgreSQL (F52-T7): the probe needs the economy
//! migration, and the instance follows the database down and back up. Needs a
//! migrated database, see `tests/common/mod.rs`.

mod common;

use std::{sync::Arc, time::Duration};

use common::Proxy;
use player_profile_service::{
    config::PoolConfig,
    health::{ReadinessProbe, HEALTH_SERVICE_NAME},
    metrics::Metrics,
    pb::{player_profile_service_client::PlayerProfileServiceClient, GetProfileRequest},
    repository::postgres::{self, PostgresReadinessProbe},
    runtime::{serve, Dependencies, RuntimeSettings},
};
use tokio::{net::TcpListener, sync::oneshot};
use tonic::{transport::Channel, Code};
use tonic_health::pb::{
    health_check_response::ServingStatus, health_client::HealthClient, HealthCheckRequest,
};

const SETTINGS: RuntimeSettings = RuntimeSettings {
    probe_interval: Duration::from_millis(25),
    probe_timeout: Duration::from_millis(400),
    drain_timeout: Duration::from_millis(500),
};

fn sample(metrics: &Metrics, name: &str) -> f64 {
    metrics
        .render()
        .lines()
        .find(|line| line.starts_with(name) && !line.starts_with('#'))
        .and_then(|line| line.rsplit(' ').next())
        .and_then(|value| value.parse().ok())
        .unwrap_or_else(|| panic!("series {name} missing"))
}

fn health_gauge(metrics: &Metrics) -> f64 {
    sample(metrics, "player_profile_health_serving")
}

fn probe_failures(metrics: &Metrics) -> f64 {
    sample(metrics, "player_profile_health_probe_failures_total")
}

#[tokio::test]
async fn the_probe_passes_on_a_migrated_database_and_demands_the_economy_migration() {
    let Some(url) = common::database_url("the_probe_passes_on_a_migrated_database") else {
        return;
    };
    let options = postgres::connect_options(
        &player_profile_service::config::SecretString::new(url),
        "probe-test",
    )
    .unwrap();
    let pool = postgres::probe_pool(&options, Duration::from_secs(2));
    assert_eq!(
        PostgresReadinessProbe::new(pool.clone()).check().await,
        Ok(())
    );

    let failure = PostgresReadinessProbe::with_required_migration(pool, "9999")
        .check()
        .await
        .unwrap_err();
    assert!(
        failure
            .reason
            .contains("migration 9999 has not been applied"),
        "{}",
        failure.reason
    );
}

async fn status(channel: &Channel) -> ServingStatus {
    let response = HealthClient::new(channel.clone())
        .check(HealthCheckRequest {
            service: HEALTH_SERVICE_NAME.to_string(),
        })
        .await
        .unwrap();
    ServingStatus::try_from(response.into_inner().status).unwrap()
}

async fn wait_for(channel: &Channel, expected: ServingStatus) {
    for _ in 0..200 {
        if status(channel).await == expected {
            return;
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    panic!(
        "health never became {expected:?}, last {:?}",
        status(channel).await
    );
}

#[tokio::test]
async fn health_follows_the_database_down_and_back_up_without_a_restart() {
    let Some(url) = common::database_url("health_follows_the_database_down_and_back_up") else {
        return;
    };
    let proxy = Proxy::start(common::upstream_of(&url)).await;
    let options = common::options_through(&url, &proxy);
    let pool_config = PoolConfig {
        max_connections: 4,
        min_connections: 0,
        acquire_timeout: Duration::from_millis(500),
    };
    let business = postgres::business_pool(&options, &pool_config);
    let probe = postgres::probe_pool(&options, SETTINGS.probe_timeout);
    let metrics = Arc::new(Metrics::new("rust-health"));
    let dependencies = Dependencies::new(
        postgres::repositories(business.clone()),
        Arc::new(PostgresReadinessProbe::new(probe.clone())),
        Vec::new(),
    )
    .with_metrics(metrics.clone());

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let (stop, stop_rx) = oneshot::channel::<()>();
    let server = tokio::spawn(serve(listener, dependencies, SETTINGS, async {
        let _ = stop_rx.await;
    }));
    let channel = Channel::from_shared(format!("http://{addr}"))
        .unwrap()
        .connect()
        .await
        .unwrap();
    let mut api = PlayerProfileServiceClient::new(channel.clone());
    let request = GetProfileRequest {
        player_id: common::unique("health"),
    };

    wait_for(&channel, ServingStatus::Serving).await;
    assert_eq!(health_gauge(&metrics), 1.0);
    let before = api.get_profile(request.clone()).await.unwrap().into_inner();

    // The database disappears: NOT_SERVING and business RPCs fail as UNAVAILABLE.
    proxy.block();
    wait_for(&channel, ServingStatus::NotServing).await;
    assert_eq!(health_gauge(&metrics), 0.0);
    assert!(probe_failures(&metrics) >= 1.0);
    let error = api.get_profile(request.clone()).await.unwrap_err();
    assert_eq!(error.code(), Code::Unavailable);
    assert_eq!(error.message(), "service temporarily unavailable");

    // It comes back: SERVING again by itself, with the same durable state.
    proxy.allow();
    wait_for(&channel, ServingStatus::Serving).await;
    assert_eq!(health_gauge(&metrics), 1.0);
    let after = api.get_profile(request).await.unwrap().into_inner();
    assert_eq!(after, before);

    drop(api);
    let _ = stop.send(());
    drop(channel);
    server.await.unwrap().unwrap();
    business.close().await;
    probe.close().await;
}

#[tokio::test]
async fn an_unapplied_migration_keeps_the_real_instance_not_serving_while_a_migrated_one_serves() {
    let Some(url) =
        common::database_url("an_unapplied_migration_keeps_the_real_instance_not_serving")
    else {
        return;
    };
    let options = postgres::connect_options(
        &player_profile_service::config::SecretString::new(url.clone()),
        "migration-gate",
    )
    .unwrap();

    // Two instances over the same database; only the migration they demand
    // differs. `9999` is a version this database will never have.
    let mut running = Vec::new();
    for required in ["0002", "9999"] {
        let probe_pool = postgres::probe_pool(&options, SETTINGS.probe_timeout);
        let metrics = Arc::new(Metrics::new("rust-migration-gate"));
        let dependencies = Dependencies::new(
            postgres::repositories(common::test_pool(&url, 2).await),
            Arc::new(PostgresReadinessProbe::with_required_migration(
                probe_pool.clone(),
                required,
            )),
            Vec::new(),
        )
        .with_metrics(metrics.clone());
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let (stop, stop_rx) = oneshot::channel::<()>();
        let server = tokio::spawn(serve(listener, dependencies, SETTINGS, async {
            let _ = stop_rx.await;
        }));
        let channel = Channel::from_shared(format!("http://{addr}"))
            .unwrap()
            .connect()
            .await
            .unwrap();
        running.push((required, channel, metrics, stop, server, probe_pool));
    }

    let (_, migrated, migrated_metrics, ..) = &running[0];
    wait_for(migrated, ServingStatus::Serving).await;
    assert_eq!(health_gauge(migrated_metrics), 1.0);

    // Wait until the gate has been evaluated repeatedly (counted failures, not
    // elapsed time), then check that it never reported SERVING in between.
    let (_, gated, gated_metrics, ..) = &running[1];
    for _ in 0..200 {
        if probe_failures(gated_metrics) >= 3.0 {
            break;
        }
        assert_eq!(status(gated).await, ServingStatus::NotServing);
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    assert!(probe_failures(gated_metrics) >= 3.0, "the probe never ran");
    assert_eq!(status(gated).await, ServingStatus::NotServing);
    assert_eq!(health_gauge(gated_metrics), 0.0);

    for (_, channel, _, stop, server, probe_pool) in running {
        let _ = stop.send(());
        drop(channel);
        server.await.unwrap().unwrap();
        probe_pool.close().await;
    }
}
