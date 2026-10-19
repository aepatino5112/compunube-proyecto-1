//! One `player` transaction: lookups, effect application and idempotency
//! records. Business decisions are made by the caller with domain rules; this
//! file only reads and writes rows.

use async_trait::async_trait;
use sqlx::{Postgres, Row, Transaction};

use super::{
    catalog,
    convert::{to_i64, to_u64},
    error::{describe_sqlx_error, map_sqlx_error},
    profile,
};
use crate::{
    domain::{
        settlement::Credit, Catalog, EconomicOperationRecord, Effect, MutationRejection,
        OperationStatus, ProfileState, SettlementRecord,
    },
    repository::{EconomyTransaction, LockMode, RepositoryError},
};

pub(super) struct PgTransaction {
    tx: Transaction<'static, Postgres>,
}

impl PgTransaction {
    pub(super) fn new(tx: Transaction<'static, Postgres>) -> Self {
        Self { tx }
    }

    /// Adds signed deltas to the balances and advances the revision. The
    /// `CHECK (>= 0)` constraints are the last line of defence against a
    /// negative balance.
    async fn bump(
        &mut self,
        player_id: &str,
        coins: i64,
        plastic: i64,
        metal: i64,
    ) -> Result<u64, RepositoryError> {
        let revision: i64 = sqlx::query_scalar(
            "UPDATE player.profiles \
             SET coins = coins + $2, plastic = plastic + $3, metal = metal + $4, \
                 profile_revision = profile_revision + 1, updated_at = now() \
             WHERE player_id = $1 RETURNING profile_revision",
        )
        .bind(player_id)
        .bind(coins)
        .bind(plastic)
        .bind(metal)
        .fetch_one(&mut *self.tx)
        .await
        .map_err(|e| map_sqlx_error(&e))?;
        to_u64(revision, "profile_revision")
    }
}

#[async_trait]
impl EconomyTransaction for PgTransaction {
    async fn lock_profile(
        &mut self,
        player_id: &str,
        mode: LockMode,
    ) -> Result<ProfileState, RepositoryError> {
        profile::lock_and_load(&mut self.tx, player_id, mode).await
    }

    async fn find_operation(
        &mut self,
        player_id: &str,
        request_id: &str,
    ) -> Result<Option<EconomicOperationRecord>, RepositoryError> {
        let row = sqlx::query(
            "SELECT operation_type, request_fingerprint, catalog_version, status, \
                    rejection_code, profile_revision_after \
             FROM player.economic_operations WHERE player_id = $1 AND request_id = $2",
        )
        .bind(player_id)
        .bind(request_id)
        .fetch_optional(&mut *self.tx)
        .await
        .map_err(|e| map_sqlx_error(&e))?;
        let Some(row) = row else {
            return Ok(None);
        };
        let read = |e: sqlx::Error| RepositoryError::Unexpected(describe_sqlx_error(&e));
        let status: String = row.try_get("status").map_err(read)?;
        let code: Option<String> = row.try_get("rejection_code").map_err(read)?;
        let revision: Option<i64> = row.try_get("profile_revision_after").map_err(read)?;
        let (status, rejection) = match (status.as_str(), code) {
            ("applied", None) => (OperationStatus::Applied, None),
            ("rejected", Some(code)) => (
                OperationStatus::Rejected,
                Some(MutationRejection::from_code(&code).ok_or_else(|| {
                    RepositoryError::Unexpected("unknown stored rejection code".into())
                })?),
            ),
            _ => {
                return Err(RepositoryError::Unexpected(
                    "inconsistent stored operation".into(),
                ))
            }
        };
        Ok(Some(EconomicOperationRecord {
            player_id: player_id.to_string(),
            request_id: request_id.to_string(),
            operation_type: row.try_get("operation_type").map_err(read)?,
            request_fingerprint: row.try_get("request_fingerprint").map_err(read)?,
            catalog_version: row.try_get("catalog_version").map_err(read)?,
            status,
            rejection,
            profile_revision_after: revision.map(|r| to_u64(r, "revision")).transpose()?,
        }))
    }

    async fn find_settlement(
        &mut self,
        race_id: &str,
        player_id: &str,
    ) -> Result<Option<SettlementRecord>, RepositoryError> {
        let row = sqlx::query(
            "SELECT result_fingerprint, credited_plastic, credited_metal, profile_revision_after \
             FROM player.settlements WHERE race_id = $1 AND player_id = $2",
        )
        .bind(race_id)
        .bind(player_id)
        .fetch_optional(&mut *self.tx)
        .await
        .map_err(|e| map_sqlx_error(&e))?;
        let Some(row) = row else {
            return Ok(None);
        };
        let read = |e: sqlx::Error| RepositoryError::Unexpected(describe_sqlx_error(&e));
        Ok(Some(SettlementRecord {
            race_id: race_id.to_string(),
            player_id: player_id.to_string(),
            result_fingerprint: row.try_get("result_fingerprint").map_err(read)?,
            credited_plastic: to_u64(row.try_get("credited_plastic").map_err(read)?, "plastic")?,
            credited_metal: to_u64(row.try_get("credited_metal").map_err(read)?, "metal")?,
            profile_revision_after: to_u64(
                row.try_get("profile_revision_after").map_err(read)?,
                "revision",
            )?,
        }))
    }

    async fn find_catalog(&mut self, version: &str) -> Result<Option<Catalog>, RepositoryError> {
        catalog::load(&mut self.tx, Some(version)).await
    }

    async fn apply_effect(
        &mut self,
        player_id: &str,
        effect: &Effect,
    ) -> Result<u64, RepositoryError> {
        let revision = self
            .bump(
                player_id,
                effect.coins_delta,
                effect.plastic_delta,
                effect.metal_delta,
            )
            .await?;
        if let Some(acquisition) = &effect.acquisition {
            sqlx::query(
                "INSERT INTO player.owned_items (player_id, item_id, acquisition_type) \
                 VALUES ($1, $2, $3)",
            )
            .bind(player_id)
            .bind(&acquisition.item_id)
            .bind(acquisition.kind.as_db_str())
            .execute(&mut *self.tx)
            .await
            .map_err(|e| map_sqlx_error(&e))?;
        }
        for (slot, item_id) in &effect.equip {
            sqlx::query(
                "INSERT INTO player.equipment_slots (player_id, slot, item_id) \
                 VALUES ($1, $2, $3) \
                 ON CONFLICT (player_id, slot) DO UPDATE \
                 SET item_id = EXCLUDED.item_id, updated_at = now()",
            )
            .bind(player_id)
            .bind(slot.as_db_str())
            .bind(item_id)
            .execute(&mut *self.tx)
            .await
            .map_err(|e| map_sqlx_error(&e))?;
        }
        if let Some(appearance) = &effect.appearance {
            sqlx::query(
                "INSERT INTO player.profile_appearance (player_id, skin_id, hair_color_id) \
                 VALUES ($1, $2, $3) \
                 ON CONFLICT (player_id) DO UPDATE \
                 SET skin_id = EXCLUDED.skin_id, hair_color_id = EXCLUDED.hair_color_id, \
                     updated_at = now()",
            )
            .bind(player_id)
            .bind(&appearance.skin_id)
            .bind(&appearance.hair_color_id)
            .execute(&mut *self.tx)
            .await
            .map_err(|e| map_sqlx_error(&e))?;
        }
        Ok(revision)
    }

    async fn credit_materials(
        &mut self,
        player_id: &str,
        credit: Credit,
    ) -> Result<u64, RepositoryError> {
        let plastic = to_i64(credit.plastic, "credited_plastic")?;
        let metal = to_i64(credit.metal, "credited_metal")?;
        self.bump(player_id, 0, plastic, metal).await
    }

    async fn record_operation(
        &mut self,
        operation: &EconomicOperationRecord,
    ) -> Result<(), RepositoryError> {
        let status = match operation.status {
            OperationStatus::Applied => "applied",
            OperationStatus::Rejected => "rejected",
        };
        let revision = operation
            .profile_revision_after
            .map(|r| to_i64(r, "revision"))
            .transpose()?;
        sqlx::query(
            "INSERT INTO player.economic_operations \
             (player_id, request_id, operation_type, request_fingerprint, catalog_version, \
              status, rejection_code, profile_revision_after) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
        )
        .bind(&operation.player_id)
        .bind(&operation.request_id)
        .bind(&operation.operation_type)
        .bind(&operation.request_fingerprint)
        .bind(&operation.catalog_version)
        .bind(status)
        .bind(operation.rejection.map(MutationRejection::as_code))
        .bind(revision)
        .execute(&mut *self.tx)
        .await
        .map_err(|e| map_sqlx_error(&e))?;
        Ok(())
    }

    async fn record_settlement(
        &mut self,
        settlement: &SettlementRecord,
    ) -> Result<(), RepositoryError> {
        sqlx::query(
            "INSERT INTO player.settlements \
             (race_id, player_id, result_fingerprint, credited_plastic, credited_metal, \
              profile_revision_after) \
             VALUES ($1, $2, $3, $4, $5, $6)",
        )
        .bind(&settlement.race_id)
        .bind(&settlement.player_id)
        .bind(&settlement.result_fingerprint)
        .bind(to_i64(settlement.credited_plastic, "credited_plastic")?)
        .bind(to_i64(settlement.credited_metal, "credited_metal")?)
        .bind(to_i64(settlement.profile_revision_after, "revision")?)
        .execute(&mut *self.tx)
        .await
        .map_err(|e| map_sqlx_error(&e))?;
        Ok(())
    }

    async fn commit(self: Box<Self>) -> Result<(), RepositoryError> {
        self.tx.commit().await.map_err(|e| map_sqlx_error(&e))
    }
}
