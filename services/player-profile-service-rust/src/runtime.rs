//! Process wiring and lifecycle.
//!
//! Startup never depends on PostgreSQL: pools are lazy and the health service
//! begins `NOT_SERVING` until the probe loop succeeds (F47 D3/D4).
//!
//! Shutdown (SIGTERM or SIGINT) is ordered, see [`ordered_shutdown`]:
//! 1. report `NOT_SERVING` (and stop probing so it cannot flip back);
//! 2. stop accepting new connections and RPCs;
//! 3. let in-flight RPCs drain, bounded by `SHUTDOWN_DRAIN_TIMEOUT_MS`;
//! 4. close the database pools, then stop the metrics listener so the drain
//!    itself stays observable.

use std::{fmt, future::Future, sync::Arc, time::Duration};

use async_trait::async_trait;
use tokio::{
    net::TcpListener,
    sync::{oneshot, watch},
    task::JoinHandle,
};
use tokio_stream::wrappers::TcpListenerStream;
use tonic::transport::Server;
use tracing::Instrument;

use crate::{
    application::PlayerProfileApp,
    config::Config,
    health::{run_probe_loop, GrpcHealthSink, HealthController, ReadinessProbe, UnconfiguredProbe},
    metrics::{self, Metrics},
    repository::{postgres, Closeable, Repositories},
    transport::grpc::PlayerProfileGrpc,
};

#[derive(Debug)]
pub enum RunError {
    Bind(std::io::Error),
    BindMetrics(std::io::Error),
    Serve(String),
}

impl fmt::Display for RunError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Bind(error) => write!(f, "cannot bind service address: {error}"),
            Self::BindMetrics(error) => write!(f, "cannot bind metrics address: {error}"),
            Self::Serve(error) => write!(f, "gRPC server failed: {error}"),
        }
    }
}

impl std::error::Error for RunError {}

/// Everything `serve` needs from the outside world.
pub struct Dependencies {
    pub repositories: Repositories,
    pub probe: Arc<dyn ReadinessProbe>,
    pub resources: Vec<Arc<dyn Closeable>>,
    /// Registry shared by every component that reports metrics.
    pub metrics: Arc<Metrics>,
    /// When present, `GET /metrics` is served on it until shutdown.
    pub metrics_listener: Option<TcpListener>,
}

impl Dependencies {
    /// Dependencies with a detached metrics registry and no metrics listener,
    /// which is what tests and tools that do not scrape need.
    pub fn new(
        repositories: Repositories,
        probe: Arc<dyn ReadinessProbe>,
        resources: Vec<Arc<dyn Closeable>>,
    ) -> Self {
        Self {
            repositories,
            probe,
            resources,
            metrics: Arc::new(Metrics::new(crate::config::DEFAULT_INSTANCE_ID)),
            metrics_listener: None,
        }
    }

    pub fn with_metrics(mut self, metrics: Arc<Metrics>) -> Self {
        self.metrics = metrics;
        self
    }

    pub fn with_metrics_listener(mut self, listener: TcpListener) -> Self {
        self.metrics_listener = Some(listener);
        self
    }
}

#[derive(Debug, Clone, Copy)]
pub struct RuntimeSettings {
    pub probe_interval: Duration,
    pub probe_timeout: Duration,
    pub drain_timeout: Duration,
}

impl RuntimeSettings {
    pub fn from_config(config: &Config) -> Self {
        Self {
            probe_interval: config.health.probe_interval,
            probe_timeout: config.health.probe_timeout,
            drain_timeout: config.shutdown.drain_timeout,
        }
    }
}

/// Builds repositories, probe and resources from the configuration. A missing
/// or invalid `DATABASE_URL` yields a running but permanently `NOT_SERVING`
/// instance (D4); the reason is logged without the URL.
pub fn build_dependencies(config: &Config) -> Dependencies {
    let metrics = Arc::new(Metrics::new(&config.instance_id));
    let Some(url) = &config.database.url else {
        tracing::warn!("DATABASE_URL is not set; the instance will stay NOT_SERVING");
        return unconfigured("DATABASE_URL is not configured").with_metrics(metrics);
    };
    match postgres::connect(
        url,
        &config.instance_id,
        &config.database.pool,
        config.health.probe_timeout,
    ) {
        Ok(runtime) => {
            metrics.set_pool_source(Arc::new(runtime.pool_stats));
            Dependencies::new(
                runtime.repositories,
                Arc::new(runtime.probe),
                vec![Arc::new(runtime.resources)],
            )
            .with_metrics(metrics)
        }
        Err(error) => {
            tracing::error!(%error, "the instance will stay NOT_SERVING");
            unconfigured("DATABASE_URL is invalid").with_metrics(metrics)
        }
    }
}

fn unconfigured(reason: &str) -> Dependencies {
    Dependencies::new(
        Repositories::unavailable(),
        Arc::new(UnconfiguredProbe::new(reason)),
        Vec::new(),
    )
}

/// Binds the gRPC and metrics addresses and serves until SIGTERM or SIGINT.
/// A metrics address that cannot be bound is a startup error: an instance that
/// silently runs unobserved is worse than one that refuses to start.
pub async fn run(config: Config) -> Result<(), RunError> {
    let listener = TcpListener::bind(config.service_addr)
        .await
        .map_err(RunError::Bind)?;
    let metrics_listener = TcpListener::bind(config.metrics_addr)
        .await
        .map_err(RunError::BindMetrics)?;
    let dependencies = build_dependencies(&config).with_metrics_listener(metrics_listener);
    serve(
        listener,
        dependencies,
        RuntimeSettings::from_config(&config),
        wait_for_termination_signal(),
    )
    .await
}

/// Steps of a graceful stop, in the only order they may run.
#[async_trait]
pub trait ShutdownSteps: Send {
    async fn mark_not_serving(&mut self);
    async fn stop_accepting(&mut self);
    async fn drain(&mut self);
    async fn close_resources(&mut self);
}

pub async fn ordered_shutdown<S: ShutdownSteps>(steps: &mut S) {
    steps.mark_not_serving().await;
    steps.stop_accepting().await;
    steps.drain().await;
    steps.close_resources().await;
}

type ServerTask = JoinHandle<Result<(), tonic::transport::Error>>;

struct RuntimeShutdown {
    controller: Arc<HealthController>,
    probe_stop: watch::Sender<bool>,
    probe_task: Option<JoinHandle<()>>,
    server_stop: Option<oneshot::Sender<()>>,
    server_task: Option<ServerTask>,
    metrics_stop: Option<oneshot::Sender<()>>,
    metrics_task: Option<JoinHandle<()>>,
    server_result: Option<Result<(), RunError>>,
    drain_timeout: Duration,
    resources: Vec<Arc<dyn Closeable>>,
}

#[async_trait]
impl ShutdownSteps for RuntimeShutdown {
    async fn mark_not_serving(&mut self) {
        // Order matters: drain the controller so a probe finishing right now
        // cannot restore SERVING, then stop the loop.
        self.controller.begin_shutdown().await;
        let _ = self.probe_stop.send(true);
    }

    async fn stop_accepting(&mut self) {
        tracing::info!("stop accepting new connections");
        if let Some(stop) = self.server_stop.take() {
            let _ = stop.send(());
        }
    }

    async fn drain(&mut self) {
        let Some(task) = self.server_task.take() else {
            return;
        };
        let abort = task.abort_handle();
        let result = match tokio::time::timeout(self.drain_timeout, task).await {
            Ok(Ok(Ok(()))) => Ok(()),
            Ok(Ok(Err(error))) => Err(RunError::Serve(error.to_string())),
            Ok(Err(join_error)) => Err(RunError::Serve(join_error.to_string())),
            Err(_) => {
                tracing::warn!(
                    timeout_ms = self.drain_timeout.as_millis() as u64,
                    "drain timeout elapsed; cancelling remaining in-flight RPCs"
                );
                abort.abort();
                Ok(())
            }
        };
        self.server_result = Some(result);
    }

    async fn close_resources(&mut self) {
        if let Some(task) = self.probe_task.take() {
            let _ = task.await;
        }
        for resource in &self.resources {
            resource.close().await;
        }
        if let Some(stop) = self.metrics_stop.take() {
            let _ = stop.send(());
        }
        if let Some(task) = self.metrics_task.take() {
            let _ = task.await;
        }
        tracing::info!("resources closed; shutdown complete");
    }
}

/// Runs the gRPC server on `listener` until `shutdown` resolves (or the server
/// fails), then performs [`ordered_shutdown`].
pub async fn serve<S>(
    listener: TcpListener,
    dependencies: Dependencies,
    settings: RuntimeSettings,
    shutdown: S,
) -> Result<(), RunError>
where
    S: Future<Output = ()>,
{
    let span = tracing::Span::current();
    let (reporter, health_service) = tonic_health::server::health_reporter();
    let controller = Arc::new(
        HealthController::start_with_metrics(
            Arc::new(GrpcHealthSink::new(reporter)),
            dependencies.metrics.clone(),
        )
        .await,
    );

    let (probe_stop, probe_stop_rx) = watch::channel(false);
    let probe_task = tokio::spawn(
        run_probe_loop(
            dependencies.probe,
            controller.clone(),
            settings.probe_interval,
            settings.probe_timeout,
            probe_stop_rx,
        )
        .instrument(span.clone()),
    );

    let app = Arc::new(PlayerProfileApp::with_observer(
        dependencies.repositories,
        dependencies.metrics.clone(),
    ));
    let (metrics_stop, metrics_task) = match dependencies.metrics_listener {
        Some(metrics_listener) => {
            let metrics_addr = metrics_listener
                .local_addr()
                .map_err(RunError::BindMetrics)?;
            let (stop, stop_rx) = oneshot::channel::<()>();
            let task = tokio::spawn(
                metrics::server::serve(metrics_listener, dependencies.metrics.clone(), async {
                    let _ = stop_rx.await;
                })
                .instrument(span.clone()),
            );
            tracing::info!(listen_addr = %metrics_addr, path = "/metrics", "metrics listener started");
            (Some(stop), Some(task))
        }
        None => (None, None),
    };
    let local_addr = listener.local_addr().map_err(RunError::Bind)?;
    let (server_stop, server_stop_rx) = oneshot::channel::<()>();
    let mut server_task: ServerTask = tokio::spawn(
        Server::builder()
            .add_service(health_service)
            .add_service(
                PlayerProfileGrpc::with_metrics(app, dependencies.metrics.clone()).into_server(),
            )
            .serve_with_incoming_shutdown(TcpListenerStream::new(listener), async {
                let _ = server_stop_rx.await;
            })
            .instrument(span),
    );
    tracing::info!(listen_addr = %local_addr, "player/profile gRPC server listening");

    let mut early_failure = None;
    tokio::select! {
        () = shutdown => {}
        result = &mut server_task => {
            early_failure = Some(match result {
                Ok(Ok(())) => RunError::Serve("server stopped unexpectedly".to_string()),
                Ok(Err(error)) => RunError::Serve(error.to_string()),
                Err(join_error) => RunError::Serve(join_error.to_string()),
            });
        }
    }

    let mut steps = RuntimeShutdown {
        controller,
        probe_stop,
        probe_task: Some(probe_task),
        server_stop: Some(server_stop),
        server_task: if early_failure.is_some() {
            None
        } else {
            Some(server_task)
        },
        metrics_stop,
        metrics_task,
        server_result: None,
        drain_timeout: settings.drain_timeout,
        resources: dependencies.resources,
    };
    ordered_shutdown(&mut steps).await;

    match early_failure {
        Some(error) => Err(error),
        None => steps.server_result.unwrap_or(Ok(())),
    }
}

/// Resolves on SIGTERM or SIGINT (Ctrl-C).
pub async fn wait_for_termination_signal() {
    #[cfg(unix)]
    {
        use tokio::signal::unix::{signal, SignalKind};
        match signal(SignalKind::terminate()) {
            Ok(mut sigterm) => {
                tokio::select! {
                    _ = sigterm.recv() => tracing::info!("received SIGTERM"),
                    _ = tokio::signal::ctrl_c() => tracing::info!("received SIGINT"),
                }
            }
            Err(error) => {
                tracing::warn!(%error, "cannot install SIGTERM handler; waiting for SIGINT only");
                let _ = tokio::signal::ctrl_c().await;
                tracing::info!("received SIGINT");
            }
        }
    }
    #[cfg(not(unix))]
    {
        let _ = tokio::signal::ctrl_c().await;
        tracing::info!("received SIGINT");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    struct Recorder {
        events: Arc<Mutex<Vec<&'static str>>>,
    }

    impl Recorder {
        fn push(&self, event: &'static str) {
            self.events.lock().unwrap().push(event);
        }
    }

    #[async_trait]
    impl ShutdownSteps for Recorder {
        async fn mark_not_serving(&mut self) {
            self.push("not_serving");
        }
        async fn stop_accepting(&mut self) {
            self.push("stop_accepting");
        }
        async fn drain(&mut self) {
            self.push("drain");
        }
        async fn close_resources(&mut self) {
            self.push("close_resources");
        }
    }

    #[tokio::test]
    async fn shutdown_reports_not_serving_before_anything_stops() {
        let events = Arc::new(Mutex::new(Vec::new()));
        let mut recorder = Recorder {
            events: events.clone(),
        };
        ordered_shutdown(&mut recorder).await;
        assert_eq!(
            *events.lock().unwrap(),
            vec!["not_serving", "stop_accepting", "drain", "close_resources"]
        );
    }

    #[tokio::test]
    async fn missing_database_url_builds_unavailable_dependencies() {
        let config = Config::from_lookup(|_| None).unwrap();
        let dependencies = build_dependencies(&config);
        assert!(dependencies.resources.is_empty());
        assert!(dependencies.probe.check().await.is_err());
    }

    #[tokio::test]
    async fn invalid_database_url_is_reported_without_the_secret() {
        let secret = "s3cr3t-passw0rd";
        let url = format!("postgres://user:{secret}@host:notaport/db");
        let config =
            Config::from_lookup(|name| (name == "DATABASE_URL").then(|| url.clone())).unwrap();
        let dependencies = build_dependencies(&config);
        let failure = dependencies.probe.check().await.unwrap_err();
        assert!(!failure.reason.contains(secret));
        assert!(dependencies.resources.is_empty());
    }
}
