package rooms

import (
	"context"
	"errors"
	"reflect"
	"testing"
	"time"

	"github.com/aepatino5112/compunube-proyecto-1/services/match-service-go/internal/inputmailbox"
	"github.com/aepatino5112/compunube-proyecto-1/services/match-service-go/internal/race"
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
	startAt := time.UnixMilli(*s.CountdownEndsAtMs).Add(time.Millisecond)
	ticker.ch <- startAt
	s, _ = m.Snapshot(ctx, id)
	if s.State != Racing || s.RaceID == nil {
		t.Fatalf("race did not start: %s", s.State)
	}
	if _, err := m.Join(ctx, id, "e"); !errors.Is(err, ErrState) {
		t.Fatalf("join during race: %v", err)
	}
	for i := 1; i <= 1600; i++ {
		ticker.ch <- startAt.Add(time.Duration(i) * 50 * time.Millisecond)
	}
	s, _ = m.Snapshot(ctx, id)
	if s.State != Results {
		t.Fatalf("results not retained: %s", s.State)
	}
	firstReplay := &sink{}
	if err := m.Bind(ctx, id, "a", "result-1", firstReplay); err != nil {
		t.Fatal(err)
	}
	secondReplay := &sink{}
	if err := m.Bind(ctx, id, "a", "result-2", secondReplay); err != nil {
		t.Fatal(err)
	}
	if len(firstReplay.messages) < 2 || len(secondReplay.messages) < 2 {
		t.Fatal("result not replayed on rebind")
	}
	firstEnded, ok := firstReplay.messages[1].(race.EndedMessage)
	if !ok {
		t.Fatalf("first replay: %T", firstReplay.messages[1])
	}
	secondEnded, ok := secondReplay.messages[1].(race.EndedMessage)
	if !ok || !reflect.DeepEqual(firstEnded.Result, secondEnded.Result) {
		t.Fatal("competitive result changed on replay")
	}
	for _, p := range secondEnded.Result.Participants {
		if p.SettlementState != "pending" {
			t.Fatal("settlement confirmed without Rust")
		}
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

func TestRaceInputGatewayAndReentrySequences(t *testing.T) {
	m, ticker, id := newRoom(t)
	ctx := context.Background()
	_, _ = m.Join(ctx, id, "b")
	old := &sink{}
	if err := m.Bind(ctx, id, "a", "old", old); err != nil {
		t.Fatal(err)
	}
	if err := m.Ready(ctx, id, "a", true, 1, "reusable"); err != nil {
		t.Fatal(err)
	}
	if err := m.Ready(ctx, id, "b", true, 1, "reusable"); err != nil {
		t.Fatal(err)
	}
	state, _ := m.Snapshot(ctx, id)
	startAt := time.UnixMilli(*state.CountdownEndsAtMs).Add(time.Millisecond)
	ticker.ch <- startAt
	state, _ = m.Snapshot(ctx, id)
	if state.State != Racing || state.RaceID == nil {
		t.Fatalf("race: %+v", state)
	}
	foundStart := false
	for _, v := range old.messages {
		if message, ok := v.(race.StartMessage); ok {
			foundStart = true
			if len(message.Course.Trash) != 103 || len(message.Roster) != 2 {
				t.Fatal("incomplete race.start")
			}
		}
	}
	if !foundStart {
		t.Fatal("race.start missing")
	}
	input := inputmailbox.Input{Seq: 1, Steer: 0.5, NetSide: 1, JumpSeq: 1}
	if err := m.Input(id, "a", *state.RaceID, input); err != nil {
		t.Fatal(err)
	}
	if err := m.Input(id, "a", *state.RaceID, input); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("duplicate input: %v", err)
	}
	if err := m.Input(id, "a", "wrong", input); !errors.Is(err, ErrRaceNotActive) {
		t.Fatalf("wrong race: %v", err)
	}
	bad := input
	bad.Seq = 2
	bad.Steer = 2
	if err := m.Input(id, "a", *state.RaceID, bad); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("out of range: %v", err)
	}
	ticker.ch <- startAt.Add(50 * time.Millisecond)
	ticker.ch <- startAt.Add(100 * time.Millisecond)
	_, _ = m.Snapshot(ctx, id)
	foundSnapshot := false
	for _, v := range old.messages {
		if message, ok := v.(race.SnapshotMessage); ok {
			foundSnapshot = true
			if message.Snapshot.Players[0].LastProcessedInputSeq != 1 || message.Snapshot.Players[0].LastProcessedJumpSeq != 1 {
				t.Fatalf("snapshot sequence: %+v", message.Snapshot.Players[0])
			}
		}
	}
	if !foundSnapshot {
		t.Fatal("10 Hz snapshot missing")
	}
	pending := input
	pending.Seq = 2
	pending.JumpSeq = 2
	if err := m.Input(id, "a", *state.RaceID, pending); err != nil {
		t.Fatal(err)
	}
	m.Disconnect(ctx, id, "a", "old")
	state, _ = m.Snapshot(ctx, id)
	if state.Members[0].ParticipantState != "reconnecting" {
		t.Fatalf("disconnect: %+v", state.Members[0])
	}
	fresh := &sink{}
	if err := m.Bind(ctx, id, "a", "new", fresh); err != nil {
		t.Fatal(err)
	}
	m.Disconnect(ctx, id, "a", "old")
	state, _ = m.Snapshot(ctx, id)
	if !state.Members[0].Connected || state.Members[0].ParticipantState != "racing" {
		t.Fatal("stale connection displaced reentry")
	}
	if err := m.Input(id, "a", *state.RaceID, input); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("reentry reset input seq: %v", err)
	}
	input.Seq = 2
	input.JumpSeq = 2
	if err := m.Input(id, "a", *state.RaceID, input); err != nil {
		t.Fatal(err)
	}
	if len(fresh.messages) < 2 {
		t.Fatal("reentry missing state and full snapshot")
	}
	if _, ok := fresh.messages[0].(Message); !ok {
		t.Fatalf("reentry first: %T", fresh.messages[0])
	}
	if _, ok := fresh.messages[1].(race.SnapshotMessage); !ok {
		t.Fatalf("reentry second: %T", fresh.messages[1])
	}
}

func TestAllRacingMembersLeaveClosesRoom(t *testing.T) {
	m, ticker, id := newRoom(t)
	ctx := context.Background()
	_, _ = m.Join(ctx, id, "b")
	for _, p := range []string{"a", "b"} {
		if err := m.Ready(ctx, id, p, true, 1, "reusable"); err != nil {
			t.Fatal(err)
		}
	}
	state, _ := m.Snapshot(ctx, id)
	startAt := time.UnixMilli(*state.CountdownEndsAtMs).Add(time.Millisecond)
	ticker.ch <- startAt
	state, _ = m.Snapshot(ctx, id)
	if state.State != Racing {
		t.Fatal("race not started")
	}
	for _, p := range []string{"a", "b"} {
		if err := m.Leave(ctx, id, p); err != nil {
			t.Fatal(err)
		}
	}
	handle := m.rooms[id].handle
	ticker.ch <- startAt.Add(50 * time.Millisecond)
	<-handle.Done()
	if _, err := m.Snapshot(ctx, id); !errors.Is(err, ErrNotFound) {
		t.Fatalf("empty race kept room open: %v", err)
	}
}
