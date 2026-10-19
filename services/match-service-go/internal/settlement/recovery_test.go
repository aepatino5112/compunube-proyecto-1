package settlement

import (
	"context"
	"io"
	"log/slog"
	"sync"
	"testing"
	"time"

	"github.com/aepatino5112/compunube-proyecto-1/services/match-service-go/internal/matchstore"
	"github.com/aepatino5112/compunube-proyecto-1/services/match-service-go/internal/playerprofile"
	"github.com/aepatino5112/compunube-proyecto-1/services/match-service-go/internal/workpool"
)

type recoveryClock struct {
	mu  sync.Mutex
	now time.Time
}

func (c *recoveryClock) Time() time.Time         { c.mu.Lock(); defer c.mu.Unlock(); return c.now }
func (c *recoveryClock) Advance(d time.Duration) { c.mu.Lock(); c.now = c.now.Add(d); c.mu.Unlock() }
func newRecoveryCoordinator(t *testing.T, f *playerprofile.Fake) (*Coordinator, *memoryStore, *playerprofile.ResilientPort, *workpool.Pool, *workpool.Pool, *recoveryClock) {
	t.Helper()
	clock := &recoveryClock{now: time.Now()}
	port, err := playerprofile.NewResilient(f, playerprofile.ResilienceOptions{FailureThreshold: 1, OpenDuration: 10 * time.Second, HalfOpenProbes: 1, ReadMaxRetries: 0, RetryBase: time.Millisecond, RetryCap: time.Millisecond, Clock: clock.Time})
	if err != nil {
		t.Fatal(err)
	}
	profilePool, err := workpool.New(context.Background(), 2, 4, 200*time.Millisecond)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(profilePool.Close)
	settlementPool, err := workpool.New(context.Background(), 2, 4, 200*time.Millisecond)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(settlementPool.Close)
	store := newStore()
	c := &Coordinator{store: store, port: port, prober: playerprofile.RecoveryProber{Port: port, Pool: profilePool}, pool: settlementPool, ctx: context.Background(), logger: slog.New(slog.NewTextHandler(io.Discard, nil))}
	return c, store, port, profilePool, settlementPool, clock
}
func claim(t *testing.T, s *memoryStore, after time.Duration) matchstore.Delivery {
	t.Helper()
	d, ok, err := s.ClaimDue(context.Background(), time.Now().Add(after), time.Second)
	if err != nil || !ok {
		t.Fatalf("delivery not due: %v %t", err, ok)
	}
	return d
}
func TestAutonomousRecoveryWithoutUserTraffic(t *testing.T) {
	mutations, reads := 0, 0
	f := &playerprofile.Fake{
		SettleRaceFn: func(_ context.Context, c playerprofile.SettlementCommand) (playerprofile.SettlementResult, error) {
			mutations++
			if c.RaceID != "race" || c.PlayerID != "a" {
				t.Errorf("key changed: %+v", c)
			}
			if mutations == 1 {
				return playerprofile.SettlementResult{}, &playerprofile.Fault{Kind: playerprofile.Unavailable, Code: "UNAVAILABLE"}
			}
			return playerprofile.SettlementResult{RaceID: c.RaceID, PlayerID: c.PlayerID}, nil
		},
		GetProfileFn: func(_ context.Context, id string) (playerprofile.Profile, error) {
			reads++
			if id != "a" {
				t.Error(id)
			}
			return playerprofile.Profile{PlayerID: id}, nil
		},
	}
	c, s, p, profilePool, settlementPool, clock := newRecoveryCoordinator(t, f)
	d := delivery("a", "finished", 2)
	s.add(d)
	c.process(d)
	if mutations != 1 || reads != 0 || p.Stats().State != playerprofile.Open || s.get(d).State != "pending" {
		t.Fatalf("initial outage: mutation=%d read=%d state=%+v row=%+v", mutations, reads, p.Stats(), s.get(d))
	}
	clock.Advance(10 * time.Second)
	second := claim(t, s, 2*time.Second)
	c.process(second)
	row := s.get(d)
	if mutations != 1 || reads != 1 || p.Stats().State != playerprofile.Closed || row.State != "pending" || row.NextAttemptAt == nil || !row.NextAttemptAt.After(time.Now()) || row.AttemptCount != 2 {
		t.Fatalf("probe changed delivery: mutation=%d read=%d state=%+v row=%+v", mutations, reads, p.Stats(), row)
	}
	if profilePool.Stats().Accepted != 1 || settlementPool.Stats().Accepted != 2 {
		t.Fatalf("wrong pools: profile=%+v settlement=%+v", profilePool.Stats(), settlementPool.Stats())
	}
	third := claim(t, s, 5*time.Second)
	c.process(third)
	if mutations != 2 || reads != 1 || s.get(d).State != "confirmed" || profilePool.Stats().Accepted != 1 || settlementPool.Stats().Accepted != 3 {
		t.Fatalf("not recovered: mutation=%d read=%d row=%+v", mutations, reads, s.get(d))
	}
}
func TestRecoveryProbeWhenRustStillDown(t *testing.T) {
	mutations, reads := 0, 0
	f := &playerprofile.Fake{SettleRaceFn: func(context.Context, playerprofile.SettlementCommand) (playerprofile.SettlementResult, error) {
		mutations++
		return playerprofile.SettlementResult{}, &playerprofile.Fault{Kind: playerprofile.Unavailable, Code: "UNAVAILABLE"}
	}, GetProfileFn: func(context.Context, string) (playerprofile.Profile, error) {
		reads++
		return playerprofile.Profile{}, &playerprofile.Fault{Kind: playerprofile.Unavailable, Code: "UNAVAILABLE"}
	}}
	c, s, p, _, _, clock := newRecoveryCoordinator(t, f)
	d := delivery("a", "finished", 2)
	s.add(d)
	c.process(d)
	// Claiming a due row while open must not emit a GetProfile RPC or hot-loop.
	c.process(claim(t, s, 2*time.Second))
	if mutations != 1 || reads != 0 || p.Stats().State != playerprofile.Open {
		t.Fatalf("open sent RPC: %d %d %+v", mutations, reads, p.Stats())
	}
	if _, ok, _ := s.ClaimDue(context.Background(), time.Now(), time.Second); ok {
		t.Fatal("retry hot-looped")
	}
	clock.Advance(10 * time.Second)
	c.process(claim(t, s, 5*time.Second))
	row := s.get(d)
	if mutations != 1 || reads != 1 || p.Stats().State != playerprofile.Open || row.State != "pending" || row.NextAttemptAt == nil || !row.NextAttemptAt.After(time.Now()) {
		t.Fatalf("failed probe: mutation=%d read=%d circuit=%+v row=%+v", mutations, reads, p.Stats(), row)
	}
}
func TestBusinessProbeClosesCircuitWithoutConfirmation(t *testing.T) {
	mutations, reads := 0, 0
	f := &playerprofile.Fake{SettleRaceFn: func(context.Context, playerprofile.SettlementCommand) (playerprofile.SettlementResult, error) {
		mutations++
		return playerprofile.SettlementResult{}, &playerprofile.Fault{Kind: playerprofile.Unavailable, Code: "UNAVAILABLE"}
	}, GetProfileFn: func(context.Context, string) (playerprofile.Profile, error) {
		reads++
		return playerprofile.Profile{}, &playerprofile.Fault{Kind: playerprofile.Business, Code: "INVALID_ARGUMENT"}
	}}
	c, s, p, _, _, clock := newRecoveryCoordinator(t, f)
	d := delivery("a", "finished", 2)
	s.add(d)
	c.process(d)
	clock.Advance(10 * time.Second)
	c.process(claim(t, s, 2*time.Second))
	if p.Stats().State != playerprofile.Closed || s.get(d).State != "pending" || mutations != 1 || reads != 1 {
		t.Fatalf("business probe: circuit=%+v row=%+v mutations=%d reads=%d", p.Stats(), s.get(d), mutations, reads)
	}
}
func TestClosedCircuitNeedsNoRecoveryRead(t *testing.T) {
	reads := 0
	f := &playerprofile.Fake{SettleRaceFn: func(context.Context, playerprofile.SettlementCommand) (playerprofile.SettlementResult, error) {
		return playerprofile.SettlementResult{}, nil
	}, GetProfileFn: func(context.Context, string) (playerprofile.Profile, error) {
		reads++
		return playerprofile.Profile{}, nil
	}}
	c, s, _, profilePool, _, _ := newRecoveryCoordinator(t, f)
	d := delivery("a", "finished", 2)
	s.add(d)
	if err := c.prober.Probe(context.Background(), "a"); err != nil {
		t.Fatal(err)
	}
	c.process(d)
	if reads != 0 || profilePool.Stats().Accepted != 0 || s.get(d).State != "confirmed" {
		t.Fatalf("closed probe: reads=%d pool=%+v row=%+v", reads, profilePool.Stats(), s.get(d))
	}
}

func TestCoordinatorShutdownCancelsActiveRecoveryProbe(t *testing.T) {
	entered := make(chan struct{})
	f := &playerprofile.Fake{
		SettleRaceFn: func(context.Context, playerprofile.SettlementCommand) (playerprofile.SettlementResult, error) {
			return playerprofile.SettlementResult{}, &playerprofile.Fault{Kind: playerprofile.Unavailable, Code: "UNAVAILABLE"}
		},
		GetProfileFn: func(ctx context.Context, _ string) (playerprofile.Profile, error) {
			close(entered)
			<-ctx.Done()
			return playerprofile.Profile{}, ctx.Err()
		},
	}
	fixture, store, port, profilePool, settlementPool, clock := newRecoveryCoordinator(t, f)
	_, _ = port.SettleRace(context.Background(), playerprofile.SettlementCommand{})
	clock.Advance(10 * time.Second)
	d := delivery("a", "finished", 2)
	d.AttemptCount = 0
	store.add(d)
	coordinator, err := New(context.Background(), store, port, fixture.prober, settlementPool, nil, nil, 1, fixture.logger)
	if err != nil {
		t.Fatal(err)
	}
	select {
	case <-entered:
	case <-time.After(time.Second):
		coordinator.Close()
		t.Fatal("recovery probe did not start")
	}
	closed := make(chan struct{})
	go func() { coordinator.Close(); close(closed) }()
	select {
	case <-closed:
	case <-time.After(time.Second):
		t.Fatal("coordinator did not stop")
	}
	profileClosed := make(chan struct{})
	go func() { profilePool.Close(); close(profileClosed) }()
	select {
	case <-profileClosed:
	case <-time.After(time.Second):
		t.Fatal("profile workers did not stop")
	}
	if store.get(d).State != "pending" {
		t.Fatal("shutdown confirmed delivery")
	}
}
