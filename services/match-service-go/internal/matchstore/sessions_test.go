package matchstore

import (
	"bytes"
	"context"
	"crypto/sha256"
	"testing"
	"time"
)

func TestPostgresSessionsRoundTrip(t *testing.T) {
	url := testDatabaseURL(t)
	ctx := context.Background()
	store, err := Open(ctx, url, 2)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(store.Close)
	suffix := time.Now().Format("20060102150405.000000000")
	hash := sha256.Sum256([]byte("token-" + suffix))
	playerID := "p_session_" + suffix
	t.Cleanup(func() {
		_, _ = store.pool.Exec(context.Background(), `DELETE FROM match.sessions WHERE token_hash=$1`, hash[:])
	})
	if _, found, err := store.LoadSession(ctx, hash[:]); err != nil || found {
		t.Fatalf("unknown session: found=%v err=%v", found, err)
	}
	for i := 0; i < 2; i++ { // re-saving the same pair is harmless
		if err := store.SaveSession(ctx, hash[:], playerID); err != nil {
			t.Fatal(err)
		}
	}
	got, found, err := store.LoadSession(ctx, hash[:])
	if err != nil || !found || got != playerID {
		t.Fatalf("restored %q found=%v err=%v", got, found, err)
	}
	var stored []byte
	if err := store.pool.QueryRow(ctx, `SELECT token_hash FROM match.sessions WHERE player_id=$1`, playerID).Scan(&stored); err != nil || !bytes.Equal(stored, hash[:]) {
		t.Fatalf("only the 32-byte hash is stored: %x %v", stored, err)
	}
	other := sha256.Sum256([]byte("other-" + suffix))
	if err := store.SaveSession(ctx, other[:], playerID); err == nil {
		_, _ = store.pool.Exec(context.Background(), `DELETE FROM match.sessions WHERE token_hash=$1`, other[:])
		t.Fatal("one player id must map to a single session")
	}
	if err := store.SaveSession(ctx, []byte("short"), "p_bad_"+suffix); err == nil {
		t.Fatal("a value that is not a SHA-256 hash was stored")
	}
}
