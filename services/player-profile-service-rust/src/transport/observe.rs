//! Per-request observability at the transport edge: in-flight gauge, request
//! counter, latency histogram and one structured log line per RPC.
//!
//! Only closed vocabularies reach the series and the log (`metrics::rpc`): no
//! player id, request id, catalog version, token, SQL or error message is ever
//! recorded here, and the application layer stays free of this concern.

use std::{sync::Arc, time::Instant};

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
    pub fn start(&self, rpc: Rpc) -> RpcCall {
        self.metrics.rpc_started(rpc);
        RpcCall {
            metrics: self.metrics.clone(),
            rpc,
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
fn log_rpc(instance_id: &str, rpc: Rpc, result: &RpcResult, latency_ms: f64) {
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
