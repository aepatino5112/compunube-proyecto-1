package matchstore

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/aepatino5112/compunube-proyecto-1/services/match-service-go/internal/race"
)

func fixture() Record {
	rank := 1
	finish := int64(1200)
	result := race.RaceResult{RaceID: "race-test", RoomID: "room-test", RulesVersion: "surf-mvp-1", CourseVersion: "maracaibo-surf-mvp-1", EndedAtMs: time.Unix(100, 0).UnixMilli(), Participants: []race.ParticipantResult{
		{PlayerID: "a", Outcome: "finished", Rank: &rank, FinishTimeMs: &finish, Collected: race.MaterialCounts{Plastic: 2, Metal: 1}, Credited: race.MaterialCounts{Plastic: 2, Metal: 1}, ReduceChoice: "reusable", SettlementState: "pending"},
		{PlayerID: "b", Outcome: "dnf", Collected: race.MaterialCounts{Plastic: 3}, ReduceChoice: "disposable", SettlementState: "pending"},
	}}
	return Record{RoomID: "room-test", MapID: "maracaibo", CreatedAt: time.Unix(90, 0), RaceID: result.RaceID, RulesVersion: result.RulesVersion, CourseVersion: result.CourseVersion, StartedAt: time.Unix(91, 0), Result: &result}
}
func TestValidateResults(t *testing.T) {
	r := fixture()
	if err := Validate(r); err != nil {
		t.Fatal(err)
	}
	r.Result.Participants[1].Credited.Plastic = 1
	if err := Validate(r); err == nil {
		t.Fatal("non-finisher credited")
	}
	r = fixture()
	r.Result.Participants[0].Rank = nil
	if err := Validate(r); err == nil {
		t.Fatal("finished without rank")
	}
}

type fakeRepo struct {
	mu    sync.Mutex
	fail  bool
	saved []Record
}

func (f *fakeRepo) Save(_ context.Context, r Record) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.fail {
		return errors.New("db down")
	}
	f.saved = append(f.saved, CopyRecord(r))
	return nil
}
func (f *fakeRepo) Due(context.Context, time.Time, int) ([]Delivery, error) { return nil, nil }
func TestAsyncKeepsResultUntilDurable(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	repo := &fakeRepo{fail: true}
	a := NewAsync(ctx, repo, slog.New(slog.NewTextHandler(io.Discard, nil)))
	a.Offer(fixture())
	if a.Pending() != 1 {
		t.Fatal("result was discarded during DB outage")
	}
	repo.mu.Lock()
	repo.fail = false
	repo.mu.Unlock()
	select {
	case a.wake <- struct{}{}:
	default:
	}
	deadline := time.Now().Add(time.Second)
	for a.Pending() != 0 {
		if time.Now().After(deadline) {
			t.Fatal("result did not retry")
		}
		time.Sleep(time.Millisecond)
	}
	cancel()
	a.Close()
	repo.mu.Lock()
	defer repo.mu.Unlock()
	if len(repo.saved) != 1 || repo.saved[0].Result.Participants[0].Credited.Plastic != 2 {
		t.Fatal("stored wrong result")
	}
}
func TestPostgresRoundTrip(t *testing.T) {
	url := os.Getenv("MATCHSTORE_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("set MATCHSTORE_TEST_DATABASE_URL for migrated isolated PostgreSQL")
	}
	ctx := context.Background()
	store, err := Open(ctx, url, 4)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(store.Close)
	if err = store.Ping(ctx); err != nil {
		t.Fatal(err)
	}
	r := fixture()
	suffix := time.Now().Format("20060102150405.000000000")
	r.RoomID += suffix
	r.RaceID += suffix
	r.Result.RoomID = r.RoomID
	r.Result.RaceID = r.RaceID
	t.Cleanup(func() {
		_, _ = store.pool.Exec(context.Background(), `DELETE FROM match.settlement_delivery WHERE race_id=$1`, r.RaceID)
		_, _ = store.pool.Exec(context.Background(), `DELETE FROM match.race_participants WHERE race_id=$1`, r.RaceID)
		_, _ = store.pool.Exec(context.Background(), `DELETE FROM match.races WHERE race_id=$1`, r.RaceID)
		_, _ = store.pool.Exec(context.Background(), `DELETE FROM match.rooms WHERE room_id=$1`, r.RoomID)
	})
	startOnly := CopyRecord(r)
	startOnly.Result = nil
	if err = store.Save(ctx, startOnly); err != nil {
		t.Fatalf("save race start: %v", err)
	}
	if err = store.Save(ctx, r); err != nil {
		t.Fatal(err)
	}
	if err = store.Save(ctx, r); err != nil {
		t.Fatalf("idempotent replay: %v", err)
	}
	due, err := store.Due(ctx, time.Now(), 100)
	if err != nil {
		t.Fatal(err)
	}
	found := map[string]Delivery{}
	for _, d := range due {
		if d.RaceID == r.RaceID {
			found[d.PlayerID] = d
		}
	}
	if len(found) != 2 || found["a"].CreditedPlastic != 2 || found["b"].CreditedPlastic != 0 {
		t.Fatalf("due deliveries: %+v", found)
	}
	var participants, deliveries int
	if err = store.pool.QueryRow(ctx, `SELECT count(*) FROM match.race_participants WHERE race_id=$1`, r.RaceID).Scan(&participants); err != nil {
		t.Fatal(err)
	}
	if err = store.pool.QueryRow(ctx, `SELECT count(*) FROM match.settlement_delivery WHERE race_id=$1`, r.RaceID).Scan(&deliveries); err != nil {
		t.Fatal(err)
	}
	if participants != 2 || deliveries != 2 {
		t.Fatalf("duplicate/missing rows: %d participants, %d deliveries", participants, deliveries)
	}
	future := time.Now().Add(time.Hour)
	if _, err = store.pool.Exec(ctx, `UPDATE match.settlement_delivery SET next_attempt_at=$3 WHERE race_id=$1 AND player_id=$2`, r.RaceID, "b", future); err != nil {
		t.Fatal(err)
	}
	due, err = store.Due(ctx, time.Now(), 100)
	if err != nil {
		t.Fatal(err)
	}
	for _, d := range due {
		if d.RaceID == r.RaceID && d.PlayerID == "b" {
			t.Fatal("future delivery returned as due")
		}
	}
	if _, err = store.pool.Exec(ctx, `UPDATE match.settlement_delivery SET state='failed' WHERE race_id=$1 AND player_id=$2`, r.RaceID, "b"); err != nil {
		t.Fatal(err)
	}
	failed, err := store.Failed(ctx, 100)
	if err != nil {
		t.Fatal(err)
	}
	seenFailed := false
	for _, d := range failed {
		if d.RaceID == r.RaceID && d.PlayerID == "b" {
			seenFailed = true
		}
	}
	if !seenFailed {
		t.Fatal("failed delivery not recoverable for diagnosis")
	}
	changed := CopyRecord(r)
	changed.Result.Participants[0].Collected.Plastic = 3
	changed.Result.Participants[0].Credited.Plastic = 3
	if err = store.Save(ctx, changed); !errors.Is(err, ErrConflict) {
		t.Fatalf("immutable result changed: %v", err)
	}
	due, err = store.Due(ctx, time.Now(), 100)
	if err != nil {
		t.Fatal(err)
	}
	for _, d := range due {
		if d.RaceID == r.RaceID && d.PlayerID == "a" && d.CreditedPlastic != 2 {
			t.Fatal("conflict altered durable credit")
		}
	}
}
