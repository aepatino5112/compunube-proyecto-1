//! Application layer: one use case per RPC of `compunube.player.v1` (D29).
//!
//! The five mutations are implemented (F52); the remaining use cases are still
//! the F47 seams ([`std::convert::Infallible`] on purpose, so the compiler
//! points at every transport arm that must be mapped once they are built).
//!
//! This layer depends only on the repository *ports*, never on SQL, `sqlx` or
//! `tonic`.

use std::{convert::Infallible, fmt};

use crate::{
    domain::{
        validation::{validate_exchange_amount, validate_id, ValidationError},
        EconomicOperationRecord, Material, MutationIntent, MutationRejection, OperationStatus,
        ProfileState,
    },
    repository::{LockMode, Repositories, RepositoryError},
};

/// Failure categories the transport maps onto gRPC statuses (E43).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ApplicationError {
    /// Transitional seam: the use case is delivered by F52.
    NotImplemented(&'static str),
    InvalidArgument(String),
    NotFound(String),
    DeadlineExceeded,
    ResourceExhausted,
    Unavailable,
    /// Unexpected failure. The payload is for server-side logs only.
    Internal(String),
}

impl fmt::Display for ApplicationError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotImplemented(op) => write!(f, "{op} is not implemented"),
            Self::InvalidArgument(msg) => write!(f, "invalid argument: {msg}"),
            Self::NotFound(msg) => write!(f, "not found: {msg}"),
            Self::DeadlineExceeded => f.write_str("deadline exceeded"),
            Self::ResourceExhausted => f.write_str("resource exhausted"),
            Self::Unavailable => f.write_str("unavailable"),
            Self::Internal(detail) => write!(f, "internal error: {detail}"),
        }
    }
}

impl std::error::Error for ApplicationError {}

impl From<RepositoryError> for ApplicationError {
    fn from(error: RepositoryError) -> Self {
        match error {
            RepositoryError::Unavailable => Self::Unavailable,
            RepositoryError::PoolExhausted => Self::ResourceExhausted,
            RepositoryError::Timeout => Self::DeadlineExceeded,
            RepositoryError::Unexpected(detail) => Self::Internal(detail),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GetProfileCommand {
    pub player_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GetCatalogCommand {
    /// Empty means "active version".
    pub catalog_version: String,
}

/// Shared shape of buy, craft and equip: a player acts on one catalog item.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ItemCommand {
    pub player_id: String,
    pub request_id: String,
    pub catalog_version: String,
    pub item_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExchangeMaterialsCommand {
    pub player_id: String,
    pub request_id: String,
    pub catalog_version: String,
    pub material: Material,
    pub amount: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SetAppearanceCommand {
    pub player_id: String,
    pub request_id: String,
    pub catalog_version: String,
    pub skin_id: String,
    pub hair_color_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SettleRaceCommand {
    pub race_id: String,
    pub player_id: String,
    /// Raw wire value of `RaceOutcome`; decoding and validation belong to F52.
    pub outcome: i32,
    pub credited_plastic: u64,
    pub credited_metal: u64,
}

/// Business result of a profile mutation. Rejections are results, not errors:
/// the transport answers them with gRPC OK (E43).
// Short-lived value built once per request; boxing the profile would only add
// noise at every use site.
#[allow(clippy::large_enum_variant)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MutationOutcome {
    Applied {
        /// The request id was already resolved; nothing was applied again.
        replayed: bool,
        profile: ProfileState,
    },
    Rejected {
        rejection: MutationRejection,
        replayed: bool,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MutationResult {
    pub request_id: String,
    pub outcome: MutationOutcome,
}

/// Use cases of the Player/Profile Service.
pub struct PlayerProfileApp {
    repositories: Repositories,
}

type UseCaseResult = Result<Infallible, ApplicationError>;

fn invalid(error: ValidationError) -> ApplicationError {
    ApplicationError::InvalidArgument(error.to_string())
}

impl PlayerProfileApp {
    pub fn new(repositories: Repositories) -> Self {
        Self { repositories }
    }

    pub async fn get_profile(&self, _: GetProfileCommand) -> UseCaseResult {
        Err(ApplicationError::NotImplemented("GetProfile"))
    }

    pub async fn get_catalog(&self, _: GetCatalogCommand) -> UseCaseResult {
        Err(ApplicationError::NotImplemented("GetCatalog"))
    }

    pub async fn buy_item(&self, command: ItemCommand) -> Result<MutationResult, ApplicationError> {
        validate_id("item_id", &command.item_id).map_err(invalid)?;
        let intent = MutationIntent::Buy {
            item_id: command.item_id,
        };
        self.mutate(
            &command.player_id,
            &command.request_id,
            &command.catalog_version,
            intent,
        )
        .await
    }

    pub async fn craft_item(
        &self,
        command: ItemCommand,
    ) -> Result<MutationResult, ApplicationError> {
        validate_id("item_id", &command.item_id).map_err(invalid)?;
        let intent = MutationIntent::Craft {
            item_id: command.item_id,
        };
        self.mutate(
            &command.player_id,
            &command.request_id,
            &command.catalog_version,
            intent,
        )
        .await
    }

    pub async fn exchange_materials(
        &self,
        command: ExchangeMaterialsCommand,
    ) -> Result<MutationResult, ApplicationError> {
        validate_exchange_amount(command.amount).map_err(invalid)?;
        let intent = MutationIntent::Exchange {
            material: command.material,
            amount: command.amount,
        };
        self.mutate(
            &command.player_id,
            &command.request_id,
            &command.catalog_version,
            intent,
        )
        .await
    }

    pub async fn equip_item(
        &self,
        command: ItemCommand,
    ) -> Result<MutationResult, ApplicationError> {
        validate_id("item_id", &command.item_id).map_err(invalid)?;
        let intent = MutationIntent::Equip {
            item_id: command.item_id,
        };
        self.mutate(
            &command.player_id,
            &command.request_id,
            &command.catalog_version,
            intent,
        )
        .await
    }

    pub async fn set_appearance(
        &self,
        command: SetAppearanceCommand,
    ) -> Result<MutationResult, ApplicationError> {
        let intent = MutationIntent::SetAppearance {
            skin_id: command.skin_id,
            hair_color_id: command.hair_color_id,
        };
        self.mutate(
            &command.player_id,
            &command.request_id,
            &command.catalog_version,
            intent,
        )
        .await
    }

    pub async fn settle_race(&self, _: SettleRaceCommand) -> UseCaseResult {
        Err(ApplicationError::NotImplemented("SettleRace"))
    }

    /// The transactional frame shared by the five mutations:
    /// BEGIN -> lock profile (`FOR UPDATE`, lazily provisioned) -> idempotency
    /// lookup -> catalog -> validate -> apply -> record -> COMMIT.
    ///
    /// The lookup runs under the profile lock, so two replicas receiving the
    /// same `request_id` serialize: the second one finds the first one's record
    /// and replays it.
    async fn mutate(
        &self,
        player_id: &str,
        request_id: &str,
        catalog_version: &str,
        intent: MutationIntent,
    ) -> Result<MutationResult, ApplicationError> {
        validate_id("player_id", player_id).map_err(invalid)?;
        validate_id("request_id", request_id).map_err(invalid)?;
        let operation = intent.operation_type();
        let fingerprint = intent.fingerprint(catalog_version);

        let mut tx = self.repositories.transactions.begin().await?;
        let state = tx.lock_profile(player_id, LockMode::Update).await?;

        let outcome = if let Some(existing) = tx.find_operation(player_id, request_id).await? {
            replay(&existing, &fingerprint, state)
        } else {
            let catalog = tx.find_catalog(catalog_version).await?;
            let decision = match &catalog {
                None => Err(MutationRejection::InvalidCatalogVersion),
                Some(catalog) => intent.evaluate(&state, catalog),
            };
            let mut record = EconomicOperationRecord {
                player_id: player_id.to_string(),
                request_id: request_id.to_string(),
                operation_type: operation.to_string(),
                request_fingerprint: fingerprint,
                catalog_version: catalog.as_ref().map(|c| c.version.clone()),
                status: OperationStatus::Applied,
                rejection: None,
                profile_revision_after: None,
            };
            let outcome = match decision {
                Ok(effect) => {
                    let revision = tx.apply_effect(player_id, &effect).await?;
                    let mut profile = state;
                    effect.apply_to(&mut profile);
                    profile.revision = revision;
                    record.profile_revision_after = Some(revision);
                    MutationOutcome::Applied {
                        replayed: false,
                        profile,
                    }
                }
                Err(rejection) => {
                    // A rejection changes nothing and keeps the revision.
                    record.status = OperationStatus::Rejected;
                    record.rejection = Some(rejection);
                    record.profile_revision_after = Some(state.revision);
                    MutationOutcome::Rejected {
                        rejection,
                        replayed: false,
                    }
                }
            };
            tx.record_operation(&record).await?;
            outcome
        };
        tx.commit().await?;

        log_mutation(operation, player_id, request_id, &outcome);
        Ok(MutationResult {
            request_id: request_id.to_string(),
            outcome,
        })
    }
}

/// What a stored operation means for a request that reuses its `request_id`.
fn replay(
    existing: &EconomicOperationRecord,
    fingerprint: &str,
    current: ProfileState,
) -> MutationOutcome {
    if existing.request_fingerprint != fingerprint {
        // The stored record stays untouched; nothing is recorded for this call.
        return MutationOutcome::Rejected {
            rejection: MutationRejection::IdempotencyConflict,
            replayed: false,
        };
    }
    match (existing.status, existing.rejection) {
        (OperationStatus::Rejected, Some(rejection)) => MutationOutcome::Rejected {
            rejection,
            replayed: true,
        },
        // The profile is read under the lock, so it reflects every effect
        // committed so far, including the replayed operation's.
        _ => MutationOutcome::Applied {
            replayed: true,
            profile: current,
        },
    }
}

fn log_mutation(operation: &str, player_id: &str, request_id: &str, outcome: &MutationOutcome) {
    let (result, code, replayed) = match outcome {
        MutationOutcome::Applied { replayed, .. } => ("applied", "", *replayed),
        MutationOutcome::Rejected {
            rejection,
            replayed,
        } => ("rejected", rejection.as_code(), *replayed),
    };
    tracing::info!(
        operation,
        player_id,
        request_id,
        result,
        code,
        replayed,
        "mutation resolved"
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repository_errors_map_to_application_categories() {
        assert_eq!(
            ApplicationError::from(RepositoryError::Unavailable),
            ApplicationError::Unavailable
        );
        assert_eq!(
            ApplicationError::from(RepositoryError::PoolExhausted),
            ApplicationError::ResourceExhausted
        );
        assert_eq!(
            ApplicationError::from(RepositoryError::Timeout),
            ApplicationError::DeadlineExceeded
        );
        assert_eq!(
            ApplicationError::from(RepositoryError::Unexpected("boom".into())),
            ApplicationError::Internal("boom".into())
        );
    }

    fn item(player: &str, request: &str, item_id: &str) -> ItemCommand {
        ItemCommand {
            player_id: player.into(),
            request_id: request.into(),
            catalog_version: "online-v1".into(),
            item_id: item_id.into(),
        }
    }

    #[tokio::test]
    async fn malformed_requests_are_rejected_before_any_storage_access() {
        // Storage is unavailable: only a request that passes validation can
        // reach it and fail with Unavailable.
        let app = PlayerProfileApp::new(Repositories::unavailable());
        for command in [
            item("", "r", "manglar"),
            item("p", "", "manglar"),
            item("p", "r", ""),
            item(&"x".repeat(129), "r", "manglar"),
            item("p", "bad\nid", "manglar"),
        ] {
            for result in [
                app.buy_item(command.clone()).await,
                app.craft_item(command.clone()).await,
                app.equip_item(command.clone()).await,
            ] {
                assert!(
                    matches!(result, Err(ApplicationError::InvalidArgument(_))),
                    "{command:?}: {result:?}"
                );
            }
        }
        for amount in [0, 1_000_000_000] {
            let result = app
                .exchange_materials(ExchangeMaterialsCommand {
                    player_id: "p".into(),
                    request_id: "r".into(),
                    catalog_version: "online-v1".into(),
                    material: Material::Plastic,
                    amount,
                })
                .await;
            assert!(matches!(result, Err(ApplicationError::InvalidArgument(_))));
        }
        let appearance = app
            .set_appearance(SetAppearanceCommand {
                player_id: String::new(),
                request_id: "r".into(),
                catalog_version: "online-v1".into(),
                skin_id: "light".into(),
                hair_color_id: "blue".into(),
            })
            .await;
        assert!(matches!(
            appearance,
            Err(ApplicationError::InvalidArgument(_))
        ));
    }

    #[tokio::test]
    async fn valid_requests_reach_storage_and_surface_its_outage() {
        let app = PlayerProfileApp::new(Repositories::unavailable());
        assert_eq!(
            app.buy_item(item("p", "r", "manglar")).await,
            Err(ApplicationError::Unavailable)
        );
    }

    #[tokio::test]
    async fn remaining_use_cases_are_still_transitional_seams() {
        let app = PlayerProfileApp::new(Repositories::unavailable());
        let results = [
            app.get_profile(GetProfileCommand {
                player_id: "p".into(),
            })
            .await,
            app.get_catalog(GetCatalogCommand {
                catalog_version: String::new(),
            })
            .await,
            app.settle_race(SettleRaceCommand {
                race_id: "race".into(),
                player_id: "p".into(),
                outcome: 1,
                credited_plastic: 0,
                credited_metal: 0,
            })
            .await,
        ];
        for result in results {
            assert!(matches!(result, Err(ApplicationError::NotImplemented(_))));
        }
    }

    fn stored(
        status: OperationStatus,
        rejection: Option<MutationRejection>,
        fingerprint: &str,
    ) -> EconomicOperationRecord {
        EconomicOperationRecord {
            player_id: "p".into(),
            request_id: "r".into(),
            operation_type: "buy".into(),
            request_fingerprint: fingerprint.into(),
            catalog_version: Some("online-v1".into()),
            status,
            rejection,
            profile_revision_after: Some(2),
        }
    }

    #[test]
    fn replay_distinguishes_same_payload_conflict_and_stored_rejection() {
        let profile = crate::domain::provisioning::initial_state("p");
        assert_eq!(
            replay(
                &stored(OperationStatus::Applied, None, "fp"),
                "fp",
                profile.clone()
            ),
            MutationOutcome::Applied {
                replayed: true,
                profile: profile.clone()
            }
        );
        assert_eq!(
            replay(
                &stored(OperationStatus::Applied, None, "fp"),
                "other",
                profile.clone()
            ),
            MutationOutcome::Rejected {
                rejection: MutationRejection::IdempotencyConflict,
                replayed: false
            }
        );
        assert_eq!(
            replay(
                &stored(
                    OperationStatus::Rejected,
                    Some(MutationRejection::InsufficientCoins),
                    "fp"
                ),
                "fp",
                profile.clone()
            ),
            MutationOutcome::Rejected {
                rejection: MutationRejection::InsufficientCoins,
                replayed: true
            }
        );
        // a different payload conflicts even when the stored one was rejected
        assert_eq!(
            replay(
                &stored(
                    OperationStatus::Rejected,
                    Some(MutationRejection::InsufficientCoins),
                    "fp"
                ),
                "other",
                profile
            ),
            MutationOutcome::Rejected {
                rejection: MutationRejection::IdempotencyConflict,
                replayed: false
            }
        );
    }
}
