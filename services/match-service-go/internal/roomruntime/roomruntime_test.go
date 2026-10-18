package roomruntime

import (
	"context"
	"errors"
	"runtime"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

type fakeClock struct{ created chan *fakeTicker }

type fakeTicker struct {
	ch      chan time.Time
	stopped chan struct{}
	once    sync.Once
	period  time.Duration
}

func (c *fakeClock) NewTicker(period time.Duration) Ticker {
	t := &fakeTicker{ch: make(chan time.Time, 16), stopped: make(chan struct{}), period: period}
	c.created <- t
	return t
}

func (t *fakeTicker) Chan() <-chan time.Time { return t.ch }
func (t *fakeTicker) Stop()                  { t.once.Do(func() { close(t.stopped) }) }

type probeHandler struct {
	active    atomic.Bool
	violation atomic.Bool
	commands  int // only read after a command response or loop termination
	ticks     chan Tick
}

func (h *probeHandler) HandleCommand(_ context.Context, command any) (any, error) {
	if !h.active.CompareAndSwap(false, true) {
		h.violation.Store(true)
	}
	defer h.active.Store(false)
	h.commands++
	return command, nil
}

func (h *probeHandler) HandleTick(_ context.Context, tick Tick) {
	if !h.active.CompareAndSwap(false, true) {
		h.violation.Store(true)
	}
	defer h.active.Store(false)
	select {
	case h.ticks <- tick:
	default:
	}
}

func newTestManager(t *testing.T, parent context.Context, cap int, clock Clock) *Manager {
	t.Helper()
	m, err := NewManager(parent, Options{TickInterval: 50 * time.Millisecond, QueueCapacity: cap, Clock: clock})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(m.Close)
	return m
}

func TestSingleWriterAndControlledTick(t *testing.T) {
	clock := &fakeClock{created: make(chan *fakeTicker, 1)}
	m := newTestManager(t, context.Background(), 64, clock)
	handler := &probeHandler{ticks: make(chan Tick, 4)}
	h, err := m.Start("room-a", handler)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := m.Start("room-a", handler); !errors.Is(err, ErrRoomExists) {
		t.Fatalf("duplicate room accepted: %v", err)
	}
	ticker := <-clock.created
	if ticker.period != 50*time.Millisecond {
		t.Fatal("wrong tick interval")
	}
	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			value, err := h.Submit(context.Background(), n)
			if err != nil || value != n {
				t.Errorf("command %d: value=%v err=%v", n, value, err)
			}
		}(i)
	}
	wg.Wait()
	base := time.Unix(123, 0)
	for i := uint64(1); i <= 3; i++ {
		at := base.Add(time.Duration(i) * 50 * time.Millisecond)
		ticker.ch <- at
		select {
		case got := <-handler.ticks:
			if got.Number != i || got.Step != 50*time.Millisecond || !got.At.Equal(at) {
				t.Fatalf("tick %d mismatch: %+v", i, got)
			}
		case <-time.After(time.Second):
			t.Fatal("controlled tick not handled")
		}
	}
	h.Stop()
	h.Stop()
	if handler.commands != 50 || handler.violation.Load() {
		t.Fatalf("commands=%d serial=%v", handler.commands, !handler.violation.Load())
	}
	if m.Count() != 0 {
		t.Fatal("stopped room remained registered")
	}
	select {
	case <-ticker.stopped:
	default:
		t.Fatal("ticker leaked")
	}
	if _, err := h.Submit(context.Background(), "late"); !errors.Is(err, ErrClosed) {
		t.Fatalf("closed room accepted work: %v", err)
	}
}

type blockingHandler struct {
	entered chan struct{}
	release chan struct{}
}

func (h *blockingHandler) HandleCommand(ctx context.Context, command any) (any, error) {
	if command == "block" {
		close(h.entered)
		select {
		case <-h.release:
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	return command, nil
}

func (h *blockingHandler) HandleTick(context.Context, Tick) {}

func TestRoomsIndependentAndQueueBounded(t *testing.T) {
	m := newTestManager(t, context.Background(), 1, nil)
	blocker := &blockingHandler{entered: make(chan struct{}), release: make(chan struct{})}
	a, err := m.Start("slow", blocker)
	if err != nil {
		t.Fatal(err)
	}
	b, err := m.Start("fast", &probeHandler{ticks: make(chan Tick, 4)})
	if err != nil {
		t.Fatal(err)
	}
	first := make(chan error, 1)
	go func() { _, err := a.Submit(context.Background(), "block"); first <- err }()
	select {
	case <-blocker.entered:
	case <-time.After(time.Second):
		t.Fatal("slow room did not enter command")
	}
	second := make(chan error, 1)
	go func() { _, err := a.Submit(context.Background(), "queued"); second <- err }()
	deadline := time.Now().Add(time.Second)
	for len(a.commands) != 1 {
		if time.Now().After(deadline) {
			t.Fatal("queue was not filled")
		}
		runtime.Gosched()
	}
	if _, err := a.Submit(context.Background(), "overflow"); !errors.Is(err, ErrQueueFull) {
		t.Fatalf("full queue did not reject: %v", err)
	}
	if value, err := b.Submit(context.Background(), "healthy"); err != nil || value != "healthy" {
		t.Fatalf("other room was blocked: value=%v err=%v", value, err)
	}
	b.Stop()
	if m.Count() != 1 {
		t.Fatal("stopping one room affected registry of another")
	}
	close(blocker.release)
	if err := <-first; err != nil {
		t.Fatal(err)
	}
	if err := <-second; err != nil {
		t.Fatal(err)
	}
	a.Stop()
}

func TestRootCancellationAndRepeatedShutdown(t *testing.T) {
	for i := 0; i < 25; i++ {
		ctx, cancel := context.WithCancel(context.Background())
		clock := &fakeClock{created: make(chan *fakeTicker, 2)}
		m, err := NewManager(ctx, Options{TickInterval: 50 * time.Millisecond, QueueCapacity: 2, Clock: clock})
		if err != nil {
			t.Fatal(err)
		}
		a, err := m.Start("a", &probeHandler{ticks: make(chan Tick, 1)})
		if err != nil {
			t.Fatal(err)
		}
		b, err := m.Start("b", &probeHandler{ticks: make(chan Tick, 1)})
		if err != nil {
			t.Fatal(err)
		}
		<-clock.created
		<-clock.created
		cancel()
		m.Close()
		m.Close()
		if m.Count() != 0 {
			t.Fatal("root cancellation left registered rooms")
		}
		for _, h := range []*Handle{a, b} {
			select {
			case <-h.Done():
			default:
				t.Fatal("loop goroutine remained after Close")
			}
			if _, err := h.Submit(context.Background(), ConnectionChange{PlayerID: "p"}); !errors.Is(err, ErrClosed) {
				t.Fatalf("closed loop accepted command: %v", err)
			}
		}
		if _, err := m.Start("new", &probeHandler{ticks: make(chan Tick, 1)}); !errors.Is(err, ErrClosed) {
			t.Fatalf("closed manager admitted room: %v", err)
		}
	}
}

type selfCancelHandler struct{ cancel func() }

func (h *selfCancelHandler) HandleCommand(context.Context, any) (any, error) {
	h.cancel()
	return nil, nil
}

func (h *selfCancelHandler) HandleTick(context.Context, Tick) {}

func TestHandlerCanRequestCloseWithoutWaitingOnItself(t *testing.T) {
	m := newTestManager(t, context.Background(), 1, nil)
	handler := &selfCancelHandler{}
	h, err := m.Start("self-closing", handler)
	if err != nil {
		t.Fatal(err)
	}
	handler.cancel = h.Cancel
	_, _ = h.Submit(context.Background(), ConnectionChange{PlayerID: "p", Connected: false})
	select {
	case <-h.Done():
	case <-time.After(time.Second):
		t.Fatal("self-cancel did not terminate loop")
	}
	if m.Count() != 0 {
		t.Fatal("self-closed room remained registered")
	}
}
