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
    Encoder, HistogramOpts, HistogramVec, IntCounterVec, IntGauge, IntGaugeVec, Opts, Registry,
    TextEncoder,
};

use std::time::Duration;

use crate::logging::SERVICE_NAME;
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

        Self {
            registry,
            instance_id: instance_id.to_string(),
            rpc_requests,
            rpc_duration,
            rpc_in_flight,
        }
    }

    pub fn instance_id(&self) -> &str {
        &self.instance_id
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
