package matchstore

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
)

// SaveSession records an issued session by token hash; the token itself is
// never stored. Re-saving the same pair is harmless.
func (p *Postgres) SaveSession(ctx context.Context, tokenHash []byte, playerID string) error {
	_, err := p.pool.Exec(ctx, `INSERT INTO match.sessions(token_hash,player_id) VALUES($1,$2)
 ON CONFLICT(token_hash) DO NOTHING`, tokenHash, playerID)
	return err
}

// LoadSession resolves a token hash issued by any earlier Go process.
func (p *Postgres) LoadSession(ctx context.Context, tokenHash []byte) (string, bool, error) {
	var playerID string
	err := p.pool.QueryRow(ctx, `SELECT player_id FROM match.sessions WHERE token_hash=$1`, tokenHash).Scan(&playerID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return playerID, true, nil
}
