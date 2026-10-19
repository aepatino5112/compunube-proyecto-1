package playerprofile

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/aepatino5112/compunube-proyecto-1/services/match-service-go/internal/workpool"
)

type probeClock struct {
	mu  sync.Mutex
	now time.Time
}

func (c *probeClock) Time() time.Time         { c.mu.Lock(); defer c.mu.Unlock(); return c.now }
func (c *probeClock) Advance(d time.Duration) { c.mu.Lock(); c.now = c.now.Add(d); c.mu.Unlock() }
func openForProbe(t *testing.T, f *Fake) (*ResilientPort, *probeClock) {
	t.Helper()
	clock := &probeClock{now: time.Now()}
	port, err := NewResilient(f, ResilienceOptions{FailureThreshold: 1, OpenDuration: time.Second, HalfOpenProbes: 1, ReadMaxRetries: 0, RetryBase: time.Millisecond, RetryCap: time.Millisecond, Clock: clock.Time})
	if err != nil {
		t.Fatal(err)
	}
	_, _ = port.SettleRace(context.Background(), SettlementCommand{})
	if port.Stats().State != Open {
		t.Fatal("circuit did not open")
	}
	return port, clock
}
func TestRecoveryProberSingleHalfOpenRead(t *testing.T) {
	entered := make(chan struct{})
	release := make(chan struct{})
	calls := 0
	f := &Fake{SettleRaceFn: func(context.Context, SettlementCommand) (SettlementResult, error) {
		return SettlementResult{}, &Fault{Kind: Unavailable}
	}, GetProfileFn: func(ctx context.Context, id string) (Profile, error) {
		calls++
		if id != "player" {
			t.Error(id)
		}
		close(entered)
		select {
		case <-release:
			return Profile{PlayerID: id}, nil
		case <-ctx.Done():
			return Profile{}, ctx.Err()
		}
	}}
	port, clock := openForProbe(t, f)
	pool, err := workpool.New(context.Background(), 2, 2, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	prober := RecoveryProber{Port: port, Pool: pool}
	if err := prober.Probe(context.Background(), "player"); Kind(err) != Unavailable {
		t.Fatalf("open probe: %v", err)
	}
	if calls != 0 || pool.Stats().Accepted != 0 {
		t.Fatal("open emitted read")
	}
	clock.Advance(time.Second)
	done := make(chan error, 1)
	go func() { done <- prober.Probe(context.Background(), "player") }()
	<-entered
	err = prober.Probe(context.Background(), "player")
	if Kind(err) != Unavailable || calls != 1 || port.Stats().State != HalfOpen {
		t.Fatalf("concurrent probe: err=%v calls=%d state=%+v", err, calls, port.Stats())
	}
	close(release)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if port.Stats().State != Closed || pool.Stats().Accepted != 2 {
		t.Fatalf("probe not closed: circuit=%+v pool=%+v", port.Stats(), pool.Stats())
	}
	if err := prober.Probe(context.Background(), "player"); err != nil || calls != 1 {
		t.Fatalf("closed emitted read: %v %d", err, calls)
	}
}
func TestRecoveryProberCancellationAndPoolShutdown(t *testing.T) {
	entered := make(chan struct{})
	f := &Fake{SettleRaceFn: func(context.Context, SettlementCommand) (SettlementResult, error) {
		return SettlementResult{}, &Fault{Kind: Unavailable}
	}, GetProfileFn: func(ctx context.Context, _ string) (Profile, error) {
		close(entered)
		<-ctx.Done()
		return Profile{}, ctx.Err()
	}}
	port, clock := openForProbe(t, f)
	clock.Advance(time.Second)
	root, cancel := context.WithCancel(context.Background())
	pool, err := workpool.New(root, 1, 1, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	prober := RecoveryProber{Port: port, Pool: pool}
	done := make(chan error, 1)
	go func() { done <- prober.Probe(root, "player") }()
	<-entered
	cancel()
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("probe did not cancel")
	}
	closed := make(chan struct{})
	go func() { pool.Close(); close(closed) }()
	select {
	case <-closed:
	case <-time.After(time.Second):
		t.Fatal("profile workers did not stop")
	}
	if port.Stats().State == Closed {
		t.Fatal("cancellation marked dependency healthy")
	}
}
func TestRecoveryProberSaturatedPoolDoesNotCloseCircuit(t *testing.T) {
	calls := 0
	f := &Fake{SettleRaceFn: func(context.Context, SettlementCommand) (SettlementResult, error) {
		return SettlementResult{}, &Fault{Kind: Unavailable}
	}, GetProfileFn: func(context.Context, string) (Profile, error) { calls++; return Profile{}, nil }}
	port, clock := openForProbe(t, f)
	clock.Advance(time.Second)
	root, cancel := context.WithCancel(context.Background())
	defer cancel()
	pool, err := workpool.New(root, 1, 1, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	entered := make(chan struct{})
	hold := make(chan struct{})
	first, err := pool.Submit(root, func(context.Context) error { close(entered); <-hold; return nil })
	if err != nil {
		t.Fatal(err)
	}
	<-entered
	second, err := pool.Submit(root, func(context.Context) error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	prober := RecoveryProber{Port: port, Pool: pool}
	if err := prober.Probe(root, "player"); !errors.Is(err, workpool.ErrSaturated) {
		t.Fatal(err)
	}
	if calls != 0 || port.Stats().State != HalfOpen {
		t.Fatalf("saturation marked healthy: calls=%d state=%+v", calls, port.Stats())
	}
	close(hold)
	<-first
	<-second
}
