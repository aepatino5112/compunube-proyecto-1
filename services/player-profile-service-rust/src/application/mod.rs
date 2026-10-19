//! Application layer: one use case per RPC of `compunube.player.v1` (D29).
//!
//! F47 delivers the seams only. Every use case returns
//! [`ApplicationError::NotImplemented`] until F52 implements the economy and
//! profile rules. The success type is [`std::convert::Infallible`] on purpose:
//! no success value can exist yet, and when F52 replaces it with real result
//! types the compiler points at every transport arm that must be mapped.
//!
//! This layer depends only on the repository *ports*, never on SQL, `sqlx` or
//! `tonic`.

use std::{convert::Infallible, fmt};

use crate::repository::{Repositories, RepositoryError};

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
    /// Raw wire value of `Material`; decoding and validation belong to F52.
    pub material: i32,
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

/// Use cases of the Player/Profile Service.
pub struct PlayerProfileApp {
    #[allow(dead_code)] // consumed by the F52 use cases
    repositories: Repositories,
}

type UseCaseResult = Result<Infallible, ApplicationError>;

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

    pub async fn buy_item(&self, _: ItemCommand) -> UseCaseResult {
        Err(ApplicationError::NotImplemented("BuyItem"))
    }

    pub async fn craft_item(&self, _: ItemCommand) -> UseCaseResult {
        Err(ApplicationError::NotImplemented("CraftItem"))
    }

    pub async fn exchange_materials(&self, _: ExchangeMaterialsCommand) -> UseCaseResult {
        Err(ApplicationError::NotImplemented("ExchangeMaterials"))
    }

    pub async fn equip_item(&self, _: ItemCommand) -> UseCaseResult {
        Err(ApplicationError::NotImplemented("EquipItem"))
    }

    pub async fn set_appearance(&self, _: SetAppearanceCommand) -> UseCaseResult {
        Err(ApplicationError::NotImplemented("SetAppearance"))
    }

    pub async fn settle_race(&self, _: SettleRaceCommand) -> UseCaseResult {
        Err(ApplicationError::NotImplemented("SettleRace"))
    }
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

    #[tokio::test]
    async fn every_use_case_is_a_transitional_seam() {
        let app = PlayerProfileApp::new(Repositories::unavailable());
        let item = || ItemCommand {
            player_id: "p".into(),
            request_id: "r".into(),
            catalog_version: String::new(),
            item_id: "i".into(),
        };
        let results = [
            app.get_profile(GetProfileCommand {
                player_id: "p".into(),
            })
            .await,
            app.get_catalog(GetCatalogCommand {
                catalog_version: String::new(),
            })
            .await,
            app.buy_item(item()).await,
            app.craft_item(item()).await,
            app.exchange_materials(ExchangeMaterialsCommand {
                player_id: "p".into(),
                request_id: "r".into(),
                catalog_version: String::new(),
                material: 1,
                amount: 1,
            })
            .await,
            app.equip_item(item()).await,
            app.set_appearance(SetAppearanceCommand {
                player_id: "p".into(),
                request_id: "r".into(),
                catalog_version: String::new(),
                skin_id: "s".into(),
                hair_color_id: "h".into(),
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
        assert_eq!(results.len(), 8);
        for result in results {
            assert!(matches!(result, Err(ApplicationError::NotImplemented(_))));
        }
    }
}
