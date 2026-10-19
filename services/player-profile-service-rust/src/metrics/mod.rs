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

pub mod server;

use std::collections::HashMap;

use prometheus::{Encoder, IntGauge, Opts, Registry, TextEncoder};

use crate::logging::SERVICE_NAME;

/// Content type of the Prometheus text exposition format.
pub const CONTENT_TYPE: &str = "text/plain; version=0.0.4; charset=utf-8";

pub struct Metrics {
    registry: Registry,
    instance_id: String,
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

        Self {
            registry,
            instance_id: instance_id.to_string(),
        }
    }

    pub fn instance_id(&self) -> &str {
        &self.instance_id
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
