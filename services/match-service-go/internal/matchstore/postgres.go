package matchstore

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Postgres struct{ pool *pgxpool.Pool }

func Open(ctx context.Context, databaseURL string, maxConns int32) (*Postgres, error) {
	cfg, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, errors.New("invalid PostgreSQL configuration")
	}
	if maxConns > 0 {
		cfg.MaxConns = maxConns
	}
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("create PostgreSQL pool: %w", err)
	}
	return &Postgres{pool: pool}, nil
}
func (p *Postgres) Close()                         { p.pool.Close() }
func (p *Postgres) Ping(ctx context.Context) error { return p.pool.Ping(ctx) }
func (p *Postgres) Save(ctx context.Context, record Record) error {
	if err := Validate(record); err != nil {
		return err
	}
	tx, err := p.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	created := record.CreatedAt.Truncate(time.Microsecond)
	var closed any
	if record.ClosedAt != nil {
		closed = record.ClosedAt.Truncate(time.Microsecond)
	}
	tag, err := tx.Exec(ctx, `INSERT INTO match.rooms(room_id,map_id,created_at,closed_at) VALUES($1,$2,$3,$4)
 ON CONFLICT(room_id) DO UPDATE SET closed_at=COALESCE(match.rooms.closed_at,EXCLUDED.closed_at)
 WHERE match.rooms.map_id=EXCLUDED.map_id AND match.rooms.created_at=EXCLUDED.created_at
 AND (match.rooms.closed_at IS NULL OR EXCLUDED.closed_at IS NULL OR match.rooms.closed_at=EXCLUDED.closed_at)`, record.RoomID, record.MapID, created, closed)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return ErrConflict
	}
	if record.RaceID == "" {
		return tx.Commit(ctx)
	}
	var first, ended any
	if record.FirstFinishedAt != nil {
		first = record.FirstFinishedAt.Truncate(time.Microsecond)
	}
	if record.Result != nil {
		ended = time.UnixMilli(record.Result.EndedAtMs).UTC()
	}
	tag, err = tx.Exec(ctx, `INSERT INTO match.races(race_id,room_id,rules_version,course_version,started_at,first_finished_at,ended_at)
 VALUES($1,$2,$3,$4,$5,$6,$7)
 ON CONFLICT(race_id) DO UPDATE SET first_finished_at=COALESCE(match.races.first_finished_at,EXCLUDED.first_finished_at),ended_at=COALESCE(match.races.ended_at,EXCLUDED.ended_at)
 WHERE match.races.room_id=EXCLUDED.room_id AND match.races.rules_version=EXCLUDED.rules_version
 AND match.races.course_version=EXCLUDED.course_version AND match.races.started_at=EXCLUDED.started_at
 AND (match.races.first_finished_at IS NULL OR EXCLUDED.first_finished_at IS NULL OR match.races.first_finished_at=EXCLUDED.first_finished_at)
 AND (match.races.ended_at IS NULL OR EXCLUDED.ended_at IS NULL OR match.races.ended_at=EXCLUDED.ended_at)`, record.RaceID, record.RoomID, record.RulesVersion, record.CourseVersion, record.StartedAt.Truncate(time.Microsecond), first, ended)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return ErrConflict
	}
	if record.Result == nil {
		return tx.Commit(ctx)
	}
	var existing int
	if err = tx.QueryRow(ctx, `SELECT count(*) FROM match.race_participants WHERE race_id=$1`, record.RaceID).Scan(&existing); err != nil {
		return err
	}
	if existing != 0 && existing != len(record.Result.Participants) {
		return ErrConflict
	}
	for _, part := range record.Result.Participants {
		tag, err = tx.Exec(ctx, `INSERT INTO match.race_participants(race_id,player_id,outcome,rank,finish_time_ms,collected_plastic,collected_metal,credited_plastic,credited_metal,reduce_choice)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(race_id,player_id) DO NOTHING`, record.RaceID, part.PlayerID, part.Outcome, part.Rank, part.FinishTimeMs, part.Collected.Plastic, part.Collected.Metal, part.Credited.Plastic, part.Credited.Metal, part.ReduceChoice)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			var outcome, choice string
			var rank *int
			var finish *int64
			var cp, cm, crp, crm int
			err = tx.QueryRow(ctx, `SELECT outcome,rank,finish_time_ms,collected_plastic,collected_metal,credited_plastic,credited_metal,reduce_choice FROM match.race_participants WHERE race_id=$1 AND player_id=$2`, record.RaceID, part.PlayerID).Scan(&outcome, &rank, &finish, &cp, &cm, &crp, &crm, &choice)
			if err != nil {
				return err
			}
			if outcome != part.Outcome || choice != part.ReduceChoice || cp != part.Collected.Plastic || cm != part.Collected.Metal || crp != part.Credited.Plastic || crm != part.Credited.Metal || !sameInt(rank, part.Rank) || !sameInt64(finish, part.FinishTimeMs) {
				return ErrConflict
			}
		}
		_, err = tx.Exec(ctx, `INSERT INTO match.settlement_delivery(race_id,player_id,state) VALUES($1,$2,'pending') ON CONFLICT(race_id,player_id) DO NOTHING`, record.RaceID, part.PlayerID)
		if err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}
func sameInt(a, b *int) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}
func sameInt64(a, b *int64) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}

// Due reads the durable queue. Permanent failed rows are intentionally excluded
// from automatic retry and remain available for operator diagnosis.
func (p *Postgres) Due(ctx context.Context, now time.Time, limit int) ([]Delivery, error) {
	if limit < 1 {
		return nil, errors.New("limit must be positive")
	}
	rows, err := p.pool.Query(ctx, `SELECT d.race_id,d.player_id,p.outcome,p.credited_plastic,p.credited_metal,d.attempt_count,d.state,d.next_attempt_at
 FROM match.settlement_delivery d JOIN match.race_participants p USING(race_id,player_id)
 WHERE d.state='pending' AND (d.next_attempt_at IS NULL OR d.next_attempt_at<=$1)
 ORDER BY d.next_attempt_at NULLS FIRST,d.updated_at,d.race_id,d.player_id LIMIT $2`, now, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Delivery{}
	for rows.Next() {
		var d Delivery
		if err = rows.Scan(&d.RaceID, &d.PlayerID, &d.Outcome, &d.CreditedPlastic, &d.CreditedMetal, &d.AttemptCount, &d.State, &d.NextAttemptAt); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}
func (p *Postgres) Failed(ctx context.Context, limit int) ([]Delivery, error) {
	if limit < 1 {
		return nil, errors.New("limit must be positive")
	}
	rows, err := p.pool.Query(ctx, `SELECT d.race_id,d.player_id,p.outcome,p.credited_plastic,p.credited_metal,d.attempt_count,d.state,d.next_attempt_at
 FROM match.settlement_delivery d JOIN match.race_participants p USING(race_id,player_id)
 WHERE d.state='failed' ORDER BY d.updated_at DESC LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Delivery{}
	for rows.Next() {
		var d Delivery
		if err = rows.Scan(&d.RaceID, &d.PlayerID, &d.Outcome, &d.CreditedPlastic, &d.CreditedMetal, &d.AttemptCount, &d.State, &d.NextAttemptAt); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}
