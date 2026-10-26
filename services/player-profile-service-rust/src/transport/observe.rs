//! Per-request observability at the transport edge: in-flight gauge, request
//! counter, latency histogram and one structured log line per RPC.
//!
//! Only closed vocabularies reach the series and the log (`metrics::rpc`): no
//! player id, request id, catalog version, token, SQL or error message is ever
//! recorded here, and the application layer stays free of this concern.

use std::{sync::Arc, time::Instant};
use tonic::Request;

use crate::{
    logging::SERVICE_NAME,
    metrics::{
        rpc::{ErrorClass, Rpc, RpcResult},
        Metrics,
    },
};

/// Starts [`RpcCall`]s that report to one [`Metrics`] registry.
#[derive(Clone)]
pub struct RpcObserver {
    metrics: Arc<Metrics>,
}

impl RpcObserver {
    pub fn new(metrics: Arc<Metrics>) -> Self {
        Self { metrics }
    }

    /// Call before any work for the RPC, including decoding the request.
    pub fn start<T>(&self, rpc: Rpc, request: &Request<T>) -> RpcCall {
        self.metrics.rpc_started(rpc);
        RpcCall {
            metrics: self.metrics.clone(),
            rpc,
            correlation_id: request
                .metadata()
                .get("x-correlation-id")
                .and_then(|value| value.to_str().ok())
                .filter(|id| valid_correlation_id(id))
                .unwrap_or("")
                .to_owned(),
            started: Instant::now(),
            finished: false,
        }
    }
}

/// One RPC in progress. Dropping it without [`RpcCall::finish`] (the caller
/// cancelled and Tonic dropped the handler future) records a `CANCELLED` error,
/// so the in-flight gauge can never leak.
pub struct RpcCall {
    metrics: Arc<Metrics>,
    rpc: Rpc,
    correlation_id: String,
    started: Instant,
    finished: bool,
}

impl RpcCall {
    pub fn finish(mut self, result: RpcResult) {
        self.record(&result);
    }

    fn record(&mut self, result: &RpcResult) {
        if std::mem::replace(&mut self.finished, true) {
            return;
        }
        let elapsed = self.started.elapsed();
        self.metrics.rpc_finished(self.rpc, result, elapsed);
        log_rpc(
            self.metrics.instance_id(),
            self.rpc,
            result,
            elapsed.as_secs_f64() * 1000.0,
            &self.correlation_id,
        );
    }
}

impl Drop for RpcCall {
    fn drop(&mut self) {
        self.record(&RpcResult::cancelled());
    }
}

/// Business rejections and successes are routine (`info`); problems the
/// operator may need to act on are not.
fn log_rpc(instance_id: &str, rpc: Rpc, result: &RpcResult, latency_ms: f64, correlation_id: &str) {
    let (outcome, code, class) = (
        result.outcome().as_str(),
        result.code(),
        result.class().as_str(),
    );
    macro_rules! emit {
        ($level:ident) => {
            tracing::$level!(
                service = SERVICE_NAME,
                instance_id,
                rpc = rpc.as_str(),
                outcome,
                code,
                error_class = class,
                latency_ms,
                correlation_id,
                "rpc completed"
            )
        };
    }
    match result.class() {
        ErrorClass::None | ErrorClass::Business => emit!(info),
        ErrorClass::Client | ErrorClass::Cancelled => emit!(warn),
        ErrorClass::Server if code == "INTERNAL" => emit!(error),
        ErrorClass::Server => emit!(warn),
    }
}

fn valid_correlation_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::logging::build_subscriber;
    use std::sync::Mutex;

    #[derive(Clone, Default)]
    struct Buffer(Arc<Mutex<Vec<u8>>>);

    impl std::io::Write for Buffer {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            self.0.lock().unwrap().extend_from_slice(bytes);
            Ok(bytes.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    impl<'a> tracing_subscriber::fmt::writer::MakeWriter<'a> for Buffer {
        type Writer = Buffer;
        fn make_writer(&'a self) -> Self::Writer {
            self.clone()
        }
    }

    #[test]
    fn every_rpc_logs_valid_correlation_without_sensitive_metadata() {
        let buffer = Buffer::default();
        let subscriber = build_subscriber(buffer.clone());
        tracing::subscriber::with_default(subscriber, || {
            let observer = RpcObserver::new(Arc::new(Metrics::new("rust-test")));
            for rpc in Rpc::ALL {
                let mut request = Request::new(());
                request
                    .metadata_mut()
                    .insert("x-correlation-id", "client-ABC_123".parse().unwrap());
                request
                    .metadata_mut()
                    .insert("authorization", "secret-token".parse().unwrap());
                observer
                    .start(rpc, &request)
                    .finish(RpcResult::from_read::<()>(&Ok(())));
            }
            let mut invalid = Request::new(());
            invalid
                .metadata_mut()
                .insert("x-correlation-id", "unsafe/path".parse().unwrap());
            observer
                .start(Rpc::GetProfile, &invalid)
                .finish(RpcResult::from_read::<()>(&Ok(())));
        });
        let output = String::from_utf8(buffer.0.lock().unwrap().clone()).unwrap();
        assert!(!output.contains("secret-token"));
        assert!(!output.contains("unsafe/path"));
        let lines: Vec<_> = output.lines().collect();
        assert_eq!(lines.len(), 9);
        for line in &lines[..8] {
            let event: serde_json::Value = serde_json::from_str(line).unwrap();
            assert_eq!(event["message"], "rpc completed");
            assert_eq!(event["correlation_id"], "client-ABC_123");
        }
        let invalid: serde_json::Value = serde_json::from_str(lines[8]).unwrap();
        assert_eq!(invalid["correlation_id"], "");
    }
}
