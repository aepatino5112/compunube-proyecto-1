use std::{env, net::SocketAddr};

use tonic::transport::Server;
use tonic_health::pb::health_check_response::ServingStatus;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let addr: SocketAddr = env::var("SERVICE_ADDR")
        .unwrap_or_else(|_| "0.0.0.0:50051".to_string())
        .parse()?;

    let instance_id = env::var("INSTANCE_ID").unwrap_or_else(|_| "rust-local".to_string());

    let (mut reporter, health_service) = tonic_health::server::health_reporter();
    reporter
        .set_service_status("player_profile", ServingStatus::Serving)
        .await;

    println!("player/profile service {instance_id} listening on {addr}");

    Server::builder()
        .add_service(health_service)
        .serve_with_shutdown(addr, async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await?;

    Ok(())
}
