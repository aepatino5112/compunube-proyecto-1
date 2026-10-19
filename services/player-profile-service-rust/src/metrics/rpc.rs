//! Closed vocabularies for the RPC series: which RPC, what happened and why.
//!
//! The `code` label is built only from enums (business rejection codes and
//! gRPC status names), never from request data or error messages, so its
//! cardinality is bounded and it cannot carry secrets or player data.

use crate::{
    application::{
        ApplicationError, MutationOutcome, MutationResult, SettlementOutcome, SettlementResult,
    },
    domain::{MutationRejection, SettlementRejection},
};

/// The eight RPCs of `compunube.player.v1.PlayerProfileService`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Rpc {
    GetProfile,
    GetCatalog,
    BuyItem,
    CraftItem,
    ExchangeMaterials,
    EquipItem,
    SetAppearance,
    SettleRace,
}

impl Rpc {
    pub const ALL: [Rpc; 8] = [
        Rpc::GetProfile,
        Rpc::GetCatalog,
        Rpc::BuyItem,
        Rpc::CraftItem,
        Rpc::ExchangeMaterials,
        Rpc::EquipItem,
        Rpc::SetAppearance,
        Rpc::SettleRace,
    ];

    /// The method name as declared in the proto contract.
    pub fn as_str(self) -> &'static str {
        match self {
            Rpc::GetProfile => "GetProfile",
            Rpc::GetCatalog => "GetCatalog",
            Rpc::BuyItem => "BuyItem",
            Rpc::CraftItem => "CraftItem",
            Rpc::ExchangeMaterials => "ExchangeMaterials",
            Rpc::EquipItem => "EquipItem",
            Rpc::SetAppearance => "SetAppearance",
            Rpc::SettleRace => "SettleRace",
        }
    }
}

/// What happened to a request, from the point of view of the operator.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    /// Executed now.
    Applied,
    /// A business rejection (the response body carries the code).
    Rejected,
    /// An earlier identical request already resolved it; nothing ran again.
    Replayed,
    /// The same idempotency key was reused with different data.
    Conflict,
    /// The RPC failed with a gRPC status (or was cancelled).
    Error,
}

impl Outcome {
    pub const ALL: [Outcome; 5] = [
        Outcome::Applied,
        Outcome::Rejected,
        Outcome::Replayed,
        Outcome::Conflict,
        Outcome::Error,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            Outcome::Applied => "applied",
            Outcome::Rejected => "rejected",
            Outcome::Replayed => "replayed",
            Outcome::Conflict => "conflict",
            Outcome::Error => "error",
        }
    }
}

/// Coarse failure class for logs and dashboards.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorClass {
    None,
    /// A well-formed request the business rules refused.
    Business,
    /// The caller sent something invalid or unknown.
    Client,
    /// The service or its storage failed or ran out of capacity or time.
    Server,
    /// The caller went away before the RPC finished.
    Cancelled,
}

impl ErrorClass {
    pub fn as_str(self) -> &'static str {
        match self {
            ErrorClass::None => "none",
            ErrorClass::Business => "business",
            ErrorClass::Client => "client",
            ErrorClass::Server => "server",
            ErrorClass::Cancelled => "cancelled",
        }
    }
}

const CODE_OK: &str = "OK";
const CODE_CANCELLED: &str = "CANCELLED";

/// gRPC status names the service can answer with, see `transport::error`.
const STATUS_CODES: [&str; 6] = [
    "INVALID_ARGUMENT",
    "NOT_FOUND",
    "DEADLINE_EXCEEDED",
    "RESOURCE_EXHAUSTED",
    "UNAVAILABLE",
    "INTERNAL",
];

/// Every value the `code` label can take.
pub fn allowed_codes() -> Vec<&'static str> {
    let mut codes = vec![CODE_OK, CODE_CANCELLED];
    codes.extend(STATUS_CODES);
    codes.extend(MutationRejection::ALL.map(MutationRejection::as_code));
    codes.extend(SettlementRejection::ALL.map(SettlementRejection::as_code));
    codes.sort_unstable();
    codes.dedup();
    codes
}

/// The classified end of one RPC. Built only through the constructors below,
/// so `code` always belongs to [`allowed_codes`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RpcResult {
    outcome: Outcome,
    code: &'static str,
    class: ErrorClass,
}

impl RpcResult {
    pub fn outcome(&self) -> Outcome {
        self.outcome
    }

    pub fn code(&self) -> &'static str {
        self.code
    }

    pub fn class(&self) -> ErrorClass {
        self.class
    }

    /// The RPC future was dropped before it finished.
    pub fn cancelled() -> Self {
        Self {
            outcome: Outcome::Error,
            code: CODE_CANCELLED,
            class: ErrorClass::Cancelled,
        }
    }

    /// A read RPC (profile, catalog): it either worked or failed.
    pub fn from_read<T>(result: &Result<T, ApplicationError>) -> Self {
        match result {
            Ok(_) => Self::ok(Outcome::Applied),
            Err(error) => Self::from_error(error),
        }
    }

    pub fn from_mutation(result: &Result<MutationResult, ApplicationError>) -> Self {
        match result {
            Err(error) => Self::from_error(error),
            Ok(result) => match &result.outcome {
                MutationOutcome::Applied { replayed, .. } => Self::ok(if *replayed {
                    Outcome::Replayed
                } else {
                    Outcome::Applied
                }),
                MutationOutcome::Rejected {
                    rejection,
                    replayed,
                } => Self::rejection(
                    rejection.as_code(),
                    *rejection == MutationRejection::IdempotencyConflict,
                    *replayed,
                ),
            },
        }
    }

    pub fn from_settlement(result: &Result<SettlementResult, ApplicationError>) -> Self {
        match result {
            Err(error) => Self::from_error(error),
            Ok(result) => match &result.outcome {
                SettlementOutcome::Applied { replayed, .. } => Self::ok(if *replayed {
                    Outcome::Replayed
                } else {
                    Outcome::Applied
                }),
                SettlementOutcome::Rejected {
                    rejection,
                    replayed,
                } => Self::rejection(
                    rejection.as_code(),
                    *rejection == SettlementRejection::Conflict,
                    *replayed,
                ),
            },
        }
    }

    fn ok(outcome: Outcome) -> Self {
        Self {
            outcome,
            code: CODE_OK,
            class: ErrorClass::None,
        }
    }

    fn rejection(code: &'static str, conflict: bool, replayed: bool) -> Self {
        let outcome = if conflict {
            Outcome::Conflict
        } else if replayed {
            Outcome::Replayed
        } else {
            Outcome::Rejected
        };
        Self {
            outcome,
            code,
            class: ErrorClass::Business,
        }
    }

    fn from_error(error: &ApplicationError) -> Self {
        let (code, class) = match error {
            ApplicationError::InvalidArgument(_) => ("INVALID_ARGUMENT", ErrorClass::Client),
            ApplicationError::NotFound(_) => ("NOT_FOUND", ErrorClass::Client),
            ApplicationError::DeadlineExceeded => ("DEADLINE_EXCEEDED", ErrorClass::Server),
            ApplicationError::ResourceExhausted => ("RESOURCE_EXHAUSTED", ErrorClass::Server),
            ApplicationError::Unavailable => ("UNAVAILABLE", ErrorClass::Server),
            ApplicationError::Internal(_) => ("INTERNAL", ErrorClass::Server),
        };
        Self {
            outcome: Outcome::Error,
            code,
            class,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{provisioning::initial_state, ProfileState};

    fn profile() -> ProfileState {
        initial_state("player")
    }

    fn mutation(outcome: MutationOutcome) -> Result<MutationResult, ApplicationError> {
        Ok(MutationResult {
            request_id: "req".into(),
            outcome,
        })
    }

    fn settlement(outcome: SettlementOutcome) -> Result<SettlementResult, ApplicationError> {
        Ok(SettlementResult {
            race_id: "race".into(),
            player_id: "player".into(),
            outcome,
        })
    }

    #[test]
    fn mutation_outcomes_are_classified() {
        let applied = RpcResult::from_mutation(&mutation(MutationOutcome::Applied {
            replayed: false,
            profile: profile(),
        }));
        assert_eq!(
            (applied.outcome(), applied.code()),
            (Outcome::Applied, "OK")
        );
        assert_eq!(applied.class(), ErrorClass::None);

        let replayed = RpcResult::from_mutation(&mutation(MutationOutcome::Applied {
            replayed: true,
            profile: profile(),
        }));
        assert_eq!(
            (replayed.outcome(), replayed.code()),
            (Outcome::Replayed, "OK")
        );

        let rejected = RpcResult::from_mutation(&mutation(MutationOutcome::Rejected {
            rejection: MutationRejection::InsufficientCoins,
            replayed: false,
        }));
        assert_eq!(rejected.outcome(), Outcome::Rejected);
        assert_eq!(rejected.code(), "INSUFFICIENT_COINS");
        assert_eq!(rejected.class(), ErrorClass::Business);

        let replayed_rejection = RpcResult::from_mutation(&mutation(MutationOutcome::Rejected {
            rejection: MutationRejection::NotOwned,
            replayed: true,
        }));
        assert_eq!(replayed_rejection.outcome(), Outcome::Replayed);
        assert_eq!(replayed_rejection.code(), "NOT_OWNED");

        let conflict = RpcResult::from_mutation(&mutation(MutationOutcome::Rejected {
            rejection: MutationRejection::IdempotencyConflict,
            replayed: false,
        }));
        assert_eq!(conflict.outcome(), Outcome::Conflict);
        assert_eq!(conflict.code(), "IDEMPOTENCY_CONFLICT");
    }

    #[test]
    fn settlement_outcomes_are_classified() {
        let credited = RpcResult::from_settlement(&settlement(SettlementOutcome::Applied {
            replayed: false,
            profile: profile(),
        }));
        assert_eq!(credited.outcome(), Outcome::Applied);
        let replayed = RpcResult::from_settlement(&settlement(SettlementOutcome::Applied {
            replayed: true,
            profile: profile(),
        }));
        assert_eq!(replayed.outcome(), Outcome::Replayed);
        let conflict = RpcResult::from_settlement(&settlement(SettlementOutcome::Rejected {
            rejection: SettlementRejection::Conflict,
            replayed: false,
        }));
        assert_eq!(
            (conflict.outcome(), conflict.code()),
            (Outcome::Conflict, "CONFLICT")
        );
        let invalid = RpcResult::from_settlement(&settlement(SettlementOutcome::Rejected {
            rejection: SettlementRejection::InvalidSettlement,
            replayed: false,
        }));
        assert_eq!(
            (invalid.outcome(), invalid.code()),
            (Outcome::Rejected, "INVALID_SETTLEMENT")
        );
    }

    #[test]
    fn errors_map_to_status_names_and_classes_without_their_messages() {
        let cases = [
            (
                ApplicationError::InvalidArgument("postgres://u:pw@h/db".into()),
                "INVALID_ARGUMENT",
                ErrorClass::Client,
            ),
            (
                ApplicationError::NotFound("secret".into()),
                "NOT_FOUND",
                ErrorClass::Client,
            ),
            (
                ApplicationError::DeadlineExceeded,
                "DEADLINE_EXCEEDED",
                ErrorClass::Server,
            ),
            (
                ApplicationError::ResourceExhausted,
                "RESOURCE_EXHAUSTED",
                ErrorClass::Server,
            ),
            (
                ApplicationError::Unavailable,
                "UNAVAILABLE",
                ErrorClass::Server,
            ),
            (
                ApplicationError::Internal("SELECT * FROM player.profiles".into()),
                "INTERNAL",
                ErrorClass::Server,
            ),
        ];
        for (error, code, class) in cases {
            let result = RpcResult::from_read::<()>(&Err(error));
            assert_eq!(result.outcome(), Outcome::Error);
            assert_eq!(result.code(), code);
            assert_eq!(result.class(), class);
        }
        let cancelled = RpcResult::cancelled();
        assert_eq!(
            (cancelled.outcome(), cancelled.code()),
            (Outcome::Error, "CANCELLED")
        );
        assert_eq!(cancelled.class(), ErrorClass::Cancelled);
    }

    #[test]
    fn reads_succeed_as_applied() {
        let result = RpcResult::from_read(&Ok::<_, ApplicationError>(1));
        assert_eq!((result.outcome(), result.code()), (Outcome::Applied, "OK"));
    }

    #[test]
    fn every_reachable_code_belongs_to_the_closed_set() {
        let allowed = allowed_codes();
        let mut produced = vec![RpcResult::cancelled().code()];
        for rejection in MutationRejection::ALL {
            for replayed in [false, true] {
                produced.push(
                    RpcResult::from_mutation(&mutation(MutationOutcome::Rejected {
                        rejection,
                        replayed,
                    }))
                    .code(),
                );
            }
        }
        for rejection in SettlementRejection::ALL {
            produced.push(
                RpcResult::from_settlement(&settlement(SettlementOutcome::Rejected {
                    rejection,
                    replayed: false,
                }))
                .code(),
            );
        }
        for error in [
            ApplicationError::InvalidArgument(String::new()),
            ApplicationError::NotFound(String::new()),
            ApplicationError::DeadlineExceeded,
            ApplicationError::ResourceExhausted,
            ApplicationError::Unavailable,
            ApplicationError::Internal(String::new()),
        ] {
            produced.push(RpcResult::from_read::<()>(&Err(error)).code());
        }
        for code in produced {
            assert!(allowed.contains(&code), "{code} is not in the closed set");
        }
        // 9 mutation + 2 settlement + 6 status + OK + CANCELLED, with CONFLICT
        // and IDEMPOTENCY_CONFLICT distinct.
        assert_eq!(allowed.len(), 9 + 2 + 6 + 2);
    }

    #[test]
    fn vocabularies_are_complete_and_label_safe() {
        assert_eq!(Rpc::ALL.len(), 8);
        for name in Rpc::ALL
            .map(Rpc::as_str)
            .into_iter()
            .chain(Outcome::ALL.map(Outcome::as_str))
        {
            assert!(name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_'));
        }
    }
}
