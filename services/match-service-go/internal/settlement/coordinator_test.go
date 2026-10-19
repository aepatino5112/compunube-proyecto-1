package settlement

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"sync"
	"testing"
	"time"

	"github.com/aepatino5112/compunube-proyecto-1/services/match-service-go/internal/matchstore"
	"github.com/aepatino5112/compunube-proyecto-1/services/match-service-go/internal/playerprofile"
	"github.com/aepatino5112/compunube-proyecto-1/services/match-service-go/internal/roomruntime"
	"github.com/aepatino5112/compunube-proyecto-1/services/match-service-go/internal/workpool"
)

type memoryStore struct {
	mu           sync.Mutex
	rows         map[string]matchstore.Delivery
	codes        map[string]string
	allConfirmed bool
	retrySignal  chan struct{}
}

func newStore() *memoryStore {
	return &memoryStore{rows: map[string]matchstore.Delivery{}, codes: map[string]string{}, retrySignal: make(chan struct{}, 1)}
}
func key(d matchstore.Delivery) string           { return d.RaceID + "/" + d.PlayerID }
func (s *memoryStore) add(d matchstore.Delivery) { s.mu.Lock(); s.rows[key(d)] = d; s.mu.Unlock() }
func (s *memoryStore) get(d matchstore.Delivery) matchstore.Delivery {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.rows[key(d)]
}
func (s *memoryStore) ClaimDue(_ context.Context, now time.Time, lease time.Duration) (matchstore.Delivery, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for k, d := range s.rows {
		if d.State == "pending" && (d.NextAttemptAt == nil || !d.NextAttemptAt.After(now)) {
			d.AttemptCount++
			at := now.Add(lease)
			d.NextAttemptAt = &at
			s.rows[k] = d
			return d, true, nil
		}
	}
	return matchstore.Delivery{}, false, nil
}
func (s *memoryStore) Confirm(_ context.Context, d matchstore.Delivery, _ time.Time) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	old := s.rows[key(d)]
	if old.State != "pending" || old.AttemptCount != d.AttemptCount {
		return false, matchstore.ErrStaleClaim
	}
	old.State = "confirmed"
	old.NextAttemptAt = nil
	s.rows[key(d)] = old
	all := true
	for _, row := range s.rows {
		if row.RaceID == d.RaceID && row.State != "confirmed" {
			all = false
		}
	}
	s.allConfirmed = all
	return all, nil
}
func (s *memoryStore) Retry(_ context.Context, d matchstore.Delivery, at time.Time, code string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	old := s.rows[key(d)]
	if old.State != "pending" || old.AttemptCount != d.AttemptCount {
		return matchstore.ErrStaleClaim
	}
	old.NextAttemptAt = &at
	s.rows[key(d)] = old
	s.codes[key(d)] = code
	select {
	case s.retrySignal <- struct{}{}:
	default:
	}
	return nil
}
func (s *memoryStore) Fail(_ context.Context, d matchstore.Delivery, code string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	old := s.rows[key(d)]
	if old.State != "pending" || old.AttemptCount != d.AttemptCount {
		return matchstore.ErrStaleClaim
	}
	old.State = "failed"
	s.rows[key(d)] = old
	s.codes[key(d)] = code
	return nil
}

type publisher struct {
	mu         sync.Mutex
	count      int
	failOnce   bool
	room, race string
	ch         chan struct{}
}
type probeFunc func(context.Context, string) error

func (f probeFunc) Probe(ctx context.Context, playerID string) error { return f(ctx, playerID) }

var healthyProbe = probeFunc(func(context.Context, string) error { return nil })

func (p *publisher) ConfirmSettlement(_ context.Context, room, race string) error {
	p.mu.Lock()
	if p.failOnce {
		p.failOnce = false
		p.mu.Unlock()
		return errors.New("room command queue full")
	}
	p.count++
	p.room = room
	p.race = race
	p.mu.Unlock()
	if p.ch != nil {
		select {
		case p.ch <- struct{}{}:
		default:
		}
	}
	return nil
}
func TestPublicationRetriesAfterRoomQueueFull(t *testing.T) {
	store := newStore()
	d := delivery("a", "finished", 2)
	store.add(d)
	port := &playerprofile.Fake{SettleRaceFn: func(context.Context, playerprofile.SettlementCommand) (playerprofile.SettlementResult, error) {
		return playerprofile.SettlementResult{}, nil
	}}
	pub := &publisher{failOnce: true}
	c := testCoordinator(t, store, port, pub)
	c.process(d)
	if store.get(d).State != "confirmed" || pub.Count() != 0 {
		t.Fatal("settlement was not durably confirmed before publish retry")
	}
	c.flushPublish()
	if pub.Count() != 1 {
		t.Fatal("confirmed race was not reemitted after room queue recovered")
	}
}
func (p *publisher) Count() int { p.mu.Lock(); defer p.mu.Unlock(); return p.count }
func testCoordinator(t *testing.T, store *memoryStore, port playerprofile.Port, pub *publisher) *Coordinator {
	t.Helper()
	pool, err := workpool.New(context.Background(), 2, 4, 200*time.Millisecond)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	var publish Publisher
	if pub != nil {
		publish = pub
	}
	return &Coordinator{store: store, port: port, pool: pool, publish: publish, logger: slog.New(slog.NewTextHandler(io.Discard, nil)), ctx: context.Background(), lease: time.Second, poll: time.Millisecond}
}
func delivery(player, outcome string, plastic int64) matchstore.Delivery {
	return matchstore.Delivery{RoomID: "room", RaceID: "race", PlayerID: player, Outcome: outcome, CreditedPlastic: plastic, AttemptCount: 1, State: "pending"}
}
func TestSuccessReplayAndGlobalConfirmation(t *testing.T) {
	store := newStore()
	a := delivery("a", "finished", 2)
	b := delivery("b", "dnf", 0)
	store.add(a)
	store.add(b)
	pub := &publisher{}
	calls := map[string]int{}
	mu := sync.Mutex{}
	port := &playerprofile.Fake{SettleRaceFn: func(_ context.Context, c playerprofile.SettlementCommand) (playerprofile.SettlementResult, error) {
		mu.Lock()
		calls[c.PlayerID]++
		mu.Unlock()
		if c.RaceID != "race" || c.PlayerID == "b" && c.CreditedPlastic != 0 || c.PlayerID == "a" && c.CreditedPlastic != 2 {
			t.Errorf("wrong settlement command: %+v", c)
		}
		return playerprofile.SettlementResult{RaceID: c.RaceID, PlayerID: c.PlayerID, Replayed: true}, nil
	}}
	coordinator := testCoordinator(t, store, port, pub)
	coordinator.process(a)
	if got := store.get(a); got.State != "confirmed" || pub.Count() != 0 {
		t.Fatalf("first settlement: %+v", got)
	}
	coordinator.process(b)
	if got := store.get(b); got.State != "confirmed" || pub.Count() != 1 {
		t.Fatalf("global settlement: %+v pub=%d", got, pub.Count())
	}
	mu.Lock()
	defer mu.Unlock()
	if calls["a"] != 1 || calls["b"] != 1 {
		t.Fatalf("duplicate RPC: %+v", calls)
	}
}
func TestTransientDeadlineAndPermanentFailure(t *testing.T) {
	for _, tc := range []struct {
		name  string
		err   error
		want  string
		state string
	}{{"unavailable", &playerprofile.Fault{Kind: playerprofile.Unavailable, Code: "UNAVAILABLE"}, "UNAVAILABLE", "pending"},
		{"deadline", context.DeadlineExceeded, "DEADLINE_EXCEEDED", "pending"},
		{"system", &playerprofile.Fault{Kind: playerprofile.System, Code: "INTERNAL"}, "INTERNAL", "pending"},
		{"conflict", &playerprofile.Fault{Kind: playerprofile.Business, Code: "CONFLICT"}, "CONFLICT", "failed"}} {
		t.Run(tc.name, func(t *testing.T) {
			s := newStore()
			d := delivery("a", "finished", 2)
			s.add(d)
			p := &playerprofile.Fake{SettleRaceFn: func(context.Context, playerprofile.SettlementCommand) (playerprofile.SettlementResult, error) {
				return playerprofile.SettlementResult{}, tc.err
			}}
			c := testCoordinator(t, s, p, &publisher{})
			before := time.Now()
			c.process(d)
			got := s.get(d)
			if got.State != tc.state || s.codes[key(d)] != tc.want {
				t.Fatalf("wrong failure handling: %+v code=%s", got, s.codes[key(d)])
			}
			if tc.state == "pending" && (got.NextAttemptAt == nil || !got.NextAttemptAt.After(before)) {
				t.Fatal("retry not scheduled")
			}
		})
	}
}
func TestBackoffBounded(t *testing.T) {
	for _, n := range []int{0, 1, 2, 8, 100} {
		d := Backoff(n)
		if d < 100*time.Millisecond || d > time.Minute {
			t.Fatalf("backoff %d = %s", n, d)
		}
	}
}
func TestNewCoordinatorRecoversPendingAfterRestart(t *testing.T) {
	store := newStore()
	d := delivery("a", "finished", 2)
	d.AttemptCount = 0
	store.add(d)
	root := context.Background()
	pool, err := workpool.New(root, 1, 1, 200*time.Millisecond)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	failing := &playerprofile.Fake{SettleRaceFn: func(context.Context, playerprofile.SettlementCommand) (playerprofile.SettlementResult, error) {
		return playerprofile.SettlementResult{}, &playerprofile.Fault{Kind: playerprofile.Unavailable, Code: "UNAVAILABLE"}
	}}
	first, err := New(root, store, failing, healthyProbe, pool, nil, nil, 1, logger)
	if err != nil {
		t.Fatal(err)
	}
	select {
	case <-store.retrySignal:
	case <-time.After(time.Second):
		t.Fatal("first coordinator did not retry")
	}
	first.Close()
	store.mu.Lock()
	row := store.rows[key(d)]
	row.NextAttemptAt = nil
	store.rows[key(d)] = row
	store.mu.Unlock()
	pub := &publisher{ch: make(chan struct{}, 1)}
	succeeding := &playerprofile.Fake{SettleRaceFn: func(context.Context, playerprofile.SettlementCommand) (playerprofile.SettlementResult, error) {
		return playerprofile.SettlementResult{Replayed: true}, nil
	}}
	second, err := New(root, store, succeeding, healthyProbe, pool, pub, nil, 1, logger)
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close()
	select {
	case <-pub.ch:
	case <-time.After(time.Second):
		t.Fatal("restarted coordinator did not recover DB row")
	}
	if got := store.get(d); got.State != "confirmed" || got.AttemptCount != 2 {
		t.Fatalf("recovery state: %+v", got)
	}
}
func TestUnknownErrorDoesNotRetryForever(t *testing.T) {
	s := newStore()
	d := delivery("a", "finished", 2)
	s.add(d)
	p := &playerprofile.Fake{SettleRaceFn: func(context.Context, playerprofile.SettlementCommand) (playerprofile.SettlementResult, error) {
		return playerprofile.SettlementResult{}, errors.New("secret transport detail")
	}}
	c := testCoordinator(t, s, p, nil)
	c.process(d)
	if s.get(d).State != "failed" || s.codes[key(d)] != "UNCLASSIFIED" {
		t.Fatal("unknown error not contained")
	}
}

type controlledClock struct{ created chan chan time.Time }
type controlledTicker struct{ ch chan time.Time }

func (c *controlledClock) NewTicker(time.Duration) roomruntime.Ticker {
	ch := make(chan time.Time)
	c.created <- ch
	return controlledTicker{ch}
}
func (t controlledTicker) Chan() <-chan time.Time { return t.ch }
func (controlledTicker) Stop()                    {}

type tickProbe struct{ ticks chan struct{} }

func (*tickProbe) HandleCommand(context.Context, any) (any, error) { return nil, nil }
func (p *tickProbe) HandleTick(context.Context, roomruntime.Tick)  { p.ticks <- struct{}{} }
func TestBlockedSettlementDoesNotBlockRoomTick(t *testing.T) {
	clock := &controlledClock{created: make(chan chan time.Time, 1)}
	runtime, err := roomruntime.NewManager(context.Background(), roomruntime.Options{TickInterval: 50 * time.Millisecond, QueueCapacity: 2, Clock: clock})
	if err != nil {
		t.Fatal(err)
	}
	defer runtime.Close()
	probe := &tickProbe{ticks: make(chan struct{}, 1)}
	if _, err = runtime.Start("room", probe); err != nil {
		t.Fatal(err)
	}
	ticker := <-clock.created
	started := make(chan struct{}, 1)
	release := make(chan struct{})
	port := &playerprofile.Fake{SettleRaceFn: func(ctx context.Context, _ playerprofile.SettlementCommand) (playerprofile.SettlementResult, error) {
		started <- struct{}{}
		select {
		case <-release:
			return playerprofile.SettlementResult{}, nil
		case <-ctx.Done():
			return playerprofile.SettlementResult{}, ctx.Err()
		}
	}}
	store := newStore()
	d := delivery("a", "finished", 1)
	store.add(d)
	coordinator := testCoordinator(t, store, port, nil)
	done := make(chan struct{})
	go func() { coordinator.process(d); close(done) }()
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("RPC did not start")
	}
	ticker <- time.Unix(1, 0)
	select {
	case <-probe.ticks:
	case <-time.After(time.Second):
		t.Fatal("room tick blocked by settlement RPC")
	}
	close(release)
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("settlement did not finish")
	}
}
