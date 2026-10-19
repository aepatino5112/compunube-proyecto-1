//! The profile aggregate: balances, ownership, equipment and appearance.

use std::collections::BTreeSet;

use super::catalog::ItemType;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Slot {
    Board,
    Outfit,
    Net,
    Hair,
    Character,
}

impl Slot {
    pub const ALL: [Slot; 5] = [
        Slot::Board,
        Slot::Outfit,
        Slot::Net,
        Slot::Hair,
        Slot::Character,
    ];

    /// Value stored in `player.equipment_slots.slot`.
    pub fn as_db_str(self) -> &'static str {
        match self {
            Slot::Board => "board",
            Slot::Outfit => "outfit",
            Slot::Net => "net",
            Slot::Hair => "hair",
            Slot::Character => "character",
        }
    }

    pub fn from_db_str(value: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|slot| slot.as_db_str() == value)
    }

    /// An item only ever fits the slot of its own type.
    pub fn for_item_type(item_type: ItemType) -> Self {
        match item_type {
            ItemType::Board => Slot::Board,
            ItemType::Outfit => Slot::Outfit,
            ItemType::Net => Slot::Net,
            ItemType::Hair => Slot::Hair,
            ItemType::Character => Slot::Character,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Equipment {
    pub board_id: String,
    pub outfit_id: String,
    pub net_id: String,
    pub hair_id: String,
    pub character_id: String,
}

impl Equipment {
    pub fn get(&self, slot: Slot) -> &str {
        match slot {
            Slot::Board => &self.board_id,
            Slot::Outfit => &self.outfit_id,
            Slot::Net => &self.net_id,
            Slot::Hair => &self.hair_id,
            Slot::Character => &self.character_id,
        }
    }

    pub fn set(&mut self, slot: Slot, item_id: &str) {
        let target = match slot {
            Slot::Board => &mut self.board_id,
            Slot::Outfit => &mut self.outfit_id,
            Slot::Net => &mut self.net_id,
            Slot::Hair => &mut self.hair_id,
            Slot::Character => &mut self.character_id,
        };
        *target = item_id.to_string();
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Appearance {
    pub skin_id: String,
    pub hair_color_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProfileState {
    pub player_id: String,
    /// Strictly positive for any persisted profile.
    pub revision: u64,
    pub coins: u64,
    pub plastic: u64,
    pub metal: u64,
    pub owned_item_ids: BTreeSet<String>,
    pub equipment: Equipment,
    pub appearance: Appearance,
}

impl ProfileState {
    pub fn owns(&self, item_id: &str) -> bool {
        self.owned_item_ids.contains(item_id)
    }
}
