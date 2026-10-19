use std::sync::Arc;

use tonic::{Request, Response, Status};

use super::{
    error::status_from,
    mapping::{
        catalog_to_pb, decode_material, decode_outcome, mutation_response, profile_to_pb,
        settlement_response,
    },
    observe::RpcObserver,
};
use crate::{
    application::{
        ApplicationError, ExchangeMaterialsCommand, GetCatalogCommand, GetProfileCommand,
        ItemCommand, MutationResult, PlayerProfileApp, SetAppearanceCommand, SettleRaceCommand,
    },
    config::DEFAULT_INSTANCE_ID,
    metrics::{
        rpc::{Rpc, RpcResult},
        Metrics,
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
    observer: RpcObserver,
}

impl PlayerProfileGrpc {
    /// An adapter with a detached metrics registry (nothing scrapes it).
    pub fn new(app: Arc<PlayerProfileApp>) -> Self {
        Self::with_metrics(app, Arc::new(Metrics::new(DEFAULT_INSTANCE_ID)))
    }

    /// An adapter that reports every RPC to `metrics` and to the request log.
    pub fn with_metrics(app: Arc<PlayerProfileApp>, metrics: Arc<Metrics>) -> Self {
        Self {
            app,
            observer: RpcObserver::new(metrics),
        }
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

#[allow(clippy::result_large_err)]
fn respond_mutation(
    result: Result<MutationResult, ApplicationError>,
) -> Result<Response<ProfileMutationResponse>, Status> {
    result
        .map(|result| Response::new(mutation_response(result)))
        .map_err(|error| status_from(&error))
}

#[tonic::async_trait]
impl PlayerProfileService for PlayerProfileGrpc {
    async fn get_profile(
        &self,
        request: Request<GetProfileRequest>,
    ) -> Result<Response<GetProfileResponse>, Status> {
        let call = self.observer.start(Rpc::GetProfile);
        let command = GetProfileCommand {
            player_id: request.into_inner().player_id,
        };
        let result = self.app.get_profile(command).await;
        call.finish(RpcResult::from_read(&result));
        result
            .map(|profile| {
                Response::new(GetProfileResponse {
                    profile: Some(profile_to_pb(&profile)),
                })
            })
            .map_err(|error| status_from(&error))
    }

    async fn get_catalog(
        &self,
        request: Request<GetCatalogRequest>,
    ) -> Result<Response<GetCatalogResponse>, Status> {
        let call = self.observer.start(Rpc::GetCatalog);
        let command = GetCatalogCommand {
            catalog_version: request.into_inner().catalog_version,
        };
        let result = self.app.get_catalog(command).await;
        call.finish(RpcResult::from_read(&result));
        result
            .map(|catalog| Response::new(catalog_to_pb(&catalog)))
            .map_err(|error| status_from(&error))
    }

    async fn buy_item(
        &self,
        request: Request<BuyItemRequest>,
    ) -> Result<Response<ProfileMutationResponse>, Status> {
        let call = self.observer.start(Rpc::BuyItem);
        let result = self.app.buy_item(request.into_inner().into()).await;
        call.finish(RpcResult::from_mutation(&result));
        respond_mutation(result)
    }

    async fn craft_item(
        &self,
        request: Request<CraftItemRequest>,
    ) -> Result<Response<ProfileMutationResponse>, Status> {
        let call = self.observer.start(Rpc::CraftItem);
        let result = self.app.craft_item(request.into_inner().into()).await;
        call.finish(RpcResult::from_mutation(&result));
        respond_mutation(result)
    }

    async fn exchange_materials(
        &self,
        request: Request<ExchangeMaterialsRequest>,
    ) -> Result<Response<ProfileMutationResponse>, Status> {
        let call = self.observer.start(Rpc::ExchangeMaterials);
        let r = request.into_inner();
        let result = match decode_material(r.material) {
            Ok(material) => {
                let command = ExchangeMaterialsCommand {
                    player_id: r.player_id,
                    request_id: r.request_id,
                    catalog_version: r.catalog_version,
                    material,
                    amount: r.amount,
                };
                self.app.exchange_materials(command).await
            }
            Err(error) => Err(error),
        };
        call.finish(RpcResult::from_mutation(&result));
        respond_mutation(result)
    }

    async fn equip_item(
        &self,
        request: Request<EquipItemRequest>,
    ) -> Result<Response<ProfileMutationResponse>, Status> {
        let call = self.observer.start(Rpc::EquipItem);
        let result = self.app.equip_item(request.into_inner().into()).await;
        call.finish(RpcResult::from_mutation(&result));
        respond_mutation(result)
    }

    async fn set_appearance(
        &self,
        request: Request<SetAppearanceRequest>,
    ) -> Result<Response<ProfileMutationResponse>, Status> {
        let call = self.observer.start(Rpc::SetAppearance);
        let r = request.into_inner();
        let command = SetAppearanceCommand {
            player_id: r.player_id,
            request_id: r.request_id,
            catalog_version: r.catalog_version,
            skin_id: r.skin_id,
            hair_color_id: r.hair_color_id,
        };
        let result = self.app.set_appearance(command).await;
        call.finish(RpcResult::from_mutation(&result));
        respond_mutation(result)
    }

    async fn settle_race(
        &self,
        request: Request<SettleRaceRequest>,
    ) -> Result<Response<SettleRaceResponse>, Status> {
        let call = self.observer.start(Rpc::SettleRace);
        let r = request.into_inner();
        let result = match decode_outcome(r.outcome) {
            Ok(outcome) => {
                let command = SettleRaceCommand {
                    race_id: r.race_id,
                    player_id: r.player_id,
                    outcome,
                    credited_plastic: r.credited_plastic,
                    credited_metal: r.credited_metal,
                };
                self.app.settle_race(command).await
            }
            Err(error) => Err(error),
        };
        call.finish(RpcResult::from_settlement(&result));
        result
            .map(|result| Response::new(settlement_response(result)))
            .map_err(|error| status_from(&error))
    }
}
