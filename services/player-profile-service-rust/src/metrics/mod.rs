//! Prometheus metrics (H67).
//!
//! One private [`prometheus::Registry`] per [`Metrics`] value, so tests and
//! replicas never share global state. Every series carries the constant labels
//! `service` and `instance_id`; per-player or per-request labels are forbidden
//! (cardinality, privacy). Names follow the Go service (`match_service_up`):
//! snake_case with the `player_profile_` prefix.
//!
//! This module is observability plumbing only: it owns no business rule and
//! never touches storage, so `/metrics` answers even when PostgreSQL is down.

pub mod rpc;
pub mod server;

use std::collections::HashMap;

use prometheus::{
    Encoder, HistogramOpts, HistogramVec, IntCounter, IntCounterVec, IntGauge, IntGaugeVec, Opts,
    Registry, TextEncoder,
};

use std::{
    sync::{Arc, Mutex},
    time::Duration,
};

use crate::{
    application::{MutationOutcome, OperationObserver, SettlementOutcome},
    domain::{MutationRejection, SettlementRejection},
    logging::SERVICE_NAME,
    repository::PoolStatsSource,
};
use rpc::{Rpc, RpcResult};

/// Latency buckets in seconds: a single-row transaction takes a few
/// milliseconds, a contended or degraded one up to the gRPC deadline.
const DURATION_BUCKETS: [f64; 12] = [
    0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0,
];

/// Content type of the Prometheus text exposition format.
pub const CONTENT_TYPE: &str = "text/plain; version=0.0.4; charset=utf-8";

pub struct Metrics {
    registry: Registry,
    instance_id: String,
    rpc_requests: IntCounterVec,
    rpc_duration: HistogramVec,
    rpc_in_flight: IntGaugeVec,
    idempotency_replays: IntCounterVec,
    idempotency_conflicts: IntCounterVec,
    settlements: IntCounterVec,
    pool: PoolGauges,
    pool_source: Mutex<Option<Arc<dyn PoolStatsSource>>>,
    health_serving: IntGauge,
    probe_failures: IntCounter,
}

/// Stored operation types plus the settlement; every `operation` label value.
const OPERATIONS: [&str; 6] = [
    "buy",
    "craft",
    "exchange",
    "equip",
    "appearance",
    "settle_race",
];
const SETTLEMENT_OPERATION: &str = "settle_race";
const SETTLEMENT_OUTCOMES: [&str; 4] = ["credited", "replayed", "conflict", "invalid"];

/// Business pool gauges, refreshed from the pool on every scrape.
struct PoolGauges {
    open: IntGauge,
    idle: IntGauge,
    in_use: IntGauge,
    max: IntGauge,
}

fn gauge(registry: &Registry, name: &str, help: &str) -> IntGauge {
    let gauge = IntGauge::with_opts(Opts::new(name, help)).expect("valid metric definition");
    registry
        .register(Box::new(gauge.clone()))
        .expect("metric registered once");
    gauge
}

fn counter_vec(registry: &Registry, name: &str, help: &str, labels: &[&str]) -> IntCounterVec {
    let counter =
        IntCounterVec::new(Opts::new(name, help), labels).expect("valid metric definition");
    registry
        .register(Box::new(counter.clone()))
        .expect("metric registered once");
    counter
}

impl Metrics {
    /// Builds a registry whose series all carry `service` and `instance_id`.
    /// The definitions are static, so registration cannot fail at runtime; the
    /// unit tests exercise every one of them.
    pub fn new(instance_id: &str) -> Self {
        let labels = HashMap::from([
            ("service".to_string(), SERVICE_NAME.to_string()),
            ("instance_id".to_string(), instance_id.to_string()),
        ]);
        let registry =
            Registry::new_custom(None, Some(labels)).expect("constant labels are valid and unique");

        let up = IntGauge::with_opts(Opts::new(
            "player_profile_up",
            "Whether the player/profile service process is running.",
        ))
        .expect("valid metric definition");
        up.set(1);
        registry
            .register(Box::new(up))
            .expect("metric registered once");

        let rpc_requests = IntCounterVec::new(
            Opts::new(
                "player_profile_rpc_requests_total",
                "Finished RPCs by method, outcome and closed result code.",
            ),
            &["rpc", "outcome", "code"],
        )
        .expect("valid metric definition");
        let rpc_duration = HistogramVec::new(
            HistogramOpts::new(
                "player_profile_rpc_duration_seconds",
                "RPC handling time by method, including the database transaction.",
            )
            .buckets(DURATION_BUCKETS.to_vec()),
            &["rpc"],
        )
        .expect("valid metric definition");
        let rpc_in_flight = IntGaugeVec::new(
            Opts::new(
                "player_profile_rpc_in_flight",
                "RPCs currently being handled, by method.",
            ),
            &["rpc"],
        )
        .expect("valid metric definition");
        // Series that exist from the first scrape, so dashboards and alerts do
        // not have to cope with "no data" before the first request.
        for rpc in Rpc::ALL {
            rpc_duration.with_label_values(&[rpc.as_str()]);
            rpc_in_flight.with_label_values(&[rpc.as_str()]);
        }
        registry
            .register(Box::new(rpc_requests.clone()))
            .expect("metric registered once");
        registry
            .register(Box::new(rpc_duration.clone()))
            .expect("metric registered once");
        registry
            .register(Box::new(rpc_in_flight.clone()))
            .expect("metric registered once");

        let idempotency_replays = counter_vec(
            &registry,
            "player_profile_idempotency_replays_total",
            "Requests answered from an earlier identical request, by operation.",
            &["operation"],
        );
        let idempotency_conflicts = counter_vec(
            &registry,
            "player_profile_idempotency_conflicts_total",
            "Requests that reused an idempotency key with different data, by operation.",
            &["operation"],
        );
        for operation in OPERATIONS {
            idempotency_replays.with_label_values(&[operation]);
            idempotency_conflicts.with_label_values(&[operation]);
        }
        let settlements = counter_vec(
            &registry,
            "player_profile_settlements_total",
            "Settlement results: credited, replayed, conflict or invalid.",
            &["outcome"],
        );
        for outcome in SETTLEMENT_OUTCOMES {
            settlements.with_label_values(&[outcome]);
        }
        let pool = PoolGauges {
            open: gauge(
                &registry,
                "player_profile_db_pool_connections",
                "Open connections in the business pool (idle plus in use).",
            ),
            idle: gauge(
                &registry,
                "player_profile_db_pool_idle_connections",
                "Open business pool connections waiting for work.",
            ),
            in_use: gauge(
                &registry,
                "player_profile_db_pool_in_use_connections",
                "Business pool connections currently running a query or transaction.",
            ),
            max: gauge(
                &registry,
                "player_profile_db_pool_max_connections",
                "Configured upper bound of the business pool.",
            ),
        };
        let health_serving = gauge(
            &registry,
            "player_profile_health_serving",
            "1 while the instance reports SERVING to the gRPC health service, else 0.",
        );
        let probe_failures = IntCounter::with_opts(Opts::new(
            "player_profile_health_probe_failures_total",
            "Readiness probes that failed (database unreachable, migrations missing, timeout).",
        ))
        .expect("valid metric definition");
        registry
            .register(Box::new(probe_failures.clone()))
            .expect("metric registered once");

        Self {
            registry,
            instance_id: instance_id.to_string(),
            rpc_requests,
            rpc_duration,
            rpc_in_flight,
            idempotency_replays,
            idempotency_conflicts,
            settlements,
            pool,
            pool_source: Mutex::new(None),
            health_serving,
            probe_failures,
        }
    }

    pub fn instance_id(&self) -> &str {
        &self.instance_id
    }

    /// Reports the business pool's numbers on every scrape.
    pub fn set_pool_source(&self, source: Arc<dyn PoolStatsSource>) {
        if let Ok(mut slot) = self.pool_source.lock() {
            *slot = Some(source);
        }
    }

    /// Serving state as published to the gRPC health service.
    pub fn set_health_serving(&self, serving: bool) {
        self.health_serving.set(i64::from(serving));
    }

    /// One readiness probe failed (any reason).
    pub fn probe_failed(&self) {
        self.probe_failures.inc();
    }

    /// An RPC started: raises the in-flight gauge.
    pub fn rpc_started(&self, rpc: Rpc) {
        self.rpc_in_flight.with_label_values(&[rpc.as_str()]).inc();
    }

    /// An RPC ended (always paired with [`Metrics::rpc_started`]).
    pub fn rpc_finished(&self, rpc: Rpc, result: &RpcResult, elapsed: Duration) {
        let name = rpc.as_str();
        self.rpc_in_flight.with_label_values(&[name]).dec();
        self.rpc_requests
            .with_label_values(&[name, result.outcome().as_str(), result.code()])
            .inc();
        self.rpc_duration
            .with_label_values(&[name])
            .observe(elapsed.as_secs_f64());
    }

    /// Prometheus text exposition of every registered series.
    pub fn render(&self) -> String {
        self.refresh_pool_gauges();
        let mut buffer = Vec::new();
        match TextEncoder::new().encode(&self.registry.gather(), &mut buffer) {
            Ok(()) => String::from_utf8(buffer).unwrap_or_default(),
            Err(error) => {
                tracing::error!(%error, "cannot encode metrics");
                String::new()
            }
        }
    }
}

impl Metrics {
    fn refresh_pool_gauges(&self) {
        let snapshot = self
            .pool_source
            .lock()
            .ok()
            .and_then(|slot| slot.as_ref().map(|source| source.snapshot()));
        // No pool (DATABASE_URL missing or invalid): report zeros, not gaps.
        let (open, idle, in_use, max) =
            snapshot.map_or((0, 0, 0, 0), |s| (s.size, s.idle, s.in_use(), s.max));
        self.pool.open.set(i64::from(open));
        self.pool.idle.set(i64::from(idle));
        self.pool.in_use.set(i64::from(in_use));
        self.pool.max.set(i64::from(max));
    }

    fn count_idempotency(&self, operation: &str, replayed: bool, conflict: bool) {
        if conflict {
            self.idempotency_conflicts
                .with_label_values(&[operation])
                .inc();
        } else if replayed {
            self.idempotency_replays
                .with_label_values(&[operation])
                .inc();
        }
    }
}

impl OperationObserver for Metrics {
    fn mutation_resolved(&self, operation: &'static str, outcome: &MutationOutcome) {
        let (replayed, conflict) = match outcome {
            MutationOutcome::Applied { replayed, .. } => (*replayed, false),
            MutationOutcome::Rejected {
                rejection,
                replayed,
            } => (
                *replayed,
                *rejection == MutationRejection::IdempotencyConflict,
            ),
        };
        self.count_idempotency(operation, replayed, conflict);
    }

    fn settlement_resolved(&self, outcome: &SettlementOutcome) {
        let (label, replayed, conflict) = match outcome {
            SettlementOutcome::Applied { replayed, .. } => (
                if *replayed { "replayed" } else { "credited" },
                *replayed,
                false,
            ),
            SettlementOutcome::Rejected {
                rejection: SettlementRejection::Conflict,
                ..
            } => ("conflict", false, true),
            SettlementOutcome::Rejected {
                rejection: SettlementRejection::InvalidSettlement,
                ..
            } => ("invalid", false, false),
        };
        self.settlements.with_label_values(&[label]).inc();
        self.count_idempotency(SETTLEMENT_OPERATION, replayed, conflict);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_series_carries_the_constant_labels() {
        let text = Metrics::new("rust-7").render();
        assert!(!text.is_empty());
        for line in text
            .lines()
            .filter(|l| !l.starts_with('#') && !l.is_empty())
        {
            assert!(
                line.contains(r#"service="player-profile-service""#)
                    && line.contains(r#"instance_id="rust-7""#),
                "series without constant labels: {line}"
            );
        }
    }

    #[test]
    fn up_gauge_is_exposed_with_help_and_type() {
        let text = Metrics::new("rust-1").render();
        assert!(text.contains("# HELP player_profile_up "));
        assert!(text.contains("# TYPE player_profile_up gauge"));
        // Label order is not part of the format (the registry stores its
        // constant labels in a hash map), so match the series by parts.
        let series = text
            .lines()
            .find(|line| line.starts_with("player_profile_up{"))
            .expect("player_profile_up series");
        assert!(series.contains(r#"instance_id="rust-1""#));
        assert!(series.contains(r#"service="player-profile-service""#));
        assert!(series.ends_with("} 1"), "{series}");
    }

    fn series<'a>(text: &'a str, name: &str, labels: &[&str]) -> Option<&'a str> {
        text.lines().find(|line| {
            line.starts_with(name)
                && line[name.len()..].starts_with(['{', ' '])
                && labels.iter().all(|label| line.contains(label))
        })
    }

    fn value(line: &str) -> f64 {
        line.rsplit(' ').next().unwrap().parse().unwrap()
    }

    fn finish(metrics: &Metrics, rpc: Rpc, result: RpcResult, millis: u64) {
        metrics.rpc_started(rpc);
        metrics.rpc_finished(rpc, &result, Duration::from_millis(millis));
    }

    #[test]
    fn rpc_requests_are_counted_by_rpc_outcome_and_closed_code() {
        use crate::application::{ApplicationError, MutationOutcome, MutationResult};
        use crate::domain::{provisioning::initial_state, MutationRejection};

        let metrics = Metrics::new("rust-1");
        let rejected = Ok(MutationResult {
            request_id: "r".into(),
            outcome: MutationOutcome::Rejected {
                rejection: MutationRejection::InsufficientCoins,
                replayed: false,
            },
        });
        let applied = Ok(MutationResult {
            request_id: "r".into(),
            outcome: MutationOutcome::Applied {
                replayed: false,
                profile: initial_state("p"),
            },
        });
        finish(
            &metrics,
            Rpc::BuyItem,
            RpcResult::from_mutation(&rejected),
            3,
        );
        finish(
            &metrics,
            Rpc::BuyItem,
            RpcResult::from_mutation(&rejected),
            3,
        );
        finish(
            &metrics,
            Rpc::BuyItem,
            RpcResult::from_mutation(&applied),
            3,
        );
        finish(
            &metrics,
            Rpc::GetProfile,
            RpcResult::from_read::<()>(&Err(ApplicationError::Unavailable)),
            3,
        );

        let text = metrics.render();
        let line = series(
            &text,
            "player_profile_rpc_requests_total",
            &[
                r#"rpc="BuyItem""#,
                r#"outcome="rejected""#,
                r#"code="INSUFFICIENT_COINS""#,
            ],
        )
        .expect("rejected BuyItem series");
        assert_eq!(value(line), 2.0);
        let line = series(
            &text,
            "player_profile_rpc_requests_total",
            &[
                r#"rpc="GetProfile""#,
                r#"outcome="error""#,
                r#"code="UNAVAILABLE""#,
            ],
        )
        .expect("failed GetProfile series");
        assert_eq!(value(line), 1.0);
        assert!(series(
            &text,
            "player_profile_rpc_requests_total",
            &[r#"rpc="BuyItem""#, r#"outcome="applied""#, r#"code="OK""#]
        )
        .is_some());
        // No series carries anything but the closed label names.
        for line in text
            .lines()
            .filter(|l| l.starts_with("player_profile_rpc_requests_total{"))
        {
            let names: Vec<&str> = line[line.find('{').unwrap() + 1..line.find('}').unwrap()]
                .split(',')
                .map(|pair| pair.split('=').next().unwrap())
                .collect();
            for name in names {
                assert!(
                    ["code", "instance_id", "outcome", "rpc", "service"].contains(&name),
                    "unexpected label {name}"
                );
            }
        }
    }

    #[test]
    fn rpc_duration_histogram_has_one_series_per_rpc_from_the_start() {
        let metrics = Metrics::new("rust-1");
        finish(&metrics, Rpc::SettleRace, RpcResult::cancelled(), 40);
        let text = metrics.render();
        assert!(text.contains("# TYPE player_profile_rpc_duration_seconds histogram"));
        let count = series(
            &text,
            "player_profile_rpc_duration_seconds_count",
            &[r#"rpc="SettleRace""#],
        )
        .unwrap();
        assert_eq!(value(count), 1.0);
        let sum = series(
            &text,
            "player_profile_rpc_duration_seconds_sum",
            &[r#"rpc="SettleRace""#],
        )
        .unwrap();
        assert!((value(sum) - 0.040).abs() < 1e-9, "{sum}");
        for rpc in Rpc::ALL {
            assert!(
                series(
                    &text,
                    "player_profile_rpc_duration_seconds_count",
                    &[&format!(r#"rpc="{}""#, rpc.as_str())]
                )
                .is_some(),
                "{rpc:?} has no duration series"
            );
        }
    }

    #[test]
    fn in_flight_gauge_rises_and_falls_per_rpc() {
        let metrics = Metrics::new("rust-1");
        metrics.rpc_started(Rpc::GetCatalog);
        metrics.rpc_started(Rpc::GetCatalog);
        let during = metrics.render();
        let line = series(
            &during,
            "player_profile_rpc_in_flight",
            &[r#"rpc="GetCatalog""#],
        )
        .unwrap();
        assert_eq!(value(line), 2.0);
        metrics.rpc_finished(Rpc::GetCatalog, &RpcResult::cancelled(), Duration::ZERO);
        metrics.rpc_finished(Rpc::GetCatalog, &RpcResult::cancelled(), Duration::ZERO);
        let after = metrics.render();
        let line = series(
            &after,
            "player_profile_rpc_in_flight",
            &[r#"rpc="GetCatalog""#],
        )
        .unwrap();
        assert_eq!(value(line), 0.0);
        let idle = series(
            &after,
            "player_profile_rpc_in_flight",
            &[r#"rpc="BuyItem""#],
        )
        .unwrap();
        assert_eq!(value(idle), 0.0);
    }

    fn rejected(rejection: MutationRejection, replayed: bool) -> MutationOutcome {
        MutationOutcome::Rejected {
            rejection,
            replayed,
        }
    }

    fn applied(replayed: bool) -> MutationOutcome {
        MutationOutcome::Applied {
            replayed,
            profile: crate::domain::provisioning::initial_state("p"),
        }
    }

    #[test]
    fn idempotency_replays_and_conflicts_are_counted_per_operation() {
        let metrics = Metrics::new("rust-1");
        metrics.mutation_resolved("buy", &applied(false));
        metrics.mutation_resolved("buy", &applied(true));
        metrics.mutation_resolved("buy", &rejected(MutationRejection::NotOwned, true));
        metrics.mutation_resolved("equip", &rejected(MutationRejection::NotOwned, false));
        metrics.mutation_resolved(
            "craft",
            &rejected(MutationRejection::IdempotencyConflict, false),
        );

        let text = metrics.render();
        let replays = series(
            &text,
            "player_profile_idempotency_replays_total",
            &[r#"operation="buy""#],
        )
        .unwrap();
        assert_eq!(value(replays), 2.0);
        let conflicts = series(
            &text,
            "player_profile_idempotency_conflicts_total",
            &[r#"operation="craft""#],
        )
        .unwrap();
        assert_eq!(value(conflicts), 1.0);
        for operation in [
            "buy",
            "craft",
            "exchange",
            "equip",
            "appearance",
            "settle_race",
        ] {
            for name in [
                "player_profile_idempotency_replays_total",
                "player_profile_idempotency_conflicts_total",
            ] {
                assert!(
                    series(&text, name, &[&format!(r#"operation="{operation}""#)]).is_some(),
                    "{name} has no {operation} series"
                );
            }
        }
        let equip = series(
            &text,
            "player_profile_idempotency_replays_total",
            &[r#"operation="equip""#],
        )
        .unwrap();
        assert_eq!(value(equip), 0.0);
    }

    #[test]
    fn settlement_outcomes_are_counted_and_mirror_into_idempotency() {
        let metrics = Metrics::new("rust-1");
        let profile = || crate::domain::provisioning::initial_state("p");
        metrics.settlement_resolved(&SettlementOutcome::Applied {
            replayed: false,
            profile: profile(),
        });
        metrics.settlement_resolved(&SettlementOutcome::Applied {
            replayed: false,
            profile: profile(),
        });
        metrics.settlement_resolved(&SettlementOutcome::Applied {
            replayed: true,
            profile: profile(),
        });
        metrics.settlement_resolved(&SettlementOutcome::Rejected {
            rejection: SettlementRejection::Conflict,
            replayed: false,
        });
        metrics.settlement_resolved(&SettlementOutcome::Rejected {
            rejection: SettlementRejection::InvalidSettlement,
            replayed: false,
        });

        let text = metrics.render();
        for (outcome, expected) in [
            ("credited", 2.0),
            ("replayed", 1.0),
            ("conflict", 1.0),
            ("invalid", 1.0),
        ] {
            let line = series(
                &text,
                "player_profile_settlements_total",
                &[&format!(r#"outcome="{outcome}""#)],
            )
            .unwrap_or_else(|| panic!("no {outcome} series"));
            assert_eq!(value(line), expected, "{outcome}");
        }
        let replays = series(
            &text,
            "player_profile_idempotency_replays_total",
            &[r#"operation="settle_race""#],
        )
        .unwrap();
        assert_eq!(value(replays), 1.0);
        let conflicts = series(
            &text,
            "player_profile_idempotency_conflicts_total",
            &[r#"operation="settle_race""#],
        )
        .unwrap();
        assert_eq!(value(conflicts), 1.0);
    }

    struct FakePool(crate::repository::PoolSnapshot);

    impl PoolStatsSource for FakePool {
        fn snapshot(&self) -> crate::repository::PoolSnapshot {
            self.0
        }
    }

    #[test]
    fn pool_gauges_follow_the_source_on_every_scrape_and_default_to_zero() {
        let metrics = Metrics::new("rust-1");
        let text = metrics.render();
        for name in [
            "player_profile_db_pool_connections",
            "player_profile_db_pool_idle_connections",
            "player_profile_db_pool_in_use_connections",
            "player_profile_db_pool_max_connections",
        ] {
            assert_eq!(
                value(series(&text, name, &[]).unwrap_or_else(|| panic!("{name} missing"))),
                0.0,
                "{name}"
            );
        }

        metrics.set_pool_source(Arc::new(FakePool(crate::repository::PoolSnapshot {
            size: 5,
            idle: 2,
            max: 10,
        })));
        let text = metrics.render();
        let get = |name: &str| value(series(&text, name, &[]).unwrap());
        assert_eq!(get("player_profile_db_pool_connections"), 5.0);
        assert_eq!(get("player_profile_db_pool_idle_connections"), 2.0);
        assert_eq!(get("player_profile_db_pool_in_use_connections"), 3.0);
        assert_eq!(get("player_profile_db_pool_max_connections"), 10.0);
    }

    #[test]
    fn health_gauge_starts_not_serving_and_probe_failures_accumulate() {
        let metrics = Metrics::new("rust-1");
        let text = metrics.render();
        assert_eq!(
            value(series(&text, "player_profile_health_serving", &[]).unwrap()),
            0.0
        );
        assert_eq!(
            value(series(&text, "player_profile_health_probe_failures_total", &[]).unwrap()),
            0.0
        );

        metrics.set_health_serving(true);
        metrics.probe_failed();
        metrics.probe_failed();
        let text = metrics.render();
        assert_eq!(
            value(series(&text, "player_profile_health_serving", &[]).unwrap()),
            1.0
        );
        assert_eq!(
            value(series(&text, "player_profile_health_probe_failures_total", &[]).unwrap()),
            2.0
        );
        metrics.set_health_serving(false);
        assert_eq!(
            value(series(&metrics.render(), "player_profile_health_serving", &[]).unwrap()),
            0.0
        );
    }

    #[test]
    fn two_registries_do_not_share_state() {
        let a = Metrics::new("rust-1");
        let b = Metrics::new("rust-2");
        assert!(a.render().contains(r#"instance_id="rust-1""#));
        assert!(!a.render().contains(r#"instance_id="rust-2""#));
        assert!(b.render().contains(r#"instance_id="rust-2""#));
    }

    #[test]
    fn exposition_never_contains_connection_strings() {
        let text = Metrics::new("rust-1").render();
        assert!(!text.contains("postgres://"));
        assert!(!text.contains("DATABASE_URL"));
    }
}
