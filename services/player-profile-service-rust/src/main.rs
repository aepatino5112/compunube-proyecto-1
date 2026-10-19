use player_profile_service::{config::Config, logging};
use tonic::transport::Server;
use tonic_health::ServingStatus;
use tracing::Instrument;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    logging::init();

    let config = match Config::from_env() {
        Ok(config) => config,
        Err(error) => {
            tracing::error!(%error, "invalid configuration");
            std::process::exit(2);
        }
    };

    let span = logging::root_span(&config.instance_id);
    async move {
        let (mut reporter, health_service) = tonic_health::server::health_reporter();
        reporter
            .set_service_status("player_profile", ServingStatus::Serving)
            .await;

        tracing::info!(
            listen_addr = %config.service_addr,
            database_configured = config.database.url.is_some(),
            "player/profile service listening"
        );

        Server::builder()
            .add_service(health_service)
            .serve_with_shutdown(config.service_addr, async {
                let _ = tokio::signal::ctrl_c().await;
            })
            .await?;

        Ok(())
    }
    .instrument(span)
    .await
}
