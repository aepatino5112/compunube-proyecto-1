//! Per-instance readiness (E40, F47 D3).
//!
//! A background loop evaluates a [`ReadinessProbe`] on a fixed interval and
//! feeds the result through a small state machine into the gRPC Health service
//! under `player_profile`. The status is `SERVING` only while every check
//! passes, flips to `NOT_SERVING` on failure and recovers on its own. On
//! shutdown the controller is *drained*: it reports `NOT_SERVING` first and
//! ignores any later probe result so a late probe can never flip it back.

use std::{sync::Arc, time::Duration};

use async_trait::async_trait;
use tokio::sync::{watch, Mutex};
use tonic_health::{server::HealthReporter, ServingStatus};

/// Service name Envoy health-checks (`infra/envoy/envoy.yaml`).
pub const HEALTH_SERVICE_NAME: &str = "player_profile";

/// Why the instance is not ready. Must never contain credentials or driver
/// messages; probes build it from fixed texts and sanitized classifications.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProbeFailure {
    pub reason: String,
}

impl ProbeFailure {
    pub fn new(reason: impl Into<String>) -> Self {
        Self {
            reason: reason.into(),
        }
    }
}

#[async_trait]
pub trait ReadinessProbe: Send + Sync {
    async fn check(&self) -> Result<(), ProbeFailure>;
}

/// Probe used when the database cannot even be configured (missing or invalid
/// `DATABASE_URL`): the instance runs but is permanently `NOT_SERVING` (D4).
pub struct UnconfiguredProbe {
    reason: String,
}

impl UnconfiguredProbe {
    pub fn new(reason: impl Into<String>) -> Self {
        Self {
            reason: reason.into(),
        }
    }
}

#[async_trait]
impl ReadinessProbe for UnconfiguredProbe {
    async fn check(&self) -> Result<(), ProbeFailure> {
        Err(ProbeFailure::new(self.reason.clone()))
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Transition {
    ToServing,
    ToNotServing(String),
    /// Still `NOT_SERVING` but the cause changed (or was seen for the first
    /// time); logged once instead of on every probe.
    ReasonChanged(String),
}

/// Pure state machine. Starts `NOT_SERVING` with no known reason.
#[derive(Debug, Default)]
pub struct ReadinessTracker {
    serving: bool,
    last_reason: Option<String>,
}

impl ReadinessTracker {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn is_serving(&self) -> bool {
        self.serving
    }

    pub fn observe(&mut self, result: &Result<(), ProbeFailure>) -> Option<Transition> {
        match result {
            Ok(()) => {
                self.last_reason = None;
                if self.serving {
                    None
                } else {
                    self.serving = true;
                    Some(Transition::ToServing)
                }
            }
            Err(failure) => {
                let reason_changed = self.last_reason.as_deref() != Some(failure.reason.as_str());
                self.last_reason = Some(failure.reason.clone());
                if self.serving {
                    self.serving = false;
                    Some(Transition::ToNotServing(failure.reason.clone()))
                } else if reason_changed {
                    Some(Transition::ReasonChanged(failure.reason.clone()))
                } else {
                    None
                }
            }
        }
    }
}

/// Where statuses are published. Abstracted so tests need no gRPC server.
#[async_trait]
pub trait StatusSink: Send + Sync {
    async fn publish(&self, status: ServingStatus);
}

/// Publishes to the tonic-health service for `player_profile` and for the
/// empty service name, so generic gRPC health clients agree with Envoy.
pub struct GrpcHealthSink {
    reporter: HealthReporter,
}

impl GrpcHealthSink {
    pub fn new(reporter: HealthReporter) -> Self {
        Self { reporter }
    }
}

#[async_trait]
impl StatusSink for GrpcHealthSink {
    async fn publish(&self, status: ServingStatus) {
        let mut reporter = self.reporter.clone();
        reporter
            .set_service_status(HEALTH_SERVICE_NAME, status)
            .await;
        reporter.set_service_status("", status).await;
    }
}

struct ControllerState {
    tracker: ReadinessTracker,
    draining: bool,
}

/// Single writer of the health status; serializes probe results and shutdown.
pub struct HealthController {
    sink: Arc<dyn StatusSink>,
    state: Mutex<ControllerState>,
}

impl HealthController {
    /// Publishes `NOT_SERVING` immediately: an instance is not ready until the
    /// first probe succeeds.
    pub async fn start(sink: Arc<dyn StatusSink>) -> Self {
        sink.publish(ServingStatus::NotServing).await;
        Self {
            sink,
            state: Mutex::new(ControllerState {
                tracker: ReadinessTracker::new(),
                draining: false,
            }),
        }
    }

    pub async fn report(&self, result: Result<(), ProbeFailure>) {
        let mut state = self.state.lock().await;
        if state.draining {
            return;
        }
        match state.tracker.observe(&result) {
            Some(Transition::ToServing) => {
                self.sink.publish(ServingStatus::Serving).await;
                tracing::info!("readiness checks passed; reporting SERVING");
            }
            Some(Transition::ToNotServing(reason)) => {
                self.sink.publish(ServingStatus::NotServing).await;
                tracing::warn!(%reason, "readiness check failed; reporting NOT_SERVING");
            }
            Some(Transition::ReasonChanged(reason)) => {
                tracing::warn!(%reason, "readiness check failing; reporting NOT_SERVING");
            }
            None => {}
        }
    }

    /// First step of shutdown: report `NOT_SERVING` and ignore later probes.
    pub async fn begin_shutdown(&self) {
        let mut state = self.state.lock().await;
        state.draining = true;
        self.sink.publish(ServingStatus::NotServing).await;
        tracing::info!("shutdown started; reporting NOT_SERVING");
    }
}

/// Evaluates `probe` every `interval` (each run bounded by `timeout`) until
/// `stop` fires or its sender is dropped.
pub async fn run_probe_loop(
    probe: Arc<dyn ReadinessProbe>,
    controller: Arc<HealthController>,
    interval: Duration,
    timeout: Duration,
    mut stop: watch::Receiver<bool>,
) {
    loop {
        if *stop.borrow() {
            break;
        }
        let result = match tokio::time::timeout(timeout, probe.check()).await {
            Ok(result) => result,
            Err(_) => Err(ProbeFailure::new("readiness probe timed out")),
        };
        controller.report(result).await;

        tokio::select! {
            _ = tokio::time::sleep(interval) => {}
            changed = stop.changed() => {
                if changed.is_err() || *stop.borrow() {
                    break;
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{collections::VecDeque, sync::Mutex as StdMutex};

    fn fail(reason: &str) -> Result<(), ProbeFailure> {
        Err(ProbeFailure::new(reason))
    }

    #[test]
    fn tracker_starts_not_serving_and_logs_first_reason_once() {
        let mut tracker = ReadinessTracker::new();
        assert!(!tracker.is_serving());
        assert_eq!(
            tracker.observe(&fail("db down")),
            Some(Transition::ReasonChanged("db down".into()))
        );
        assert_eq!(tracker.observe(&fail("db down")), None);
        assert_eq!(
            tracker.observe(&fail("migration 0001 missing")),
            Some(Transition::ReasonChanged("migration 0001 missing".into()))
        );
        assert!(!tracker.is_serving());
    }

    #[test]
    fn tracker_serves_only_after_success_and_reports_each_edge_once() {
        let mut tracker = ReadinessTracker::new();
        assert_eq!(tracker.observe(&Ok(())), Some(Transition::ToServing));
        assert_eq!(tracker.observe(&Ok(())), None);
        assert!(tracker.is_serving());

        assert_eq!(
            tracker.observe(&fail("db down")),
            Some(Transition::ToNotServing("db down".into()))
        );
        assert_eq!(tracker.observe(&fail("db down")), None);
        assert!(!tracker.is_serving());

        // Automatic recovery.
        assert_eq!(tracker.observe(&Ok(())), Some(Transition::ToServing));
        assert!(tracker.is_serving());
    }

    #[derive(Default)]
    struct RecordingSink {
        published: StdMutex<Vec<ServingStatus>>,
    }

    impl RecordingSink {
        fn history(&self) -> Vec<ServingStatus> {
            self.published.lock().unwrap().clone()
        }
    }

    #[async_trait]
    impl StatusSink for RecordingSink {
        async fn publish(&self, status: ServingStatus) {
            self.published.lock().unwrap().push(status);
        }
    }

    #[tokio::test]
    async fn controller_publishes_not_serving_at_start_then_follows_probes() {
        let sink = Arc::new(RecordingSink::default());
        let controller = HealthController::start(sink.clone()).await;
        controller.report(fail("db down")).await;
        controller.report(Ok(())).await;
        controller.report(Ok(())).await;
        controller.report(fail("db down")).await;
        controller.report(Ok(())).await;

        assert_eq!(
            sink.history(),
            vec![
                ServingStatus::NotServing,
                ServingStatus::Serving,
                ServingStatus::NotServing,
                ServingStatus::Serving,
            ]
        );
    }

    #[tokio::test]
    async fn probe_results_after_shutdown_cannot_restore_serving() {
        let sink = Arc::new(RecordingSink::default());
        let controller = HealthController::start(sink.clone()).await;
        controller.report(Ok(())).await;
        controller.begin_shutdown().await;
        controller.report(Ok(())).await;

        assert_eq!(
            sink.history(),
            vec![
                ServingStatus::NotServing,
                ServingStatus::Serving,
                ServingStatus::NotServing,
            ]
        );
    }

    struct ScriptedProbe {
        script: StdMutex<VecDeque<Result<(), ProbeFailure>>>,
        calls: StdMutex<usize>,
    }

    impl ScriptedProbe {
        fn new(script: Vec<Result<(), ProbeFailure>>) -> Self {
            Self {
                script: StdMutex::new(script.into()),
                calls: StdMutex::new(0),
            }
        }
    }

    #[async_trait]
    impl ReadinessProbe for ScriptedProbe {
        async fn check(&self) -> Result<(), ProbeFailure> {
            *self.calls.lock().unwrap() += 1;
            self.script.lock().unwrap().pop_front().unwrap_or(Ok(()))
        }
    }

    struct HangingProbe;

    #[async_trait]
    impl ReadinessProbe for HangingProbe {
        async fn check(&self) -> Result<(), ProbeFailure> {
            std::future::pending().await
        }
    }

    #[tokio::test(start_paused = true)]
    async fn probe_loop_recovers_automatically_and_stops_on_signal() {
        let sink = Arc::new(RecordingSink::default());
        let controller = Arc::new(HealthController::start(sink.clone()).await);
        let probe = Arc::new(ScriptedProbe::new(vec![
            fail("db unreachable"),
            fail("db unreachable"),
            Ok(()),
            fail("db unreachable"),
            Ok(()),
        ]));
        let (stop_tx, stop_rx) = watch::channel(false);
        let task = tokio::spawn(run_probe_loop(
            probe.clone(),
            controller,
            Duration::from_secs(1),
            Duration::from_millis(500),
            stop_rx,
        ));

        tokio::time::sleep(Duration::from_millis(4_500)).await;
        stop_tx.send(true).unwrap();
        task.await.unwrap();

        assert_eq!(
            sink.history(),
            vec![
                ServingStatus::NotServing,
                ServingStatus::Serving,
                ServingStatus::NotServing,
                ServingStatus::Serving,
            ]
        );
        assert_eq!(*probe.calls.lock().unwrap(), 5);
    }

    #[tokio::test(start_paused = true)]
    async fn hanging_probe_counts_as_failure_and_never_serves() {
        let sink = Arc::new(RecordingSink::default());
        let controller = Arc::new(HealthController::start(sink.clone()).await);
        let (stop_tx, stop_rx) = watch::channel(false);
        let task = tokio::spawn(run_probe_loop(
            Arc::new(HangingProbe),
            controller,
            Duration::from_secs(1),
            Duration::from_millis(200),
            stop_rx,
        ));
        tokio::time::sleep(Duration::from_secs(3)).await;
        stop_tx.send(true).unwrap();
        task.await.unwrap();
        assert_eq!(sink.history(), vec![ServingStatus::NotServing]);
    }

    #[tokio::test]
    async fn unconfigured_probe_always_fails_with_its_reason() {
        let probe = UnconfiguredProbe::new("DATABASE_URL is not configured");
        assert_eq!(
            probe.check().await,
            Err(ProbeFailure::new("DATABASE_URL is not configured"))
        );
    }
}
