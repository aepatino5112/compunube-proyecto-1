//! Minimal HTTP listener for `GET /metrics`, separate from the gRPC port.

use std::{future::Future, sync::Arc, time::Duration};

use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    task::JoinSet,
};

use super::{Metrics, CONTENT_TYPE};

/// Longest request head accepted; a scrape request is a few hundred bytes.
const MAX_HEAD_BYTES: usize = 8 * 1024;
/// A client that does not finish its request head in time is dropped, so a
/// stalled connection cannot hold a task forever.
const HEAD_TIMEOUT: Duration = Duration::from_secs(5);
/// How long connections already being served may finish after the stop signal.
const SHUTDOWN_GRACE: Duration = Duration::from_secs(2);

/// Serves `GET /metrics` on `listener` until `stop` resolves. Connections are
/// answered one request each (`Connection: close`); Prometheus reconnects on
/// every scrape, so keep-alive buys nothing here.
pub async fn serve<S: Future<Output = ()>>(listener: TcpListener, metrics: Arc<Metrics>, stop: S) {
    let mut connections = JoinSet::new();
    tokio::pin!(stop);
    loop {
        tokio::select! {
            () = &mut stop => break,
            accepted = listener.accept() => match accepted {
                Ok((stream, _)) => {
                    connections.spawn(handle(stream, metrics.clone()));
                }
                Err(error) => {
                    // Typically EMFILE: log and keep serving instead of exiting.
                    tracing::warn!(%error, "metrics listener failed to accept a connection");
                }
            },
            Some(_) = connections.join_next(), if !connections.is_empty() => {}
        }
    }
    drop(listener);
    let drain = async { while connections.join_next().await.is_some() {} };
    if tokio::time::timeout(SHUTDOWN_GRACE, drain).await.is_err() {
        connections.abort_all();
    }
}

enum Head {
    Request { method: String, path: String },
    TooLarge,
    Malformed,
}

async fn read_head(stream: &mut TcpStream) -> Option<Head> {
    let mut buffer = Vec::with_capacity(512);
    let mut chunk = [0u8; 1024];
    loop {
        if let Some(end) = buffer.windows(4).position(|w| w == b"\r\n\r\n") {
            buffer.truncate(end);
            break;
        }
        if buffer.len() > MAX_HEAD_BYTES {
            return Some(Head::TooLarge);
        }
        match stream.read(&mut chunk).await {
            Ok(0) | Err(_) => return None,
            Ok(n) => buffer.extend_from_slice(&chunk[..n]),
        }
    }
    let text = String::from_utf8_lossy(&buffer);
    let mut parts = text.lines().next().unwrap_or_default().split_whitespace();
    match (parts.next(), parts.next()) {
        (Some(method), Some(target)) => Some(Head::Request {
            method: method.to_string(),
            path: target.split('?').next().unwrap_or_default().to_string(),
        }),
        _ => Some(Head::Malformed),
    }
}

fn response(status: &str, extra: &str, body: &str, with_body: bool) -> Vec<u8> {
    let mut out = format!(
        "HTTP/1.1 {status}\r\ncontent-length: {}\r\nconnection: close\r\n{extra}\r\n",
        body.len()
    )
    .into_bytes();
    if with_body {
        out.extend_from_slice(body.as_bytes());
    }
    out
}

async fn handle(mut stream: TcpStream, metrics: Arc<Metrics>) {
    let Ok(Some(head)) = tokio::time::timeout(HEAD_TIMEOUT, read_head(&mut stream)).await else {
        return;
    };
    let reply = match head {
        Head::TooLarge => response(
            "431 Request Header Fields Too Large",
            "content-type: text/plain\r\n",
            "request head too large\n",
            true,
        ),
        Head::Malformed => response(
            "400 Bad Request",
            "content-type: text/plain\r\n",
            "malformed request\n",
            true,
        ),
        Head::Request { method, path } if path == "/metrics" => match method.as_str() {
            "GET" | "HEAD" => response(
                "200 OK",
                &format!("content-type: {CONTENT_TYPE}\r\n"),
                &metrics.render(),
                method == "GET",
            ),
            _ => response(
                "405 Method Not Allowed",
                "allow: GET, HEAD\r\ncontent-type: text/plain\r\n",
                "method not allowed\n",
                true,
            ),
        },
        Head::Request { .. } => response(
            "404 Not Found",
            "content-type: text/plain\r\n",
            "not found\n",
            true,
        ),
    };
    let _ = stream.write_all(&reply).await;
    let _ = stream.shutdown().await;
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::TcpStream,
        sync::oneshot,
    };

    async fn get(addr: std::net::SocketAddr, request: &str) -> String {
        let mut stream = TcpStream::connect(addr).await.unwrap();
        stream.write_all(request.as_bytes()).await.unwrap();
        let mut out = Vec::new();
        stream.read_to_end(&mut out).await.unwrap();
        String::from_utf8(out).unwrap()
    }

    #[tokio::test]
    async fn serves_prometheus_text_on_metrics_only() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let metrics = Arc::new(Metrics::new("rust-9"));
        let (stop, stop_rx) = oneshot::channel::<()>();
        let task = tokio::spawn(serve(listener, metrics, async {
            let _ = stop_rx.await;
        }));

        let ok = get(addr, "GET /metrics HTTP/1.1\r\nHost: x\r\n\r\n").await;
        assert!(ok.starts_with("HTTP/1.1 200 OK\r\n"), "{ok}");
        assert!(
            ok.contains("content-type: text/plain; version=0.0.4"),
            "{ok}"
        );
        assert!(ok.contains(r#"instance_id="rust-9""#));

        let query = get(addr, "GET /metrics?x=1 HTTP/1.1\r\nHost: x\r\n\r\n").await;
        assert!(query.starts_with("HTTP/1.1 200 OK\r\n"));
        let missing = get(addr, "GET / HTTP/1.1\r\nHost: x\r\n\r\n").await;
        assert!(missing.starts_with("HTTP/1.1 404 "), "{missing}");
        let wrong = get(addr, "POST /metrics HTTP/1.1\r\nHost: x\r\n\r\n").await;
        assert!(wrong.starts_with("HTTP/1.1 405 "), "{wrong}");
        assert!(wrong.contains("allow: GET, HEAD"));
        let head = get(addr, "HEAD /metrics HTTP/1.1\r\nHost: x\r\n\r\n").await;
        assert!(head.starts_with("HTTP/1.1 200 OK\r\n"));
        assert!(!head.contains("player_profile_up"));

        let malformed = get(addr, "\r\n\r\n").await;
        assert!(malformed.starts_with("HTTP/1.1 400 "), "{malformed}");
        // One byte over the limit and no blank line: the server stops reading
        // exactly there, so no unread bytes turn its close into a reset.
        let prefix = "GET /metrics HTTP/1.1\r\nx-pad: ";
        let oversized = format!("{prefix}{}", "a".repeat(MAX_HEAD_BYTES + 1 - prefix.len()));
        let rejected = get(addr, &oversized).await;
        assert!(rejected.starts_with("HTTP/1.1 431 "), "{rejected}");

        let _ = stop.send(());
        task.await.unwrap();
        assert!(
            TcpStream::connect(addr).await.is_err(),
            "listener must be closed"
        );
    }
}
