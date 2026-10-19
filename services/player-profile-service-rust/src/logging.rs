//! Structured JSON logging.
//!
//! Every event carries `service` and `instance_id` through a root span that the
//! runtime enters for the whole process (and re-attaches to spawned tasks), so
//! the JSON line exposes them under `span`. Secrets are never passed to the
//! logger by callers; see `config::SecretString`.

use tracing::Span;
use tracing_subscriber::{
    fmt::{format::FmtSpan, writer::MakeWriter},
    layer::SubscriberExt,
    util::SubscriberInitExt,
    EnvFilter,
};

pub const SERVICE_NAME: &str = "player-profile-service";

/// Root span carrying the static identity fields for every log line.
pub fn root_span(instance_id: &str) -> Span {
    tracing::info_span!("service", service = SERVICE_NAME, instance_id = %instance_id)
}

/// Installs the global JSON subscriber writing to stdout. `RUST_LOG` selects
/// the level (default `info`).
pub fn init() {
    build_subscriber(std::io::stdout).init();
}

pub fn build_subscriber<W>(writer: W) -> impl tracing::Subscriber + Send + Sync
where
    W: for<'a> MakeWriter<'a> + Send + Sync + 'static,
{
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    let layer = tracing_subscriber::fmt::layer()
        .json()
        .flatten_event(true)
        .with_current_span(true)
        .with_span_list(false)
        .with_span_events(FmtSpan::NONE)
        .with_writer(writer);
    tracing_subscriber::registry().with(filter).with(layer)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    #[derive(Clone, Default)]
    struct Buffer(Arc<Mutex<Vec<u8>>>);

    impl std::io::Write for Buffer {
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

    #[test]
    fn log_lines_are_json_with_service_and_instance_id() {
        let buffer = Buffer::default();
        let subscriber = build_subscriber(buffer.clone());
        tracing::subscriber::with_default(subscriber, || {
            let span = root_span("rust-7");
            let _guard = span.enter();
            tracing::info!(listen_addr = "0.0.0.0:50051", "service starting");
        });

        let output = String::from_utf8(buffer.0.lock().unwrap().clone()).unwrap();
        let line: serde_json::Value = serde_json::from_str(output.lines().next().unwrap()).unwrap();
        assert_eq!(line["message"], "service starting");
        assert_eq!(line["level"], "INFO");
        assert_eq!(line["span"]["service"], SERVICE_NAME);
        assert_eq!(line["span"]["instance_id"], "rust-7");
        assert_eq!(line["listen_addr"], "0.0.0.0:50051");
    }
}
