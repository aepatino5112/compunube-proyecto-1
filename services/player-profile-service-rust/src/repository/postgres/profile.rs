//! Profile provisioning and loading (E7). All functions run on the caller's
//! transaction connection.

use std::collections::BTreeSet;

use sqlx::{PgConnection, Row};

use super::{
    convert::{to_i64, to_u64},
    error::{describe_sqlx_error, map_sqlx_error},
};
use crate::{
    domain::{
        provisioning::{
            default_appearance, default_equipment, BASE_ACQUISITION, BASE_OWNED_ITEMS,
            INITIAL_REVISION,
        },
        Appearance, Equipment, ProfileState, Slot,
    },
    repository::{LockMode, RepositoryError},
};

struct Balances {
    coins: u64,
    plastic: u64,
    metal: u64,
    revision: u64,
}

async fn lock_row(
    conn: &mut PgConnection,
    player_id: &str,
    mode: LockMode,
) -> Result<Option<Balances>, RepositoryError> {
    let sql = match mode {
        LockMode::Update => {
            "SELECT coins, plastic, metal, profile_revision FROM player.profiles \
             WHERE player_id = $1 FOR UPDATE"
        }
        LockMode::Share => {
            "SELECT coins, plastic, metal, profile_revision FROM player.profiles \
             WHERE player_id = $1 FOR SHARE"
        }
    };
    let row = sqlx::query(sql)
        .bind(player_id)
        .fetch_optional(&mut *conn)
        .await
        .map_err(|e| map_sqlx_error(&e))?;
    row.map(|row| {
        let read = |e: sqlx::Error| RepositoryError::Unexpected(describe_sqlx_error(&e));
        Ok(Balances {
            coins: to_u64(row.try_get("coins").map_err(read)?, "coins")?,
            plastic: to_u64(row.try_get("plastic").map_err(read)?, "plastic")?,
            metal: to_u64(row.try_get("metal").map_err(read)?, "metal")?,
            revision: to_u64(
                row.try_get("profile_revision").map_err(read)?,
                "profile_revision",
            )?,
        })
    })
    .transpose()
}

/// Creates the profile and its start state. When another transaction created
/// the profile first, `ON CONFLICT DO NOTHING` waits for it to commit, inserts
/// nothing and leaves the children to that transaction.
async fn provision(conn: &mut PgConnection, player_id: &str) -> Result<(), RepositoryError> {
    let revision = to_i64(INITIAL_REVISION, "revision")?;
    let inserted = sqlx::query(
        "INSERT INTO player.profiles (player_id, profile_revision) VALUES ($1, $2) \
         ON CONFLICT (player_id) DO NOTHING",
    )
    .bind(player_id)
    .bind(revision)
    .execute(&mut *conn)
    .await
    .map_err(|e| map_sqlx_error(&e))?
    .rows_affected();
    if inserted == 0 {
        return Ok(());
    }

    let owned: Vec<String> = BASE_OWNED_ITEMS
        .iter()
        .map(|id| (*id).to_string())
        .collect();
    sqlx::query(
        "INSERT INTO player.owned_items (player_id, item_id, acquisition_type) \
         SELECT $1, item_id, $3 FROM unnest($2::text[]) AS t(item_id)",
    )
    .bind(player_id)
    .bind(&owned)
    .bind(BASE_ACQUISITION)
    .execute(&mut *conn)
    .await
    .map_err(|e| map_sqlx_error(&e))?;

    let equipment = default_equipment();
    let (slots, items): (Vec<String>, Vec<String>) = Slot::ALL
        .iter()
        .map(|slot| {
            (
                slot.as_db_str().to_string(),
                equipment.get(*slot).to_string(),
            )
        })
        .unzip();
    sqlx::query(
        "INSERT INTO player.equipment_slots (player_id, slot, item_id) \
         SELECT $1, slot, item_id FROM unnest($2::text[], $3::text[]) AS t(slot, item_id)",
    )
    .bind(player_id)
    .bind(&slots)
    .bind(&items)
    .execute(&mut *conn)
    .await
    .map_err(|e| map_sqlx_error(&e))?;

    let appearance = default_appearance();
    sqlx::query(
        "INSERT INTO player.profile_appearance (player_id, skin_id, hair_color_id) \
         VALUES ($1, $2, $3)",
    )
    .bind(player_id)
    .bind(&appearance.skin_id)
    .bind(&appearance.hair_color_id)
    .execute(&mut *conn)
    .await
    .map_err(|e| map_sqlx_error(&e))?;
    Ok(())
}

/// Locks (provisioning first when needed) and loads the whole aggregate.
pub async fn lock_and_load(
    conn: &mut PgConnection,
    player_id: &str,
    mode: LockMode,
) -> Result<ProfileState, RepositoryError> {
    let balances = match lock_row(conn, player_id, mode).await? {
        Some(balances) => balances,
        None => {
            provision(conn, player_id).await?;
            lock_row(conn, player_id, mode).await?.ok_or_else(|| {
                RepositoryError::Unexpected("profile missing after provisioning".into())
            })?
        }
    };

    let owned: Vec<String> =
        sqlx::query_scalar("SELECT item_id FROM player.owned_items WHERE player_id = $1")
            .bind(player_id)
            .fetch_all(&mut *conn)
            .await
            .map_err(|e| map_sqlx_error(&e))?;

    let slot_rows =
        sqlx::query("SELECT slot, item_id FROM player.equipment_slots WHERE player_id = $1")
            .bind(player_id)
            .fetch_all(&mut *conn)
            .await
            .map_err(|e| map_sqlx_error(&e))?;
    let mut equipment = Equipment {
        board_id: String::new(),
        outfit_id: String::new(),
        net_id: String::new(),
        hair_id: String::new(),
        character_id: String::new(),
    };
    let mut filled = BTreeSet::new();
    for row in &slot_rows {
        let read = |e: sqlx::Error| RepositoryError::Unexpected(describe_sqlx_error(&e));
        let slot: String = row.try_get("slot").map_err(read)?;
        let item: String = row.try_get("item_id").map_err(read)?;
        let slot = Slot::from_db_str(&slot)
            .ok_or_else(|| RepositoryError::Unexpected("unknown equipment slot".into()))?;
        equipment.set(slot, &item);
        filled.insert(slot);
    }
    if filled.len() != Slot::ALL.len() {
        return Err(RepositoryError::Unexpected(
            "profile has incomplete equipment".into(),
        ));
    }

    let appearance = sqlx::query(
        "SELECT skin_id, hair_color_id FROM player.profile_appearance WHERE player_id = $1",
    )
    .bind(player_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(|e| map_sqlx_error(&e))?
    .ok_or_else(|| RepositoryError::Unexpected("profile has no appearance".into()))?;
    let read = |e: sqlx::Error| RepositoryError::Unexpected(describe_sqlx_error(&e));

    Ok(ProfileState {
        player_id: player_id.to_string(),
        revision: balances.revision,
        coins: balances.coins,
        plastic: balances.plastic,
        metal: balances.metal,
        owned_item_ids: owned.into_iter().collect(),
        equipment,
        appearance: Appearance {
            skin_id: appearance.try_get("skin_id").map_err(read)?,
            hair_color_id: appearance.try_get("hair_color_id").map_err(read)?,
        },
    })
}
