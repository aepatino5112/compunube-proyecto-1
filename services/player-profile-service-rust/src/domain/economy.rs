//! Economy rules: buy, craft, exchange, equip and appearance (E4-E6, E10, E11).
//!
//! [`MutationIntent::evaluate`] is pure: given the locked profile state and one
//! catalog version it returns either an [`Effect`] for the repository to apply
//! or the first rejection in the E10 order:
//! `INVALID_CATALOG_VERSION` -> `INVALID_ITEM` -> `ALREADY_OWNED`/`NOT_OWNED`
//! -> `INVALID_ACTION` -> `INSUFFICIENT_COINS`/`INSUFFICIENT_MATERIALS`.

use super::{
    appearance::{is_hair_color, is_skin_tone},
    catalog::{Catalog, CatalogItem, ItemType},
    fingerprint::Canonical,
    profile::{Appearance, ProfileState, Slot},
};

/// First catalog (retired by migration 0004, kept so its operations replay).
pub const ONLINE_V1: &str = "online-v1";
/// Active catalog since migration 0004: prices and recipes ×5, same rates.
pub const ONLINE_V2: &str = "online-v2";

/// Largest value any balance column can hold (`BIGINT`).
const BALANCE_LIMIT: u64 = i64::MAX as u64;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Material {
    Plastic,
    Metal,
}

impl Material {
    pub fn as_str(self) -> &'static str {
        match self {
            Material::Plastic => "plastic",
            Material::Metal => "metal",
        }
    }
}

/// Coins paid per unit of material (E4).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ExchangeRates {
    pub plastic: u64,
    pub metal: u64,
}

impl ExchangeRates {
    pub fn coins_per(self, material: Material) -> u64 {
        match material {
            Material::Plastic => self.plastic,
            Material::Metal => self.metal,
        }
    }
}

/// Rates have no table; they are constants of the catalog they belong to.
pub fn exchange_rates(catalog_version: &str) -> Option<ExchangeRates> {
    [ONLINE_V1, ONLINE_V2]
        .contains(&catalog_version)
        .then_some(ExchangeRates {
            plastic: 4,
            metal: 6,
        })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MutationRejection {
    InvalidAction,
    InvalidItem,
    InsufficientCoins,
    InsufficientMaterials,
    NotOwned,
    AlreadyOwned,
    InvalidAppearance,
    IdempotencyConflict,
    InvalidCatalogVersion,
}

impl MutationRejection {
    pub const ALL: [MutationRejection; 9] = [
        MutationRejection::InvalidAction,
        MutationRejection::InvalidItem,
        MutationRejection::InsufficientCoins,
        MutationRejection::InsufficientMaterials,
        MutationRejection::NotOwned,
        MutationRejection::AlreadyOwned,
        MutationRejection::InvalidAppearance,
        MutationRejection::IdempotencyConflict,
        MutationRejection::InvalidCatalogVersion,
    ];

    /// Value stored in `player.economic_operations.rejection_code`.
    pub fn as_code(self) -> &'static str {
        match self {
            MutationRejection::InvalidAction => "INVALID_ACTION",
            MutationRejection::InvalidItem => "INVALID_ITEM",
            MutationRejection::InsufficientCoins => "INSUFFICIENT_COINS",
            MutationRejection::InsufficientMaterials => "INSUFFICIENT_MATERIALS",
            MutationRejection::NotOwned => "NOT_OWNED",
            MutationRejection::AlreadyOwned => "ALREADY_OWNED",
            MutationRejection::InvalidAppearance => "INVALID_APPEARANCE",
            MutationRejection::IdempotencyConflict => "IDEMPOTENCY_CONFLICT",
            MutationRejection::InvalidCatalogVersion => "INVALID_CATALOG_VERSION",
        }
    }

    pub fn from_code(code: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|r| r.as_code() == code)
    }

    /// Fixed, client-safe text for the rejection body.
    pub fn message(self) -> &'static str {
        match self {
            MutationRejection::InvalidAction => "the action is not valid for this item",
            MutationRejection::InvalidItem => {
                "the item does not exist or is disabled in this catalog version"
            }
            MutationRejection::InsufficientCoins => "not enough coins",
            MutationRejection::InsufficientMaterials => "not enough materials",
            MutationRejection::NotOwned => "the item is not owned",
            MutationRejection::AlreadyOwned => "the item is already owned",
            MutationRejection::InvalidAppearance => "the skin tone or hair color is not available",
            MutationRejection::IdempotencyConflict => {
                "request_id was already used with a different request"
            }
            MutationRejection::InvalidCatalogVersion => {
                "the catalog version is unknown or not published"
            }
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AcquisitionKind {
    Buy,
    Craft,
}

impl AcquisitionKind {
    /// Value stored in `player.owned_items.acquisition_type`.
    pub fn as_db_str(self) -> &'static str {
        match self {
            AcquisitionKind::Buy => "buy",
            AcquisitionKind::Craft => "craft",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Acquisition {
    pub item_id: String,
    pub kind: AcquisitionKind,
}

/// What an accepted mutation changes. The revision always advances by one (E8),
/// including for an equip or appearance change that sets what was already set.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Effect {
    pub coins_delta: i64,
    pub plastic_delta: i64,
    pub metal_delta: i64,
    pub acquisition: Option<Acquisition>,
    pub equip: Vec<(Slot, String)>,
    pub appearance: Option<Appearance>,
}

impl Effect {
    /// Applies the effect to an in-memory state exactly as the repository
    /// applies it to the rows. Saturating, so it never panics; `evaluate`
    /// already guaranteed the balances cover the deltas.
    pub fn apply_to(&self, state: &mut ProfileState) {
        state.coins = state.coins.saturating_add_signed(self.coins_delta);
        state.plastic = state.plastic.saturating_add_signed(self.plastic_delta);
        state.metal = state.metal.saturating_add_signed(self.metal_delta);
        if let Some(acquisition) = &self.acquisition {
            state.owned_item_ids.insert(acquisition.item_id.clone());
        }
        for (slot, item_id) in &self.equip {
            state.equipment.set(*slot, item_id);
        }
        if let Some(appearance) = &self.appearance {
            state.appearance = appearance.clone();
        }
        state.revision = state.revision.saturating_add(1);
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MutationIntent {
    Buy {
        item_id: String,
    },
    Craft {
        item_id: String,
    },
    Exchange {
        material: Material,
        amount: u64,
    },
    Equip {
        item_id: String,
    },
    SetAppearance {
        skin_id: String,
        hair_color_id: String,
    },
}

fn as_delta(value: u64) -> Result<i64, MutationRejection> {
    i64::try_from(value).map_err(|_| MutationRejection::InvalidAction)
}

impl MutationIntent {
    /// Value stored in `player.economic_operations.operation_type`.
    pub fn operation_type(&self) -> &'static str {
        match self {
            MutationIntent::Buy { .. } => "buy",
            MutationIntent::Craft { .. } => "craft",
            MutationIntent::Exchange { .. } => "exchange",
            MutationIntent::Equip { .. } => "equip",
            MutationIntent::SetAppearance { .. } => "appearance",
        }
    }

    /// E9: operation type, catalog version and the command's own fields. The
    /// idempotency key (player, request) is the row key, not part of the hash.
    pub fn fingerprint(&self, catalog_version: &str) -> String {
        let mut canonical = Canonical::new(self.operation_type());
        canonical.field("catalog_version", catalog_version);
        match self {
            MutationIntent::Buy { item_id }
            | MutationIntent::Craft { item_id }
            | MutationIntent::Equip { item_id } => {
                canonical.field("item_id", item_id);
            }
            MutationIntent::Exchange { material, amount } => {
                canonical
                    .field("material", material.as_str())
                    .number("amount", *amount);
            }
            MutationIntent::SetAppearance {
                skin_id,
                hair_color_id,
            } => {
                canonical
                    .field("skin_id", skin_id)
                    .field("hair_color_id", hair_color_id);
            }
        }
        canonical.finish()
    }

    pub fn evaluate(
        &self,
        state: &ProfileState,
        catalog: &Catalog,
    ) -> Result<Effect, MutationRejection> {
        match self {
            MutationIntent::Buy { item_id } => buy(state, catalog, item_id),
            MutationIntent::Craft { item_id } => craft(state, catalog, item_id),
            MutationIntent::Exchange { material, amount } => {
                exchange(state, catalog, *material, *amount)
            }
            MutationIntent::Equip { item_id } => equip(state, catalog, item_id),
            MutationIntent::SetAppearance {
                skin_id,
                hair_color_id,
            } => set_appearance(skin_id, hair_color_id),
        }
    }
}

/// Shared prefix of buy and craft: the item must exist and not be owned.
fn acquirable<'a>(
    state: &ProfileState,
    catalog: &'a Catalog,
    item_id: &str,
) -> Result<&'a CatalogItem, MutationRejection> {
    let item = catalog
        .available(item_id)
        .ok_or(MutationRejection::InvalidItem)?;
    if state.owns(&item.item_id) {
        return Err(MutationRejection::AlreadyOwned);
    }
    Ok(item)
}

fn buy(
    state: &ProfileState,
    catalog: &Catalog,
    item_id: &str,
) -> Result<Effect, MutationRejection> {
    let item = acquirable(state, catalog, item_id)?;
    let price = match item.price_coins {
        Some(price) if item.purchasable() => price,
        _ => return Err(MutationRejection::InvalidAction),
    };
    if state.coins < price {
        return Err(MutationRejection::InsufficientCoins);
    }
    Ok(Effect {
        coins_delta: -as_delta(price)?,
        acquisition: Some(Acquisition {
            item_id: item.item_id.clone(),
            kind: AcquisitionKind::Buy,
        }),
        ..Effect::default()
    })
}

fn craft(
    state: &ProfileState,
    catalog: &Catalog,
    item_id: &str,
) -> Result<Effect, MutationRejection> {
    let item = acquirable(state, catalog, item_id)?;
    if !item.craftable() {
        return Err(MutationRejection::InvalidAction);
    }
    if state.plastic < item.recipe_plastic || state.metal < item.recipe_metal {
        return Err(MutationRejection::InsufficientMaterials);
    }
    Ok(Effect {
        plastic_delta: -as_delta(item.recipe_plastic)?,
        metal_delta: -as_delta(item.recipe_metal)?,
        acquisition: Some(Acquisition {
            item_id: item.item_id.clone(),
            kind: AcquisitionKind::Craft,
        }),
        ..Effect::default()
    })
}

fn exchange(
    state: &ProfileState,
    catalog: &Catalog,
    material: Material,
    amount: u64,
) -> Result<Effect, MutationRejection> {
    let rates = exchange_rates(&catalog.version).ok_or(MutationRejection::InvalidCatalogVersion)?;
    let balance = match material {
        Material::Plastic => state.plastic,
        Material::Metal => state.metal,
    };
    if balance < amount {
        return Err(MutationRejection::InsufficientMaterials);
    }
    let earned = amount
        .checked_mul(rates.coins_per(material))
        .filter(|earned| {
            state
                .coins
                .checked_add(*earned)
                .is_some_and(|total| total <= BALANCE_LIMIT)
        })
        .ok_or(MutationRejection::InvalidAction)?;
    let spent = -as_delta(amount)?;
    let mut effect = Effect {
        coins_delta: as_delta(earned)?,
        ..Effect::default()
    };
    match material {
        Material::Plastic => effect.plastic_delta = spent,
        Material::Metal => effect.metal_delta = spent,
    }
    Ok(effect)
}

fn equip(
    state: &ProfileState,
    catalog: &Catalog,
    item_id: &str,
) -> Result<Effect, MutationRejection> {
    let item = catalog
        .available(item_id)
        .ok_or(MutationRejection::InvalidItem)?;
    if !state.owns(&item.item_id) {
        return Err(MutationRejection::NotOwned);
    }
    let slot = Slot::for_item_type(item.item_type);
    let mut effect = Effect {
        equip: vec![(slot, item.item_id.clone())],
        ..Effect::default()
    };
    if item.item_type == ItemType::Character {
        // economy.js: equipping a character also sets its hair style and look.
        let look = |key: &str| item.metadata.get(key).map(String::as_str);
        let (Some(hair), Some(skin), Some(hair_color)) =
            (look("hair"), look("skin"), look("hairColor"))
        else {
            return Err(MutationRejection::InvalidItem);
        };
        let hair_is_owned_hair_item = state.owns(hair)
            && catalog
                .get(hair)
                .is_some_and(|candidate| candidate.item_type == ItemType::Hair);
        if !is_skin_tone(skin) || !is_hair_color(hair_color) || !hair_is_owned_hair_item {
            return Err(MutationRejection::InvalidItem);
        }
        effect.equip.push((Slot::Hair, hair.to_string()));
        effect.appearance = Some(Appearance {
            skin_id: skin.to_string(),
            hair_color_id: hair_color.to_string(),
        });
    }
    Ok(effect)
}

fn set_appearance(skin_id: &str, hair_color_id: &str) -> Result<Effect, MutationRejection> {
    if !is_skin_tone(skin_id) || !is_hair_color(hair_color_id) {
        return Err(MutationRejection::InvalidAppearance);
    }
    Ok(Effect {
        appearance: Some(Appearance {
            skin_id: skin_id.to_string(),
            hair_color_id: hair_color_id.to_string(),
        }),
        ..Effect::default()
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{fixtures, provisioning::initial_state};

    fn state() -> ProfileState {
        initial_state("p1")
    }

    fn buy_intent(id: &str) -> MutationIntent {
        MutationIntent::Buy { item_id: id.into() }
    }
    fn craft_intent(id: &str) -> MutationIntent {
        MutationIntent::Craft { item_id: id.into() }
    }
    fn equip_intent(id: &str) -> MutationIntent {
        MutationIntent::Equip { item_id: id.into() }
    }
    fn eval(intent: &MutationIntent, state: &ProfileState) -> Result<Effect, MutationRejection> {
        intent.evaluate(state, &fixtures::catalog())
    }

    // ---- buy -------------------------------------------------------------

    #[test]
    fn buy_spends_the_price_and_acquires_the_item() {
        let mut s = state();
        s.coins = 100;
        let effect = eval(&buy_intent("manglar"), &s).unwrap();
        assert_eq!(effect.coins_delta, -60);
        assert_eq!(effect.acquisition.as_ref().unwrap().item_id, "manglar");
        effect.apply_to(&mut s);
        assert_eq!((s.coins, s.revision), (40, 2));
        assert!(s.owns("manglar"));
    }

    #[test]
    fn buy_without_enough_coins_is_insufficient_coins() {
        let mut s = state();
        s.coins = 59;
        assert_eq!(
            eval(&buy_intent("manglar"), &s),
            Err(MutationRejection::InsufficientCoins)
        );
    }

    #[test]
    fn buy_of_an_owned_item_is_already_owned_even_if_it_is_craftable() {
        let mut s = state();
        s.owned_item_ids.insert("red-reuso".into());
        assert_eq!(
            eval(&buy_intent("coral"), &s),
            Err(MutationRejection::AlreadyOwned)
        );
        assert_eq!(
            eval(&buy_intent("red-reuso"), &s),
            Err(MutationRejection::AlreadyOwned)
        );
    }

    #[test]
    fn buying_a_craftable_net_is_an_invalid_action() {
        let mut s = state();
        s.coins = 1_000;
        assert_eq!(
            eval(&buy_intent("red-reuso"), &s),
            Err(MutationRejection::InvalidAction)
        );
    }

    #[test]
    fn buy_of_an_unknown_or_disabled_item_is_invalid_item() {
        let mut s = state();
        s.coins = 1_000;
        assert_eq!(
            eval(&buy_intent("ghost"), &s),
            Err(MutationRejection::InvalidItem)
        );
        let mut catalog = fixtures::catalog();
        catalog
            .items
            .iter_mut()
            .find(|i| i.item_id == "sol")
            .unwrap()
            .enabled = false;
        assert_eq!(
            buy_intent("sol").evaluate(&s, &catalog),
            Err(MutationRejection::InvalidItem)
        );
    }

    // ---- craft -----------------------------------------------------------

    #[test]
    fn craft_spends_the_recipe_and_acquires_the_net() {
        let mut s = state();
        s.plastic = 10;
        s.metal = 5;
        let effect = eval(&craft_intent("red-reuso"), &s).unwrap();
        assert_eq!((effect.plastic_delta, effect.metal_delta), (-6, -3));
        effect.apply_to(&mut s);
        assert_eq!((s.plastic, s.metal), (4, 2));
        assert!(s.owns("red-reuso"));
    }

    #[test]
    fn craft_needs_both_materials() {
        let mut s = state();
        s.plastic = 100;
        s.metal = 2;
        assert_eq!(
            eval(&craft_intent("red-reuso"), &s),
            Err(MutationRejection::InsufficientMaterials)
        );
        s.plastic = 5;
        s.metal = 100;
        assert_eq!(
            eval(&craft_intent("red-reuso"), &s),
            Err(MutationRejection::InsufficientMaterials)
        );
    }

    #[test]
    fn crafting_an_item_without_recipe_is_an_invalid_action() {
        let mut s = state();
        s.plastic = 100;
        s.metal = 100;
        assert_eq!(
            eval(&craft_intent("manglar"), &s),
            Err(MutationRejection::InvalidAction)
        );
    }

    #[test]
    fn craft_checks_item_then_ownership_then_action() {
        let s = state();
        assert_eq!(
            eval(&craft_intent("ghost"), &s),
            Err(MutationRejection::InvalidItem)
        );
        // owned and without recipe: ownership wins over "no recipe"
        assert_eq!(
            eval(&craft_intent("coral"), &s),
            Err(MutationRejection::AlreadyOwned)
        );
    }

    // ---- exchange --------------------------------------------------------

    #[test]
    fn exchange_pays_four_coins_per_plastic_and_six_per_metal() {
        let mut s = state();
        s.plastic = 10;
        s.metal = 10;
        let plastic = eval(
            &MutationIntent::Exchange {
                material: Material::Plastic,
                amount: 3,
            },
            &s,
        )
        .unwrap();
        assert_eq!((plastic.coins_delta, plastic.plastic_delta), (12, -3));
        let metal = eval(
            &MutationIntent::Exchange {
                material: Material::Metal,
                amount: 4,
            },
            &s,
        )
        .unwrap();
        assert_eq!((metal.coins_delta, metal.metal_delta), (24, -4));
        plastic.apply_to(&mut s);
        metal.apply_to(&mut s);
        assert_eq!((s.coins, s.plastic, s.metal, s.revision), (36, 7, 6, 3));
    }

    #[test]
    fn exchange_cannot_exceed_the_balance_and_may_use_all_of_it() {
        let mut s = state();
        s.plastic = 5;
        let all = MutationIntent::Exchange {
            material: Material::Plastic,
            amount: 5,
        };
        assert!(eval(&all, &s).is_ok());
        let too_much = MutationIntent::Exchange {
            material: Material::Plastic,
            amount: 6,
        };
        assert_eq!(
            eval(&too_much, &s),
            Err(MutationRejection::InsufficientMaterials)
        );
        let metal = MutationIntent::Exchange {
            material: Material::Metal,
            amount: 1,
        };
        assert_eq!(
            eval(&metal, &s),
            Err(MutationRejection::InsufficientMaterials)
        );
    }

    #[test]
    fn exchange_rates_exist_only_for_published_catalogs() {
        for version in ["online-v1", "online-v2"] {
            assert_eq!(
                exchange_rates(version),
                Some(ExchangeRates {
                    plastic: 4,
                    metal: 6
                })
            );
        }
        assert_eq!(exchange_rates("online-v3"), None);
        let mut catalog = fixtures::catalog();
        catalog.version = "online-v3".into();
        let mut s = state();
        s.plastic = 1;
        let intent = MutationIntent::Exchange {
            material: Material::Plastic,
            amount: 1,
        };
        assert_eq!(
            intent.evaluate(&s, &catalog),
            Err(MutationRejection::InvalidCatalogVersion)
        );
    }

    #[test]
    fn exchange_that_would_overflow_the_coin_column_is_refused() {
        let mut s = state();
        s.plastic = 10;
        s.coins = i64::MAX as u64 - 3;
        let intent = MutationIntent::Exchange {
            material: Material::Plastic,
            amount: 1,
        };
        assert_eq!(eval(&intent, &s), Err(MutationRejection::InvalidAction));
    }

    // ---- equip -----------------------------------------------------------

    #[test]
    fn equip_requires_ownership() {
        let s = state();
        assert_eq!(
            eval(&equip_intent("manglar"), &s),
            Err(MutationRejection::NotOwned)
        );
        assert_eq!(
            eval(&equip_intent("ghost"), &s),
            Err(MutationRejection::InvalidItem)
        );
    }

    #[test]
    fn equip_places_the_item_in_the_slot_of_its_own_type() {
        let mut s = state();
        for (id, slot) in [
            ("manglar", Slot::Board),
            ("brisa", Slot::Outfit),
            ("red-reuso", Slot::Net),
            ("ponytail", Slot::Hair),
        ] {
            s.owned_item_ids.insert(id.into());
            let effect = eval(&equip_intent(id), &s).unwrap();
            assert_eq!(effect.equip, vec![(slot, id.to_string())], "{id}");
            assert_eq!(effect.coins_delta, 0);
            assert!(effect.acquisition.is_none());
            effect.apply_to(&mut s);
            assert_eq!(s.equipment.get(slot), id);
        }
    }

    #[test]
    fn equipping_a_character_also_sets_its_hair_and_look() {
        let mut s = state();
        let effect = eval(&equip_intent("luna"), &s).unwrap();
        effect.apply_to(&mut s);
        assert_eq!(s.equipment.character_id, "luna");
        assert_eq!(s.equipment.hair_id, "ponytail");
        assert_eq!(s.appearance.skin_id, "light");
        assert_eq!(s.appearance.hair_color_id, "blonde");
    }

    #[test]
    fn equipping_what_is_already_equipped_is_applied_and_bumps_the_revision() {
        let mut s = state();
        let before = s.clone();
        let effect = eval(&equip_intent("coral"), &s).unwrap();
        effect.apply_to(&mut s);
        assert_eq!(s.equipment, before.equipment);
        assert_eq!(s.revision, before.revision + 1);
    }

    #[test]
    fn a_character_with_inconsistent_metadata_is_an_invalid_item() {
        let mut catalog = fixtures::catalog();
        let luna = catalog
            .items
            .iter_mut()
            .find(|i| i.item_id == "luna")
            .unwrap();
        luna.metadata.insert("skin".into(), "purple".into());
        assert_eq!(
            equip_intent("luna").evaluate(&state(), &catalog),
            Err(MutationRejection::InvalidItem)
        );
        let mut catalog = fixtures::catalog();
        let luna = catalog
            .items
            .iter_mut()
            .find(|i| i.item_id == "luna")
            .unwrap();
        luna.metadata.remove("hair");
        assert_eq!(
            equip_intent("luna").evaluate(&state(), &catalog),
            Err(MutationRejection::InvalidItem)
        );
    }

    // ---- appearance ------------------------------------------------------

    #[test]
    fn appearance_accepts_only_listed_options_and_bumps_the_revision() {
        let mut s = state();
        let ok = MutationIntent::SetAppearance {
            skin_id: "deep".into(),
            hair_color_id: "blue".into(),
        };
        let effect = eval(&ok, &s).unwrap();
        effect.apply_to(&mut s);
        assert_eq!(s.appearance.skin_id, "deep");
        assert_eq!(s.appearance.hair_color_id, "blue");
        assert_eq!(s.revision, 2);
        for (skin, hair) in [
            ("nope", "blue"),
            ("deep", "nope"),
            ("", ""),
            ("blue", "deep"),
        ] {
            let bad = MutationIntent::SetAppearance {
                skin_id: skin.into(),
                hair_color_id: hair.into(),
            };
            assert_eq!(
                eval(&bad, &state()),
                Err(MutationRejection::InvalidAppearance),
                "{skin}/{hair}"
            );
        }
    }

    #[test]
    fn setting_the_current_appearance_again_is_applied() {
        let s = state();
        let same = MutationIntent::SetAppearance {
            skin_id: s.appearance.skin_id.clone(),
            hair_color_id: s.appearance.hair_color_id.clone(),
        };
        assert!(eval(&same, &s).is_ok());
    }

    // ---- fingerprints ----------------------------------------------------

    #[test]
    fn fingerprints_cover_operation_catalog_version_and_fields() {
        let base = buy_intent("sol").fingerprint("online-v1");
        assert_eq!(base, buy_intent("sol").fingerprint("online-v1"));
        assert_ne!(base, buy_intent("manglar").fingerprint("online-v1"));
        assert_ne!(base, buy_intent("sol").fingerprint("online-v2"));
        assert_ne!(base, craft_intent("sol").fingerprint("online-v1"));
        assert_ne!(base, equip_intent("sol").fingerprint("online-v1"));
        let exchange = |material, amount| {
            MutationIntent::Exchange { material, amount }.fingerprint("online-v1")
        };
        assert_ne!(
            exchange(Material::Plastic, 1),
            exchange(Material::Plastic, 2)
        );
        assert_ne!(exchange(Material::Plastic, 1), exchange(Material::Metal, 1));
        let appearance = |skin: &str, hair: &str| {
            MutationIntent::SetAppearance {
                skin_id: skin.into(),
                hair_color_id: hair.into(),
            }
            .fingerprint("online-v1")
        };
        assert_ne!(appearance("a", "bc"), appearance("ab", "c"));
        assert_ne!(appearance("light", "blue"), appearance("light", "black"));
    }

    #[test]
    fn rejection_codes_round_trip_and_match_the_database_check() {
        let codes: Vec<_> = MutationRejection::ALL.iter().map(|r| r.as_code()).collect();
        assert_eq!(
            codes,
            [
                "INVALID_ACTION",
                "INVALID_ITEM",
                "INSUFFICIENT_COINS",
                "INSUFFICIENT_MATERIALS",
                "NOT_OWNED",
                "ALREADY_OWNED",
                "INVALID_APPEARANCE",
                "IDEMPOTENCY_CONFLICT",
                "INVALID_CATALOG_VERSION"
            ]
        );
        for rejection in MutationRejection::ALL {
            assert_eq!(
                MutationRejection::from_code(rejection.as_code()),
                Some(rejection)
            );
            assert!(!rejection.message().is_empty());
        }
        assert_eq!(MutationRejection::from_code("MADE_UP"), None);
    }

    // ---- invariants over arbitrary sequences ----------------------------

    /// Deterministic xorshift so the sequence is reproducible without a crate.
    struct Rng(u64);
    impl Rng {
        fn next(&mut self) -> u64 {
            self.0 ^= self.0 << 13;
            self.0 ^= self.0 >> 7;
            self.0 ^= self.0 << 17;
            self.0
        }
        fn pick<'a, T>(&mut self, items: &'a [T]) -> &'a T {
            &items[(self.next() % items.len() as u64) as usize]
        }
    }

    #[test]
    fn random_sequences_keep_every_invariant() {
        let catalog = fixtures::catalog();
        let ids: Vec<String> = catalog.items.iter().map(|i| i.item_id.clone()).collect();
        let skins = ["light", "warm", "medium", "dark", "deep", "bogus"];
        let hair = [
            "black", "brown", "blonde", "copper", "silver", "blue", "bogus",
        ];
        for seed in 1..=20u64 {
            let mut rng = Rng(seed.wrapping_mul(0x9E37_79B9_7F4A_7C15));
            let mut s = state();
            for _ in 0..200 {
                let intent = match rng.next() % 6 {
                    0 => buy_intent(rng.pick(&ids)),
                    1 => craft_intent(rng.pick(&ids)),
                    2 => equip_intent(rng.pick(&ids)),
                    3 => MutationIntent::Exchange {
                        material: if rng.next().is_multiple_of(2) {
                            Material::Plastic
                        } else {
                            Material::Metal
                        },
                        amount: rng.next() % 12,
                    },
                    4 => MutationIntent::SetAppearance {
                        skin_id: (*rng.pick(&skins)).into(),
                        hair_color_id: (*rng.pick(&hair)).into(),
                    },
                    _ => {
                        // simulate a settlement credit
                        s.plastic += rng.next() % 9;
                        s.metal += rng.next() % 9;
                        continue;
                    }
                };
                let before = s.clone();
                match intent.evaluate(&s, &catalog) {
                    Ok(effect) => {
                        // No balance would go below zero: deltas never exceed the balance.
                        assert!(effect.coins_delta >= -(before.coins as i64));
                        assert!(effect.plastic_delta >= -(before.plastic as i64));
                        assert!(effect.metal_delta >= -(before.metal as i64));
                        if let Some(acquisition) = &effect.acquisition {
                            assert!(!before.owns(&acquisition.item_id), "double ownership");
                        }
                        effect.apply_to(&mut s);
                        assert_eq!(s.revision, before.revision + 1);
                    }
                    Err(_) => assert_eq!(s, before, "a rejection must not change the state"),
                }
                for slot in Slot::ALL {
                    let equipped = s.equipment.get(slot);
                    assert!(s.owns(equipped), "{slot:?} holds an unowned item");
                    let item = catalog.get(equipped).unwrap();
                    assert_eq!(Slot::for_item_type(item.item_type), slot, "wrong slot type");
                }
            }
        }
    }
}
