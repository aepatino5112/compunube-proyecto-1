use sqlx::Error;

use crate::repository::RepositoryError;

/// Maps a driver error onto the storage categories the application and
/// transport layers understand (E43: UNAVAILABLE / RESOURCE_EXHAUSTED / INTERNAL).
pub fn map_sqlx_error(error: &Error) -> RepositoryError {
    match error {
        Error::PoolTimedOut => RepositoryError::PoolExhausted,
        Error::Io(_) | Error::Tls(_) | Error::PoolClosed | Error::WorkerCrashed => {
            RepositoryError::Unavailable
        }
        Error::Database(db) => match db.code().as_deref() {
            // too_many_connections
            Some("53300") => RepositoryError::PoolExhausted,
            // connection_exception class, admin_shutdown / crash_shutdown /
            // cannot_connect_now
            Some(code) if code.starts_with("08") || matches!(code, "57P01" | "57P02" | "57P03") => {
                RepositoryError::Unavailable
            }
            _ => RepositoryError::Unexpected(describe_sqlx_error(error)),
        },
        other => RepositoryError::Unexpected(describe_sqlx_error(other)),
    }
}

/// Short, secret-free classification for logs. Driver messages are never
/// included because they can contain hosts, users or statement fragments.
pub fn describe_sqlx_error(error: &Error) -> String {
    match error {
        Error::Database(db) => match db.code() {
            Some(code) => format!("database error (sqlstate {code})"),
            None => "database error".to_string(),
        },
        Error::Io(_) => "connection i/o error".to_string(),
        Error::Tls(_) => "tls error".to_string(),
        Error::PoolTimedOut => "pool acquire timed out".to_string(),
        Error::PoolClosed => "pool closed".to_string(),
        Error::Configuration(_) => "configuration error".to_string(),
        Error::Protocol(_) => "protocol error".to_string(),
        _ => "unexpected database error".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transport_level_failures_map_to_unavailable() {
        let io = Error::Io(std::io::Error::new(
            std::io::ErrorKind::ConnectionRefused,
            "connect to postgres://user:secret@host failed",
        ));
        assert_eq!(map_sqlx_error(&io), RepositoryError::Unavailable);
        assert_eq!(
            map_sqlx_error(&Error::PoolClosed),
            RepositoryError::Unavailable
        );
    }

    #[test]
    fn saturated_pool_maps_to_pool_exhausted() {
        assert_eq!(
            map_sqlx_error(&Error::PoolTimedOut),
            RepositoryError::PoolExhausted
        );
    }

    #[test]
    fn descriptions_never_echo_driver_messages() {
        let io = Error::Io(std::io::Error::other("password=secret"));
        assert!(!describe_sqlx_error(&io).contains("secret"));
        let protocol = Error::Protocol("password=secret".into());
        assert!(!describe_sqlx_error(&protocol).contains("secret"));
        let unexpected = map_sqlx_error(&Error::RowNotFound);
        assert_eq!(
            unexpected,
            RepositoryError::Unexpected("unexpected database error".to_string())
        );
    }
}
