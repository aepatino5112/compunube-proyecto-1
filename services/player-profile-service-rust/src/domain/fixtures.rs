//! Test-only catalog with the subset of `online-v1` the rule tests need
//! (values copied from `economy.js`).

use std::collections::BTreeMap;

use super::catalog::{Catalog, CatalogItem, ItemType};

fn item(
    id: &str,
    item_type: ItemType,
    price: Option<u64>,
    recipe: (u64, u64),
    metadata: &[(&str, &str)],
) -> CatalogItem {
    CatalogItem {
        item_id: id.into(),
        item_type,
        name: id.to_uppercase(),
        description: format!("{id} description"),
        enabled: true,
        price_coins: price,
        recipe_plastic: recipe.0,
        recipe_metal: recipe.1,
        metadata: metadata
            .iter()
            .map(|(k, v)| ((*k).to_string(), (*v).to_string()))
            .collect::<BTreeMap<_, _>>(),
    }
}

pub fn catalog() -> Catalog {
    use ItemType::*;
    Catalog::new(
        "online-v1",
        vec![
            item(
                "nico",
                Character,
                Some(0),
                (0, 0),
                &[
                    ("skin", "medium"),
                    ("hairColor", "brown"),
                    ("hair", "swept"),
                ],
            ),
            item(
                "luna",
                Character,
                Some(0),
                (0, 0),
                &[
                    ("skin", "light"),
                    ("hairColor", "blonde"),
                    ("hair", "ponytail"),
                ],
            ),
            item("coral", Board, Some(0), (0, 0), &[]),
            item("manglar", Board, Some(60), (0, 0), &[]),
            item("sol", Board, Some(100), (0, 0), &[]),
            item("costero", Outfit, Some(0), (0, 0), &[]),
            item("brisa", Outfit, Some(40), (0, 0), &[]),
            item("swept", Hair, Some(0), (0, 0), &[]),
            item("ponytail", Hair, Some(0), (0, 0), &[]),
            item("red-base", Net, Some(0), (0, 0), &[]),
            item("red-reuso", Net, None, (6, 3), &[]),
            item("red-cobre", Net, None, (12, 8), &[]),
        ],
    )
}
