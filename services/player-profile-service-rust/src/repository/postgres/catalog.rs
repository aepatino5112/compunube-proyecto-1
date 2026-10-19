//! Catalog reads. Published catalog versions are immutable, so the two
//! statements need no shared snapshot.

use std::collections::BTreeMap;

use sqlx::{PgConnection, Row};

use super::{
    convert::to_u64,
    error::{describe_sqlx_error, map_sqlx_error},
};
use crate::{
    domain::{Catalog, CatalogItem, ItemType},
    repository::RepositoryError,
};

/// Loads a published catalog version, or the active one when `version` is
/// `None`. Unknown, unpublished (and, for `None`, absent-active) yield `None`.
pub async fn load(
    conn: &mut PgConnection,
    version: Option<&str>,
) -> Result<Option<Catalog>, RepositoryError> {
    let found: Option<String> = match version {
        Some(version) => {
            sqlx::query_scalar(
                "SELECT catalog_version FROM player.catalog_versions \
                 WHERE catalog_version = $1 AND published_at IS NOT NULL",
            )
            .bind(version)
            .fetch_optional(&mut *conn)
            .await
        }
        None => {
            sqlx::query_scalar(
                "SELECT catalog_version FROM player.catalog_versions \
                 WHERE active AND published_at IS NOT NULL",
            )
            .fetch_optional(&mut *conn)
            .await
        }
    }
    .map_err(|e| map_sqlx_error(&e))?;
    let Some(version) = found else {
        return Ok(None);
    };

    let rows = sqlx::query(
        "SELECT e.item_id, d.item_type, e.enabled, e.name, e.description, e.price_coins, \
                e.recipe_plastic, e.recipe_metal, e.metadata::text AS metadata \
         FROM player.catalog_entries e \
         JOIN player.item_definitions d ON d.item_id = e.item_id \
         WHERE e.catalog_version = $1",
    )
    .bind(&version)
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| map_sqlx_error(&e))?;

    let items = rows
        .iter()
        .map(parse_item)
        .collect::<Result<Vec<_>, RepositoryError>>()?;
    Ok(Some(Catalog::new(version, items)))
}

fn parse_item(row: &sqlx::postgres::PgRow) -> Result<CatalogItem, RepositoryError> {
    let read = |e: sqlx::Error| RepositoryError::Unexpected(describe_sqlx_error(&e));
    let item_type: String = row.try_get("item_type").map_err(read)?;
    let item_type = ItemType::from_db_str(&item_type)
        .ok_or_else(|| RepositoryError::Unexpected("unknown item type".into()))?;
    let price: Option<i64> = row.try_get("price_coins").map_err(read)?;
    let metadata: String = row.try_get("metadata").map_err(read)?;
    Ok(CatalogItem {
        item_id: row.try_get("item_id").map_err(read)?,
        item_type,
        name: row.try_get("name").map_err(read)?,
        description: row.try_get("description").map_err(read)?,
        enabled: row.try_get("enabled").map_err(read)?,
        price_coins: price.map(|p| to_u64(p, "price_coins")).transpose()?,
        recipe_plastic: to_u64(
            row.try_get("recipe_plastic").map_err(read)?,
            "recipe_plastic",
        )?,
        recipe_metal: to_u64(row.try_get("recipe_metal").map_err(read)?, "recipe_metal")?,
        metadata: parse_metadata(&metadata),
    })
}

/// Metadata is a JSON object of strings (E5). Anything else is tolerated:
/// non-string values are rendered as JSON text and a non-object becomes empty.
pub fn parse_metadata(text: &str) -> BTreeMap<String, String> {
    let Ok(serde_json::Value::Object(map)) = serde_json::from_str(text) else {
        return BTreeMap::new();
    };
    map.into_iter()
        .map(|(key, value)| match value {
            serde_json::Value::String(text) => (key, text),
            other => (key, other.to_string()),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn metadata_keeps_strings_and_tolerates_other_shapes() {
        let meta = parse_metadata(r##"{"color":"#fff","n":3,"flag":true}"##);
        assert_eq!(meta["color"], "#fff");
        assert_eq!(meta["n"], "3");
        assert_eq!(meta["flag"], "true");
        assert!(parse_metadata("[]").is_empty());
        assert!(parse_metadata("not json").is_empty());
    }
}
