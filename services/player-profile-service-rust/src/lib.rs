//! Player/Profile Service (Rust). See `docs/architecture/rust-player-profile-service.md`.

pub mod config;
pub mod logging;

/// Tonic stubs generated at build time from `proto/player_profile.proto`.
pub mod pb {
    #![allow(clippy::all, clippy::pedantic)]
    tonic::include_proto!("compunube.player.v1");
}

#[cfg(test)]
mod tests {
    use super::pb::{
        player_profile_service_server::PlayerProfileServiceServer, GetProfileRequest, ItemType,
    };
    use tonic::server::NamedService;

    struct Noop;

    #[test]
    fn generated_service_uses_contract_package_name() {
        assert_eq!(
            <PlayerProfileServiceServer<Noop> as NamedService>::NAME,
            "compunube.player.v1.PlayerProfileService"
        );
    }

    #[test]
    fn generated_messages_expose_contract_fields() {
        let request = GetProfileRequest {
            player_id: "p1".into(),
        };
        assert_eq!(request.player_id, "p1");
        assert_eq!(ItemType::Board as i32, 2);
    }
}
