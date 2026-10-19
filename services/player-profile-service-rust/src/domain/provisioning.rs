//! Lazy provisioning defaults (E7), equal to `freshProfile()` in
//! `apps/web/dist/economy.js`: empty balances, the free base items owned and
//! equipped, and the default appearance.

use std::collections::BTreeSet;

use super::{
    appearance::{DEFAULT_HAIR_COLOR, DEFAULT_SKIN},
    profile::{Appearance, Equipment, ProfileState},
};

/// A new profile starts at revision 1, so a persisted revision is always > 0.
pub const INITIAL_REVISION: u64 = 1;

/// `owned_items.acquisition_type` of the items every profile starts with.
pub const BASE_ACQUISITION: &str = "base";

/// Boards, outfits and nets with price 0, every hair style and every character.
pub const BASE_OWNED_ITEMS: [&str; 12] = [
    "coral", "costero", "red-base", "swept", "curls", "bun", "ponytail", "afro", "nico", "luna",
    "amara", "samuel",
];

pub fn default_equipment() -> Equipment {
    Equipment {
        board_id: "coral".into(),
        outfit_id: "costero".into(),
        net_id: "red-base".into(),
        hair_id: "swept".into(),
        character_id: "nico".into(),
    }
}

pub fn default_appearance() -> Appearance {
    Appearance {
        skin_id: DEFAULT_SKIN.into(),
        hair_color_id: DEFAULT_HAIR_COLOR.into(),
    }
}

pub fn initial_state(player_id: &str) -> ProfileState {
    ProfileState {
        player_id: player_id.to_string(),
        revision: INITIAL_REVISION,
        coins: 0,
        plastic: 0,
        metal: 0,
        owned_item_ids: BASE_OWNED_ITEMS
            .iter()
            .map(|id| (*id).to_string())
            .collect::<BTreeSet<_>>(),
        equipment: default_equipment(),
        appearance: default_appearance(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::profile::Slot;

    #[test]
    fn a_new_profile_matches_the_prototype_start_state() {
        let state = initial_state("p1");
        assert_eq!(state.revision, 1);
        assert_eq!((state.coins, state.plastic, state.metal), (0, 0, 0));
        assert_eq!(state.owned_item_ids.len(), 12);
        assert_eq!(state.equipment.board_id, "coral");
        assert_eq!(state.equipment.outfit_id, "costero");
        assert_eq!(state.equipment.net_id, "red-base");
        assert_eq!(state.equipment.hair_id, "swept");
        assert_eq!(state.equipment.character_id, "nico");
        assert_eq!(state.appearance.skin_id, "medium");
        assert_eq!(state.appearance.hair_color_id, "brown");
    }

    #[test]
    fn every_equipped_item_is_owned() {
        let state = initial_state("p1");
        for slot in Slot::ALL {
            assert!(state.owns(state.equipment.get(slot)), "{slot:?}");
        }
    }
}
