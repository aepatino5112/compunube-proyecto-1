//! Mapping from application failures to gRPC statuses, following the
//! "Errores" table of `proto/README.md` (E43). Business rejections travel in
//! the response body with status OK and are not handled here.
//!
//! Internal details (SQL, hosts, credentials) are never copied into a status
//! message; `INTERNAL` and `UNAVAILABLE` use fixed texts and the detail goes
//! to the server log.

use tonic::{Code, Status};

use crate::application::ApplicationError;

pub fn status_from(error: &ApplicationError) -> Status {
    match error {
        // Transitional (F47): E43 has no code for "not built yet"; UNIMPLEMENTED
        // is the standard gRPC answer and is removed together with the seams.
        ApplicationError::NotImplemented(operation) => Status::new(
            Code::Unimplemented,
            format!("{operation} is not implemented yet"),
        ),
        ApplicationError::InvalidArgument(message) => {
            Status::new(Code::InvalidArgument, message.clone())
        }
        ApplicationError::NotFound(message) => Status::new(Code::NotFound, message.clone()),
        ApplicationError::DeadlineExceeded => {
            Status::new(Code::DeadlineExceeded, "deadline exceeded")
        }
        ApplicationError::ResourceExhausted => {
            Status::new(Code::ResourceExhausted, "service capacity exhausted")
        }
        ApplicationError::Unavailable => {
            Status::new(Code::Unavailable, "service temporarily unavailable")
        }
        ApplicationError::Internal(detail) => {
            tracing::error!(detail = %detail, "internal error while handling rpc");
            Status::new(Code::Internal, "internal error")
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn follows_the_e43_status_table() {
        let cases = [
            (
                ApplicationError::InvalidArgument("player_id is required".into()),
                Code::InvalidArgument,
            ),
            (
                ApplicationError::NotFound("profile does not exist".into()),
                Code::NotFound,
            ),
            (ApplicationError::DeadlineExceeded, Code::DeadlineExceeded),
            (ApplicationError::ResourceExhausted, Code::ResourceExhausted),
            (ApplicationError::Unavailable, Code::Unavailable),
            (ApplicationError::Internal("x".into()), Code::Internal),
            (
                ApplicationError::NotImplemented("BuyItem"),
                Code::Unimplemented,
            ),
        ];
        for (error, code) in cases {
            assert_eq!(status_from(&error).code(), code, "{error}");
        }
    }

    #[test]
    fn internal_details_do_not_reach_the_status_message() {
        let status = status_from(&ApplicationError::Internal(
            "SELECT * FROM player.profiles failed for host db:5432".into(),
        ));
        assert_eq!(status.message(), "internal error");
        assert!(!status.message().contains("SELECT"));
    }

    #[test]
    fn client_facing_messages_are_preserved_for_argument_and_lookup_errors() {
        let status = status_from(&ApplicationError::NotFound("catalog version v9".into()));
        assert_eq!(status.message(), "catalog version v9");
    }
}
