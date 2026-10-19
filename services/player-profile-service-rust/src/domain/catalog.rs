//! Versioned catalog model (E2, E6). Values come from `player.catalog_entries`;
//! nothing here is invented.

use std::collections::BTreeMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum ItemType {
    Character,
    Board,
    Outfit,
    Net,
    Hair,
}

impl ItemType {
    /// Value stored in `player.item_definitions.item_type`.
    pub fn as_db_str(self) -> &'static str {
        match self {
            ItemType::Character => "character",
            ItemType::Board => "board",
            ItemType::Outfit => "outfit",
            ItemType::Net => "net",
            ItemType::Hair => "hair",
        }
    }

    pub fn from_db_str(value: &str) -> Option<Self> {
        [
            ItemType::Character,
            ItemType::Board,
            ItemType::Outfit,
            ItemType::Net,
            ItemType::Hair,
        ]
        .into_iter()
        .find(|item_type| item_type.as_db_str() == value)
    }

    /// Presentation order of the prototype catalog (`economy.js`): characters,
    /// boards, outfits, hair, nets.
    pub fn display_rank(self) -> u8 {
        match self {
            ItemType::Character => 0,
            ItemType::Board => 1,
            ItemType::Outfit => 2,
            ItemType::Hair => 3,
            ItemType::Net => 4,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CatalogItem {
    pub item_id: String,
    pub item_type: ItemType,
    pub name: String,
    pub description: String,
    pub enabled: bool,
    /// `None` means the item is not for sale.
    pub price_coins: Option<u64>,
    pub recipe_plastic: u64,
    pub recipe_metal: u64,
    pub metadata: BTreeMap<String, String>,
}

impl CatalogItem {
    pub fn has_recipe(&self) -> bool {
        self.recipe_plastic > 0 || self.recipe_metal > 0
    }

    /// E6: for sale when it has a price and no recipe.
    pub fn purchasable(&self) -> bool {
        self.price_coins.is_some() && !self.has_recipe()
    }

    /// E6: crafted when a recipe asks for any material.
    pub fn craftable(&self) -> bool {
        self.has_recipe()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Catalog {
    pub version: String,
    /// Deterministic order: type rank, price, recipe, id.
    pub items: Vec<CatalogItem>,
}

impl Catalog {
    pub fn new(version: impl Into<String>, mut items: Vec<CatalogItem>) -> Self {
        items.sort_by(|a, b| {
            (
                a.item_type.display_rank(),
                a.price_coins.unwrap_or(u64::MAX),
                a.recipe_plastic,
                a.recipe_metal,
                &a.item_id,
            )
                .cmp(&(
                    b.item_type.display_rank(),
                    b.price_coins.unwrap_or(u64::MAX),
                    b.recipe_plastic,
                    b.recipe_metal,
                    &b.item_id,
                ))
        });
        Self {
            version: version.into(),
            items,
        }
    }

    pub fn get(&self, item_id: &str) -> Option<&CatalogItem> {
        self.items.iter().find(|item| item.item_id == item_id)
    }

    /// An item an operation may act on: present and enabled in this version.
    pub fn available(&self, item_id: &str) -> Option<&CatalogItem> {
        self.get(item_id).filter(|item| item.enabled)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::fixtures;

    #[test]
    fn purchasable_and_craftable_follow_price_and_recipe() {
        let catalog = fixtures::catalog();
        let manglar = catalog.get("manglar").unwrap();
        assert!(manglar.purchasable() && !manglar.craftable());
        let reuso = catalog.get("red-reuso").unwrap();
        assert!(!reuso.purchasable() && reuso.craftable());
        let coral = catalog.get("coral").unwrap();
        assert!(coral.purchasable() && !coral.craftable());
    }

    #[test]
    fn an_item_with_price_and_recipe_is_only_craftable() {
        let mut item = fixtures::catalog().get("manglar").unwrap().clone();
        item.recipe_metal = 1;
        assert!(!item.purchasable() && item.craftable());
    }

    #[test]
    fn items_are_ordered_deterministically() {
        let catalog = fixtures::catalog();
        let ids: Vec<_> = catalog.items.iter().map(|i| i.item_id.as_str()).collect();
        let mut again = catalog.clone();
        again.items.reverse();
        let again = Catalog::new("v", again.items);
        let ids_again: Vec<_> = again.items.iter().map(|i| i.item_id.as_str()).collect();
        assert_eq!(ids, ids_again);
        assert_eq!(catalog.items[0].item_type, ItemType::Character);
        assert_eq!(catalog.items.last().unwrap().item_id, "red-cobre");
    }

    #[test]
    fn disabled_items_are_not_available() {
        let mut catalog = fixtures::catalog();
        catalog
            .items
            .iter_mut()
            .find(|i| i.item_id == "sol")
            .unwrap()
            .enabled = false;
        assert!(catalog.get("sol").is_some());
        assert!(catalog.available("sol").is_none());
        assert!(catalog.available("unknown").is_none());
    }

    #[test]
    fn item_type_round_trips_through_its_db_value() {
        for item_type in [
            ItemType::Character,
            ItemType::Board,
            ItemType::Outfit,
            ItemType::Net,
            ItemType::Hair,
        ] {
            assert_eq!(
                ItemType::from_db_str(item_type.as_db_str()),
                Some(item_type)
            );
        }
        assert_eq!(ItemType::from_db_str("gadget"), None);
    }
}
