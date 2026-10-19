//! Environment-driven configuration.
//!
//! Required behaviour (F47 D4): a missing `DATABASE_URL` is *not* a
//! configuration error, the service still starts and reports `NOT_SERVING`.
//! Every other variable is optional with a default, and malformed values fail
//! fast. The database URL is wrapped in [`SecretString`] so neither `Debug`
//! nor `Display` can leak credentials into logs.

use std::{fmt, net::SocketAddr, time::Duration};

pub const DEFAULT_SERVICE_ADDR: &str = "0.0.0.0:50051";
pub const DEFAULT_METRICS_ADDR: &str = "0.0.0.0:9100";
pub const DEFAULT_INSTANCE_ID: &str = "rust-local";

const DEFAULT_POOL_MAX_CONNECTIONS: u32 = 10;
const DEFAULT_POOL_MIN_CONNECTIONS: u32 = 0;
const DEFAULT_POOL_ACQUIRE_TIMEOUT_MS: u64 = 3_000;
const DEFAULT_PROBE_INTERVAL_MS: u64 = 2_000;
const DEFAULT_PROBE_TIMEOUT_MS: u64 = 1_000;
const DEFAULT_DRAIN_TIMEOUT_MS: u64 = 8_000;

const MAX_POOL_CONNECTIONS: u32 = 256;
const MAX_DURATION_MS: u64 = 3_600_000;

/// A value that must never be printed.
#[derive(Clone, PartialEq, Eq)]
pub struct SecretString(String);

impl SecretString {
    pub fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }

    /// Returns the secret. Call sites must not log the result.
    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for SecretString {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("SecretString([REDACTED])")
    }
}

impl fmt::Display for SecretString {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("[REDACTED]")
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PoolConfig {
    pub max_connections: u32,
    pub min_connections: u32,
    pub acquire_timeout: Duration,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DatabaseConfig {
    /// `None` when `DATABASE_URL` is unset or blank.
    pub url: Option<SecretString>,
    pub pool: PoolConfig,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HealthConfig {
    pub probe_interval: Duration,
    pub probe_timeout: Duration,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ShutdownConfig {
    /// Upper bound for letting in-flight RPCs finish after the stop signal.
    pub drain_timeout: Duration,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Config {
    pub service_addr: SocketAddr,
    /// Prometheus listener (`GET /metrics`), separate from the gRPC port.
    pub metrics_addr: SocketAddr,
    pub instance_id: String,
    pub database: DatabaseConfig,
    pub health: HealthConfig,
    pub shutdown: ShutdownConfig,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConfigError {
    pub variable: &'static str,
    pub reason: String,
}

impl fmt::Display for ConfigError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "invalid {}: {}", self.variable, self.reason)
    }
}

impl std::error::Error for ConfigError {}

impl Config {
    pub fn from_env() -> Result<Self, ConfigError> {
        Self::from_lookup(|name| std::env::var(name).ok())
    }

    /// Builds the configuration from an arbitrary variable source so tests do
    /// not have to mutate the process environment.
    pub fn from_lookup<F>(lookup: F) -> Result<Self, ConfigError>
    where
        F: Fn(&str) -> Option<String>,
    {
        let get = |name: &str| {
            lookup(name)
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
        };

        let service_addr = get("SERVICE_ADDR")
            .unwrap_or_else(|| DEFAULT_SERVICE_ADDR.to_string())
            .parse::<SocketAddr>()
            .map_err(|_| ConfigError {
                variable: "SERVICE_ADDR",
                reason: "expected host:port such as 0.0.0.0:50051".to_string(),
            })?;

        let metrics_addr = get("METRICS_ADDR")
            .unwrap_or_else(|| DEFAULT_METRICS_ADDR.to_string())
            .parse::<SocketAddr>()
            .map_err(|_| ConfigError {
                variable: "METRICS_ADDR",
                reason: "expected host:port such as 0.0.0.0:9100".to_string(),
            })?;
        if metrics_addr == service_addr {
            return Err(ConfigError {
                variable: "METRICS_ADDR",
                reason: "must differ from SERVICE_ADDR".to_string(),
            });
        }

        let instance_id = get("INSTANCE_ID").unwrap_or_else(|| DEFAULT_INSTANCE_ID.to_string());

        let max_connections = parse_u32(
            &get,
            "DB_POOL_MAX_CONNECTIONS",
            DEFAULT_POOL_MAX_CONNECTIONS,
        )?;
        let min_connections = parse_u32(
            &get,
            "DB_POOL_MIN_CONNECTIONS",
            DEFAULT_POOL_MIN_CONNECTIONS,
        )?;
        if !(1..=MAX_POOL_CONNECTIONS).contains(&max_connections) {
            return Err(ConfigError {
                variable: "DB_POOL_MAX_CONNECTIONS",
                reason: format!("must be between 1 and {MAX_POOL_CONNECTIONS}"),
            });
        }
        if min_connections > max_connections {
            return Err(ConfigError {
                variable: "DB_POOL_MIN_CONNECTIONS",
                reason: "must not exceed DB_POOL_MAX_CONNECTIONS".to_string(),
            });
        }

        let acquire_timeout = parse_millis(
            &get,
            "DB_POOL_ACQUIRE_TIMEOUT_MS",
            DEFAULT_POOL_ACQUIRE_TIMEOUT_MS,
        )?;
        let probe_interval =
            parse_millis(&get, "HEALTH_PROBE_INTERVAL_MS", DEFAULT_PROBE_INTERVAL_MS)?;
        let probe_timeout =
            parse_millis(&get, "HEALTH_PROBE_TIMEOUT_MS", DEFAULT_PROBE_TIMEOUT_MS)?;
        let drain_timeout =
            parse_millis(&get, "SHUTDOWN_DRAIN_TIMEOUT_MS", DEFAULT_DRAIN_TIMEOUT_MS)?;

        Ok(Self {
            service_addr,
            metrics_addr,
            instance_id,
            database: DatabaseConfig {
                url: get("DATABASE_URL").map(SecretString::new),
                pool: PoolConfig {
                    max_connections,
                    min_connections,
                    acquire_timeout,
                },
            },
            health: HealthConfig {
                probe_interval,
                probe_timeout,
            },
            shutdown: ShutdownConfig { drain_timeout },
        })
    }
}

fn parse_u32(
    get: &impl Fn(&str) -> Option<String>,
    name: &'static str,
    default: u32,
) -> Result<u32, ConfigError> {
    match get(name) {
        None => Ok(default),
        Some(raw) => raw.parse::<u32>().map_err(|_| ConfigError {
            variable: name,
            reason: "expected a non-negative integer".to_string(),
        }),
    }
}

fn parse_millis(
    get: &impl Fn(&str) -> Option<String>,
    name: &'static str,
    default_ms: u64,
) -> Result<Duration, ConfigError> {
    let millis = match get(name) {
        None => default_ms,
        Some(raw) => raw.parse::<u64>().map_err(|_| ConfigError {
            variable: name,
            reason: "expected an integer number of milliseconds".to_string(),
        })?,
    };
    if millis == 0 || millis > MAX_DURATION_MS {
        return Err(ConfigError {
            variable: name,
            reason: format!("must be between 1 and {MAX_DURATION_MS} milliseconds"),
        });
    }
    Ok(Duration::from_millis(millis))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn load(pairs: &[(&str, &str)]) -> Result<Config, ConfigError> {
        let map: HashMap<String, String> = pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        Config::from_lookup(|name| map.get(name).cloned())
    }

    #[test]
    fn defaults_apply_when_nothing_is_set() {
        let config = load(&[]).unwrap();
        assert_eq!(config.service_addr, "0.0.0.0:50051".parse().unwrap());
        assert_eq!(config.metrics_addr, "0.0.0.0:9100".parse().unwrap());
        assert_eq!(config.instance_id, "rust-local");
        assert!(config.database.url.is_none());
        assert_eq!(config.database.pool.max_connections, 10);
        assert_eq!(config.database.pool.min_connections, 0);
        assert_eq!(
            config.database.pool.acquire_timeout,
            Duration::from_millis(3_000)
        );
        assert_eq!(config.health.probe_interval, Duration::from_millis(2_000));
        assert_eq!(config.health.probe_timeout, Duration::from_millis(1_000));
        assert_eq!(config.shutdown.drain_timeout, Duration::from_millis(8_000));
    }

    #[test]
    fn explicit_values_override_defaults() {
        let config = load(&[
            ("SERVICE_ADDR", "127.0.0.1:6000"),
            ("METRICS_ADDR", "127.0.0.1:6100"),
            ("INSTANCE_ID", "rust-2"),
            ("DATABASE_URL", "postgres://u:p@db:5432/app"),
            ("DB_POOL_MAX_CONNECTIONS", "4"),
            ("DB_POOL_MIN_CONNECTIONS", "2"),
            ("DB_POOL_ACQUIRE_TIMEOUT_MS", "500"),
            ("HEALTH_PROBE_INTERVAL_MS", "250"),
            ("HEALTH_PROBE_TIMEOUT_MS", "100"),
            ("SHUTDOWN_DRAIN_TIMEOUT_MS", "1500"),
        ])
        .unwrap();
        assert_eq!(config.service_addr.port(), 6000);
        assert_eq!(config.metrics_addr.port(), 6100);
        assert_eq!(config.instance_id, "rust-2");
        assert_eq!(
            config.database.url.as_ref().unwrap().expose(),
            "postgres://u:p@db:5432/app"
        );
        assert_eq!(config.database.pool.max_connections, 4);
        assert_eq!(config.database.pool.min_connections, 2);
        assert_eq!(
            config.database.pool.acquire_timeout,
            Duration::from_millis(500)
        );
        assert_eq!(config.health.probe_interval, Duration::from_millis(250));
        assert_eq!(config.health.probe_timeout, Duration::from_millis(100));
        assert_eq!(config.shutdown.drain_timeout, Duration::from_millis(1_500));
    }

    #[test]
    fn blank_values_are_treated_as_unset() {
        let config = load(&[
            ("SERVICE_ADDR", "  "),
            ("METRICS_ADDR", " "),
            ("INSTANCE_ID", ""),
            ("DATABASE_URL", "   "),
        ])
        .unwrap();
        assert_eq!(config.instance_id, DEFAULT_INSTANCE_ID);
        assert_eq!(config.metrics_addr.to_string(), DEFAULT_METRICS_ADDR);
        assert!(config.database.url.is_none());
    }

    #[test]
    fn invalid_values_name_the_variable() {
        let cases: &[(&str, &str)] = &[
            ("SERVICE_ADDR", "not-an-addr"),
            ("METRICS_ADDR", "9100"),
            ("DB_POOL_MAX_CONNECTIONS", "abc"),
            ("DB_POOL_MAX_CONNECTIONS", "0"),
            ("DB_POOL_MAX_CONNECTIONS", "100000"),
            ("DB_POOL_MIN_CONNECTIONS", "-1"),
            ("DB_POOL_ACQUIRE_TIMEOUT_MS", "0"),
            ("HEALTH_PROBE_INTERVAL_MS", "soon"),
            ("HEALTH_PROBE_TIMEOUT_MS", "99999999999"),
            ("SHUTDOWN_DRAIN_TIMEOUT_MS", "0"),
        ];
        for (name, value) in cases {
            let error = load(&[(name, value)]).unwrap_err();
            assert_eq!(&error.variable, name, "{name}={value}");
        }
    }

    #[test]
    fn metrics_listener_must_not_share_the_grpc_address() {
        let error = load(&[
            ("SERVICE_ADDR", "0.0.0.0:7000"),
            ("METRICS_ADDR", "0.0.0.0:7000"),
        ])
        .unwrap_err();
        assert_eq!(error.variable, "METRICS_ADDR");
    }

    #[test]
    fn min_connections_cannot_exceed_max() {
        let error = load(&[
            ("DB_POOL_MAX_CONNECTIONS", "2"),
            ("DB_POOL_MIN_CONNECTIONS", "3"),
        ])
        .unwrap_err();
        assert_eq!(error.variable, "DB_POOL_MIN_CONNECTIONS");
    }

    #[test]
    fn database_url_never_appears_in_debug_or_display() {
        let secret = "s3cr3t-passw0rd";
        let url = format!("postgres://user:{secret}@db:5432/app");
        let config = load(&[("DATABASE_URL", url.as_str())]).unwrap();

        let rendered = format!("{config:?} {:#?}", config.database);
        assert!(!rendered.contains(secret), "{rendered}");
        assert!(!rendered.contains("postgres://"), "{rendered}");
        assert!(rendered.contains("REDACTED"));

        let secret_value = config.database.url.unwrap();
        assert!(!format!("{secret_value}").contains(secret));
        assert!(!format!("{secret_value:?}").contains(secret));
    }

    #[test]
    fn config_errors_never_echo_the_database_url() {
        let secret = "s3cr3t-passw0rd";
        let url = format!("postgres://user:{secret}@db:5432/app");
        let error = load(&[
            ("DATABASE_URL", url.as_str()),
            ("DB_POOL_MAX_CONNECTIONS", "zero"),
        ])
        .unwrap_err();
        assert!(!error.to_string().contains(secret));
    }
}
