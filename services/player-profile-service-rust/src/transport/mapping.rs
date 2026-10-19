//! Pure translation between the wire messages and the application types.
//! Enum decoding lives here (an unknown or UNSPECIFIED value is a malformed
//! request, E43 `INVALID_ARGUMENT`); no rule and no storage is involved.

use crate::{
    application::{
        ApplicationError, MutationOutcome, MutationResult, SettlementOutcome, SettlementResult,
    },
    domain::{Material, MutationRejection, ProfileState, RaceOutcome, SettlementRejection},
    pb,
};

pub fn profile_to_pb(profile: &ProfileState) -> pb::PlayerProfile {
    pb::PlayerProfile {
        player_id: profile.player_id.clone(),
        profile_revision: profile.revision,
        coins: profile.coins,
        plastic: profile.plastic,
        metal: profile.metal,
        // BTreeSet iteration is sorted, so the response is deterministic.
        owned_item_ids: profile.owned_item_ids.iter().cloned().collect(),
        equipment: Some(pb::Equipment {
            board_id: profile.equipment.board_id.clone(),
            outfit_id: profile.equipment.outfit_id.clone(),
            net_id: profile.equipment.net_id.clone(),
            hair_id: profile.equipment.hair_id.clone(),
            character_id: profile.equipment.character_id.clone(),
        }),
        appearance: Some(pb::Appearance {
            skin_id: profile.appearance.skin_id.clone(),
            hair_color_id: profile.appearance.hair_color_id.clone(),
        }),
    }
}

pub fn rejection_code_to_pb(rejection: MutationRejection) -> pb::MutationRejectionCode {
    match rejection {
        MutationRejection::InvalidAction => {
            pb::MutationRejectionCode::MutationRejectionInvalidAction
        }
        MutationRejection::InvalidItem => pb::MutationRejectionCode::MutationRejectionInvalidItem,
        MutationRejection::InsufficientCoins => {
            pb::MutationRejectionCode::MutationRejectionInsufficientCoins
        }
        MutationRejection::InsufficientMaterials => {
            pb::MutationRejectionCode::MutationRejectionInsufficientMaterials
        }
        MutationRejection::NotOwned => pb::MutationRejectionCode::MutationRejectionNotOwned,
        MutationRejection::AlreadyOwned => pb::MutationRejectionCode::MutationRejectionAlreadyOwned,
        MutationRejection::InvalidAppearance => {
            pb::MutationRejectionCode::MutationRejectionInvalidAppearance
        }
        MutationRejection::IdempotencyConflict => {
            pb::MutationRejectionCode::MutationRejectionIdempotencyConflict
        }
        MutationRejection::InvalidCatalogVersion => {
            pb::MutationRejectionCode::MutationRejectionInvalidCatalogVersion
        }
    }
}

pub fn mutation_response(result: MutationResult) -> pb::ProfileMutationResponse {
    let outcome = match result.outcome {
        MutationOutcome::Applied { replayed, profile } => {
            pb::profile_mutation_response::Outcome::Success(pb::ProfileMutationSuccess {
                replayed,
                profile: Some(profile_to_pb(&profile)),
            })
        }
        MutationOutcome::Rejected {
            rejection,
            replayed,
        } => pb::profile_mutation_response::Outcome::Rejection(pb::ProfileMutationRejection {
            code: rejection_code_to_pb(rejection) as i32,
            message: rejection.message().to_string(),
            replayed,
        }),
    };
    pb::ProfileMutationResponse {
        request_id: result.request_id,
        outcome: Some(outcome),
    }
}

pub fn settlement_rejection_to_pb(rejection: SettlementRejection) -> pb::SettlementRejectionCode {
    match rejection {
        SettlementRejection::InvalidSettlement => {
            pb::SettlementRejectionCode::SettlementRejectionInvalidSettlement
        }
        SettlementRejection::Conflict => pb::SettlementRejectionCode::SettlementRejectionConflict,
    }
}

pub fn settlement_response(result: SettlementResult) -> pb::SettleRaceResponse {
    let outcome = match result.outcome {
        SettlementOutcome::Applied { replayed, profile } => {
            pb::settle_race_response::Outcome::Success(pb::SettlementSuccess {
                replayed,
                profile: Some(profile_to_pb(&profile)),
            })
        }
        SettlementOutcome::Rejected {
            rejection,
            replayed,
        } => pb::settle_race_response::Outcome::Rejection(pb::SettlementRejection {
            code: settlement_rejection_to_pb(rejection) as i32,
            message: rejection.message().to_string(),
            replayed,
        }),
    };
    pb::SettleRaceResponse {
        race_id: result.race_id,
        player_id: result.player_id,
        outcome: Some(outcome),
    }
}

pub fn decode_outcome(value: i32) -> Result<RaceOutcome, ApplicationError> {
    match pb::RaceOutcome::try_from(value) {
        Ok(pb::RaceOutcome::Finished) => Ok(RaceOutcome::Finished),
        Ok(pb::RaceOutcome::Disqualified) => Ok(RaceOutcome::Disqualified),
        Ok(pb::RaceOutcome::Left) => Ok(RaceOutcome::Left),
        Ok(pb::RaceOutcome::Dnf) => Ok(RaceOutcome::Dnf),
        Ok(pb::RaceOutcome::Unspecified) | Err(_) => Err(ApplicationError::InvalidArgument(
            "outcome is required".to_string(),
        )),
    }
}

pub fn decode_material(value: i32) -> Result<Material, ApplicationError> {
    match pb::Material::try_from(value) {
        Ok(pb::Material::Plastic) => Ok(Material::Plastic),
        Ok(pb::Material::Metal) => Ok(Material::Metal),
        Ok(pb::Material::Unspecified) | Err(_) => Err(ApplicationError::InvalidArgument(
            "material is required".to_string(),
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::provisioning::initial_state;

    #[test]
    fn profile_maps_every_field_and_sorts_owned_items() {
        let mut state = initial_state("p1");
        state.coins = 7;
        state.plastic = 8;
        state.metal = 9;
        state.revision = 4;
        let wire = profile_to_pb(&state);
        assert_eq!(wire.player_id, "p1");
        assert_eq!(wire.profile_revision, 4);
        assert_eq!((wire.coins, wire.plastic, wire.metal), (7, 8, 9));
        let mut sorted = wire.owned_item_ids.clone();
        sorted.sort();
        assert_eq!(wire.owned_item_ids, sorted);
        assert_eq!(wire.owned_item_ids.len(), 12);
        let equipment = wire.equipment.unwrap();
        assert_eq!(equipment.board_id, "coral");
        assert_eq!(equipment.character_id, "nico");
        let appearance = wire.appearance.unwrap();
        assert_eq!(appearance.skin_id, "medium");
        assert_eq!(appearance.hair_color_id, "brown");
    }

    #[test]
    fn every_domain_rejection_maps_to_the_contract_code_of_the_same_name() {
        for rejection in MutationRejection::ALL {
            let wire = rejection_code_to_pb(rejection);
            assert_ne!(wire, pb::MutationRejectionCode::Unspecified);
            assert_eq!(
                wire.as_str_name(),
                format!("MUTATION_REJECTION_{}", rejection.as_code())
            );
        }
    }

    #[test]
    fn applied_and_rejected_outcomes_use_the_matching_oneof_arm() {
        let profile = initial_state("p1");
        let applied = mutation_response(MutationResult {
            request_id: "r1".into(),
            outcome: MutationOutcome::Applied {
                replayed: true,
                profile,
            },
        });
        assert_eq!(applied.request_id, "r1");
        match applied.outcome.unwrap() {
            pb::profile_mutation_response::Outcome::Success(success) => {
                assert!(success.replayed);
                assert_eq!(success.profile.unwrap().player_id, "p1");
            }
            other => panic!("unexpected arm {other:?}"),
        }
        let rejected = mutation_response(MutationResult {
            request_id: "r2".into(),
            outcome: MutationOutcome::Rejected {
                rejection: MutationRejection::NotOwned,
                replayed: true,
            },
        });
        match rejected.outcome.unwrap() {
            pb::profile_mutation_response::Outcome::Rejection(rejection) => {
                assert_eq!(
                    rejection.code,
                    pb::MutationRejectionCode::MutationRejectionNotOwned as i32
                );
                assert!(rejection.replayed);
                assert!(!rejection.message.is_empty());
            }
            other => panic!("unexpected arm {other:?}"),
        }
    }

    #[test]
    fn settlement_rejections_map_to_the_contract_codes() {
        assert_eq!(
            settlement_rejection_to_pb(SettlementRejection::InvalidSettlement).as_str_name(),
            "SETTLEMENT_REJECTION_INVALID_SETTLEMENT"
        );
        assert_eq!(
            settlement_rejection_to_pb(SettlementRejection::Conflict).as_str_name(),
            "SETTLEMENT_REJECTION_CONFLICT"
        );
    }

    #[test]
    fn settlement_outcomes_use_the_matching_oneof_arm() {
        let applied = settlement_response(SettlementResult {
            race_id: "race".into(),
            player_id: "p1".into(),
            outcome: SettlementOutcome::Applied {
                replayed: false,
                profile: initial_state("p1"),
            },
        });
        assert_eq!(
            (applied.race_id.as_str(), applied.player_id.as_str()),
            ("race", "p1")
        );
        assert!(matches!(
            applied.outcome,
            Some(pb::settle_race_response::Outcome::Success(ref s)) if !s.replayed && s.profile.is_some()
        ));
        let rejected = settlement_response(SettlementResult {
            race_id: "race".into(),
            player_id: "p1".into(),
            outcome: SettlementOutcome::Rejected {
                rejection: SettlementRejection::Conflict,
                replayed: false,
            },
        });
        match rejected.outcome.unwrap() {
            pb::settle_race_response::Outcome::Rejection(r) => {
                assert_eq!(
                    r.code,
                    pb::SettlementRejectionCode::SettlementRejectionConflict as i32
                );
                assert!(!r.message.is_empty());
            }
            other => panic!("unexpected arm {other:?}"),
        }
    }

    #[test]
    fn outcome_decoding_covers_the_four_outcomes_and_rejects_the_rest() {
        assert_eq!(decode_outcome(1), Ok(RaceOutcome::Finished));
        assert_eq!(decode_outcome(2), Ok(RaceOutcome::Disqualified));
        assert_eq!(decode_outcome(3), Ok(RaceOutcome::Left));
        assert_eq!(decode_outcome(4), Ok(RaceOutcome::Dnf));
        for bad in [0, 5, -1] {
            assert!(
                matches!(
                    decode_outcome(bad),
                    Err(ApplicationError::InvalidArgument(_))
                ),
                "{bad}"
            );
        }
    }

    #[test]
    fn material_decoding_rejects_unspecified_and_unknown_values() {
        assert_eq!(decode_material(1), Ok(Material::Plastic));
        assert_eq!(decode_material(2), Ok(Material::Metal));
        for bad in [0, 3, -1, 99] {
            assert!(
                matches!(
                    decode_material(bad),
                    Err(ApplicationError::InvalidArgument(_))
                ),
                "{bad}"
            );
        }
    }
}
