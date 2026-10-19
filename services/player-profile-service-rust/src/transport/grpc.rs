use std::sync::Arc;

use tonic::{Request, Response, Status};

use super::error::status_from;
use crate::{
    application::{
        ExchangeMaterialsCommand, GetCatalogCommand, GetProfileCommand, ItemCommand,
        PlayerProfileApp, SetAppearanceCommand, SettleRaceCommand,
    },
    pb::{
        player_profile_service_server::{PlayerProfileService, PlayerProfileServiceServer},
        BuyItemRequest, CraftItemRequest, EquipItemRequest, ExchangeMaterialsRequest,
        GetCatalogRequest, GetCatalogResponse, GetProfileRequest, GetProfileResponse,
        ProfileMutationResponse, SetAppearanceRequest, SettleRaceRequest, SettleRaceResponse,
    },
};

/// Tonic adapter for `compunube.player.v1.PlayerProfileService`.
pub struct PlayerProfileGrpc {
    app: Arc<PlayerProfileApp>,
}

impl PlayerProfileGrpc {
    pub fn new(app: Arc<PlayerProfileApp>) -> Self {
        Self { app }
    }

    pub fn into_server(self) -> PlayerProfileServiceServer<Self> {
        PlayerProfileServiceServer::new(self)
    }
}

impl From<BuyItemRequest> for ItemCommand {
    fn from(r: BuyItemRequest) -> Self {
        Self {
            player_id: r.player_id,
            request_id: r.request_id,
            catalog_version: r.catalog_version,
            item_id: r.item_id,
        }
    }
}

impl From<CraftItemRequest> for ItemCommand {
    fn from(r: CraftItemRequest) -> Self {
        Self {
            player_id: r.player_id,
            request_id: r.request_id,
            catalog_version: r.catalog_version,
            item_id: r.item_id,
        }
    }
}

impl From<EquipItemRequest> for ItemCommand {
    fn from(r: EquipItemRequest) -> Self {
        Self {
            player_id: r.player_id,
            request_id: r.request_id,
            catalog_version: r.catalog_version,
            item_id: r.item_id,
        }
    }
}

/// Success is `Infallible` until F52, so the `Ok` arm cannot be reached; this
/// keeps the handlers exhaustive without inventing responses.
// `Status` is the error type mandated by the generated tonic trait.
#[allow(clippy::result_large_err)]
fn respond<T>(
    result: Result<std::convert::Infallible, crate::application::ApplicationError>,
) -> Result<Response<T>, Status> {
    match result {
        Ok(never) => match never {},
        Err(error) => Err(status_from(&error)),
    }
}

#[tonic::async_trait]
impl PlayerProfileService for PlayerProfileGrpc {
    async fn get_profile(
        &self,
        request: Request<GetProfileRequest>,
    ) -> Result<Response<GetProfileResponse>, Status> {
        let command = GetProfileCommand {
            player_id: request.into_inner().player_id,
        };
        respond(self.app.get_profile(command).await)
    }

    async fn get_catalog(
        &self,
        request: Request<GetCatalogRequest>,
    ) -> Result<Response<GetCatalogResponse>, Status> {
        let command = GetCatalogCommand {
            catalog_version: request.into_inner().catalog_version,
        };
        respond(self.app.get_catalog(command).await)
    }

    async fn buy_item(
        &self,
        request: Request<BuyItemRequest>,
    ) -> Result<Response<ProfileMutationResponse>, Status> {
        respond(self.app.buy_item(request.into_inner().into()).await)
    }

    async fn craft_item(
        &self,
        request: Request<CraftItemRequest>,
    ) -> Result<Response<ProfileMutationResponse>, Status> {
        respond(self.app.craft_item(request.into_inner().into()).await)
    }

    async fn exchange_materials(
        &self,
        request: Request<ExchangeMaterialsRequest>,
    ) -> Result<Response<ProfileMutationResponse>, Status> {
        let r = request.into_inner();
        let command = ExchangeMaterialsCommand {
            player_id: r.player_id,
            request_id: r.request_id,
            catalog_version: r.catalog_version,
            material: r.material,
            amount: r.amount,
        };
        respond(self.app.exchange_materials(command).await)
    }

    async fn equip_item(
        &self,
        request: Request<EquipItemRequest>,
    ) -> Result<Response<ProfileMutationResponse>, Status> {
        respond(self.app.equip_item(request.into_inner().into()).await)
    }

    async fn set_appearance(
        &self,
        request: Request<SetAppearanceRequest>,
    ) -> Result<Response<ProfileMutationResponse>, Status> {
        let r = request.into_inner();
        let command = SetAppearanceCommand {
            player_id: r.player_id,
            request_id: r.request_id,
            catalog_version: r.catalog_version,
            skin_id: r.skin_id,
            hair_color_id: r.hair_color_id,
        };
        respond(self.app.set_appearance(command).await)
    }

    async fn settle_race(
        &self,
        request: Request<SettleRaceRequest>,
    ) -> Result<Response<SettleRaceResponse>, Status> {
        let r = request.into_inner();
        let command = SettleRaceCommand {
            race_id: r.race_id,
            player_id: r.player_id,
            outcome: r.outcome,
            credited_plastic: r.credited_plastic,
            credited_metal: r.credited_metal,
        };
        respond(self.app.settle_race(command).await)
    }
}
