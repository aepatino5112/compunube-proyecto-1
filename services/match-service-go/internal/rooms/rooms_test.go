package rooms

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/aepatino5112/compunube-proyecto-1/services/match-service-go/internal/roomruntime"
)

type fakeVerifier struct{}

func (fakeVerifier) Verify(_ context.Context, id string, revision uint64) (Preparation, error) {
	return Preparation{Revision: revision, DisplayName: id, Equipment: Equipment{"board", "outfit", "net", "hair", "character"}, Appearance: Appearance{"skin", "color"}}, nil
}

type sink struct{ messages []any }

func (s *sink) Send(v any) bool { s.messages = append(s.messages, v); return true }

type testTicker struct{ ch chan time.Time }

func (t *testTicker) Chan() <-chan time.Time { return t.ch }
func (t *testTicker) Stop()                  {}

type testClock struct{ created chan *testTicker }

func (c *testClock) NewTicker(time.Duration) roomruntime.Ticker {
	t := &testTicker{ch: make(chan time.Time)}
	c.created <- t
	return t
}
func newRoom(t *testing.T) (*Manager, *testTicker, string) {
	t.Helper()
	clock := &testClock{created: make(chan *testTicker, 1)}
	rt, err := roomruntime.NewManager(context.Background(), roomruntime.Options{TickInterval: 50 * time.Millisecond, QueueCapacity: 32, Clock: clock})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(rt.Close)
	m := NewManager(rt, fakeVerifier{})
	v, err := m.Create(context.Background(), "maracaibo", "a")
	if err != nil {
		t.Fatal(err)
	}
	return m, <-clock.created, v.RoomID
}

func TestLifecycleAndCapacity(t *testing.T) {
	m, ticker, id := newRoom(t)
	ctx := context.Background()
	for _, p := range []string{"b", "c", "d"} {
		if _, err := m.Join(ctx, id, p); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := m.Join(ctx, id, "e"); !errors.Is(err, ErrFull) {
		t.Fatalf("fifth join: %v", err)
	}
	for _, p := range []string{"a", "b", "c", "d"} {
		if err := m.Ready(ctx, id, p, true, 1, "reusable"); err != nil {
			t.Fatal(err)
		}
	}
	s, err := m.Snapshot(ctx, id)
	if err != nil || s.State != Countdown || s.CountdownEndsAtMs == nil {
		t.Fatalf("countdown: %+v %v", s, err)
	}
	if _, err := m.Join(ctx, id, "e"); !errors.Is(err, ErrState) {
		t.Fatalf("join during countdown: %v", err)
	}
	ticker.ch <- time.UnixMilli(*s.CountdownEndsAtMs).Add(-time.Millisecond)
	s, _ = m.Snapshot(ctx, id)
	if s.State != Countdown {
		t.Fatal("countdown ended early")
	}
	ticker.ch <- time.UnixMilli(*s.CountdownEndsAtMs).Add(time.Millisecond)
	s, _ = m.Snapshot(ctx, id)
	if s.State != Racing || s.RaceID == nil {
		t.Fatalf("race did not start: %s", s.State)
	}
	if _, err := m.Join(ctx, id, "e"); !errors.Is(err, ErrState) {
		t.Fatalf("join during race: %v", err)
	}
	if err := m.Finish(ctx, id); err != nil {
		t.Fatal(err)
	}
	s, _ = m.Snapshot(ctx, id)
	if s.State != Results {
		t.Fatalf("results not retained: %s", s.State)
	}
	if err := m.Repeat(ctx, id); err != nil {
		t.Fatal(err)
	}
	s, _ = m.Snapshot(ctx, id)
	if s.State != Lobby || s.MapID != "maracaibo" || s.RaceID != nil {
		t.Fatalf("repeat: %+v", s)
	}
	for _, p := range s.Members {
		if p.Ready || p.ParticipantState != "not_ready" {
			t.Fatalf("ready after repeat: %+v", p)
		}
	}
}

func TestCountdownCancellationAndStaleDisconnect(t *testing.T) {
	m, _, id := newRoom(t)
	ctx := context.Background()
	_, _ = m.Join(ctx, id, "b")
	if err := m.Ready(ctx, id, "a", true, 1, "reusable"); err != nil {
		t.Fatal(err)
	}
	if err := m.Ready(ctx, id, "b", true, 1, "disposable"); err != nil {
		t.Fatal(err)
	}
	s, _ := m.Snapshot(ctx, id)
	first := *s.CountdownEndsAtMs
	if err := m.Ready(ctx, id, "b", true, 1, "disposable"); err != nil {
		t.Fatal(err)
	}
	s, _ = m.Snapshot(ctx, id)
	if *s.CountdownEndsAtMs != first {
		t.Fatal("idempotent ready reset countdown")
	}
	if err := m.Ready(ctx, id, "b", true, 2, "reusable"); err != nil {
		t.Fatal(err)
	}
	s, _ = m.Snapshot(ctx, id)
	if s.State != Lobby {
		t.Fatalf("preparation change did not cancel: %s", s.State)
	}
	if err := m.Ready(ctx, id, "b", true, 2, "reusable"); err != nil {
		t.Fatal(err)
	}
	if err := m.Ready(ctx, id, "b", false, 0, ""); err != nil {
		t.Fatal(err)
	}
	s, _ = m.Snapshot(ctx, id)
	if s.State != Lobby {
		t.Fatalf("unready did not cancel: %s", s.State)
	}
	if err := m.Bind(ctx, id, "a", "old", &sink{}); err != nil {
		t.Fatal(err)
	}
	if err := m.Bind(ctx, id, "a", "new", &sink{}); err != nil {
		t.Fatal(err)
	}
	m.Disconnect(ctx, id, "a", "old")
	s, _ = m.Snapshot(ctx, id)
	if len(s.Members) != 2 || !s.Members[0].Connected {
		t.Fatalf("stale connection removed member: %+v", s.Members)
	}
	m.Disconnect(ctx, id, "a", "new")
	s, _ = m.Snapshot(ctx, id)
	if len(s.Members) != 1 || s.Members[0].PlayerID != "b" {
		t.Fatalf("disconnect did not remove member: %+v", s.Members)
	}
}

func TestInvalidMapAndFailClosedPreparation(t *testing.T) {
	m, _, _ := newRoom(t)
	if _, err := m.Create(context.Background(), "invalid", "x"); !errors.Is(err, ErrReady) {
		t.Fatalf("invalid map: %v", err)
	}
	rt, err := roomruntime.NewManager(context.Background(), roomruntime.Options{TickInterval: time.Second, QueueCapacity: 2})
	if err != nil {
		t.Fatal(err)
	}
	defer rt.Close()
	closed := NewManager(rt, UnavailableVerifier{})
	v, err := closed.Create(context.Background(), "orinoco", "x")
	if err != nil {
		t.Fatal(err)
	}
	if err := closed.Ready(context.Background(), v.RoomID, "x", true, 1, "reusable"); err == nil {
		t.Fatal("ready without profile verification")
	}
}
