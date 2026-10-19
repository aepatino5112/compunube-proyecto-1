use player_profile_service::{config::Config, logging, runtime};
use tracing::Instrument;

#[tokio::main]
async fn main() {
    logging::init();

    let config = match Config::from_env() {
        Ok(config) => config,
        Err(error) => {
            tracing::error!(%error, "invalid configuration");
            std::process::exit(2);
        }
    };

    let span = logging::root_span(&config.instance_id);
    let result = async {
        tracing::info!(
            listen_addr = %config.service_addr,
            metrics_addr = %config.metrics_addr,
            database_configured = config.database.url.is_some(),
            pool_max_connections = config.database.pool.max_connections,
            "starting player/profile service"
        );
        runtime::run(config).await
    }
    .instrument(span.clone())
    .await;

    if let Err(error) = result {
        span.in_scope(|| tracing::error!(%error, "service terminated with an error"));
        std::process::exit(1);
    }
}
