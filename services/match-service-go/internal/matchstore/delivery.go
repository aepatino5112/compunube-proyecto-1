package matchstore

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

var ErrStaleClaim = errors.New("settlement delivery claim is stale")

// ClaimDue atomically leases one due row with PostgreSQL row locking. A crashed
// worker leaves it pending; the lease expiry permits a retry with the same
// (race_id, player_id) idempotency key.
func (p *Postgres) ClaimDue(ctx context.Context, now time.Time, lease time.Duration) (Delivery, bool, error) {
	if lease <= 0 {
		return Delivery{}, false, errors.New("positive settlement lease required")
	}
	var d Delivery
	err := p.pool.QueryRow(ctx, `WITH picked AS (
 SELECT d.race_id,d.player_id FROM match.settlement_delivery d
 WHERE d.state='pending' AND (d.next_attempt_at IS NULL OR d.next_attempt_at<=$1)
 ORDER BY d.next_attempt_at NULLS FIRST,d.updated_at,d.race_id,d.player_id
 LIMIT 1 FOR UPDATE OF d SKIP LOCKED
 ), claimed AS (
 UPDATE match.settlement_delivery d SET attempt_count=d.attempt_count+1,next_attempt_at=$2,updated_at=$1
 FROM picked WHERE d.race_id=picked.race_id AND d.player_id=picked.player_id
 RETURNING d.race_id,d.player_id,d.attempt_count,d.state,d.next_attempt_at
 )
 SELECT r.room_id,c.race_id,c.player_id,p.outcome,p.credited_plastic,p.credited_metal,c.attempt_count,c.state,c.next_attempt_at
 FROM claimed c JOIN match.race_participants p USING(race_id,player_id) JOIN match.races r USING(race_id)`, now, now.Add(lease)).Scan(&d.RoomID, &d.RaceID, &d.PlayerID, &d.Outcome, &d.CreditedPlastic, &d.CreditedMetal, &d.AttemptCount, &d.State, &d.NextAttemptAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Delivery{}, false, nil
	}
	if err != nil {
		return Delivery{}, false, err
	}
	return d, true, nil
}

// Confirm changes one claimed delivery and tests global confirmation in the
// same transaction. A late worker cannot confirm a row reclaimed by another.
func (p *Postgres) Confirm(ctx context.Context, d Delivery, now time.Time) (bool, error) {
	tx, err := p.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return false, err
	}
	defer tx.Rollback(ctx)
	// Serialize confirmations for one race. Without this lock two workers can
	// each observe the other's uncommitted row and both miss the all-confirmed
	// transition after committing.
	var lockedRaceID string
	if err = tx.QueryRow(ctx, `SELECT race_id FROM match.races WHERE race_id=$1 FOR UPDATE`, d.RaceID).Scan(&lockedRaceID); err != nil {
		return false, err
	}
	tag, err := tx.Exec(ctx, `UPDATE match.settlement_delivery SET state='confirmed',confirmed_at=$4,next_attempt_at=NULL,last_error_code=NULL,updated_at=$4
 WHERE race_id=$1 AND player_id=$2 AND attempt_count=$3 AND state='pending'`, d.RaceID, d.PlayerID, d.AttemptCount, now)
	if err != nil {
		return false, err
	}
	if tag.RowsAffected() != 1 {
		return false, ErrStaleClaim
	}
	var total, confirmed int
	err = tx.QueryRow(ctx, `SELECT count(*),count(*) FILTER (WHERE state='confirmed') FROM match.settlement_delivery WHERE race_id=$1`, d.RaceID).Scan(&total, &confirmed)
	if err != nil {
		return false, err
	}
	if err = tx.Commit(ctx); err != nil {
		return false, err
	}
	return total > 0 && total == confirmed, nil
}
func (p *Postgres) Retry(ctx context.Context, d Delivery, at time.Time, code string) error {
	tag, err := p.pool.Exec(ctx, `UPDATE match.settlement_delivery SET next_attempt_at=$4,last_error_code=$5,updated_at=now()
 WHERE race_id=$1 AND player_id=$2 AND attempt_count=$3 AND state='pending'`, d.RaceID, d.PlayerID, d.AttemptCount, at, code)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return ErrStaleClaim
	}
	return nil
}
func (p *Postgres) Fail(ctx context.Context, d Delivery, code string) error {
	tag, err := p.pool.Exec(ctx, `UPDATE match.settlement_delivery SET state='failed',next_attempt_at=NULL,last_error_code=$4,updated_at=now()
 WHERE race_id=$1 AND player_id=$2 AND attempt_count=$3 AND state='pending'`, d.RaceID, d.PlayerID, d.AttemptCount, code)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return ErrStaleClaim
	}
	return nil
}
