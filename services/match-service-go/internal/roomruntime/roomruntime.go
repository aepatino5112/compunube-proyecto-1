// Package roomruntime owns one serial command/tick loop per room. Domain
// handlers supplied by later cards are the only writers of their room state.
package roomruntime

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"
)

var (
	ErrClosed       = errors.New("room runtime closed")
	ErrRoomExists   = errors.New("room already active")
	ErrRoomNotFound = errors.New("room not found")
	ErrQueueFull    = errors.New("room command queue full")
)

type Tick struct {
	Number uint64
	Step   time.Duration
	At     time.Time
}

// ConnectionChange is an internal command seam. F49 decides whether the
// player belongs to the room and what a disconnect means for its state.
type ConnectionChange struct {
	PlayerID       string
	ConnectionID   string
	Connected      bool
	DisconnectedAt time.Time
}

// Handler methods are called only by this room's loop, never concurrently.
// They must be bounded and must not perform network, SQL or RPC I/O.
type Handler interface {
	HandleCommand(context.Context, any) (any, error)
	HandleTick(context.Context, Tick)
}

type Ticker interface {
	Chan() <-chan time.Time
	Stop()
}

type Clock interface{ NewTicker(time.Duration) Ticker }

type Options struct {
	TickInterval  time.Duration
	QueueCapacity int
	Clock         Clock // nil uses the monotonic Go ticker
}

type Manager struct {
	mu     sync.RWMutex
	rooms  map[string]*Handle
	ctx    context.Context
	cancel context.CancelFunc
	opts   Options
	closed bool
	wg     sync.WaitGroup
}

func NewManager(parent context.Context, opts Options) (*Manager, error) {
	if parent == nil || opts.TickInterval <= 0 || opts.QueueCapacity <= 0 {
		return nil, fmt.Errorf("invalid room runtime options")
	}
	if opts.Clock == nil {
		opts.Clock = realClock{}
	}
	ctx, cancel := context.WithCancel(parent)
	return &Manager{rooms: make(map[string]*Handle), ctx: ctx, cancel: cancel, opts: opts}, nil
}

func (m *Manager) Start(roomID string, handler Handler) (*Handle, error) {
	if roomID == "" || handler == nil {
		return nil, fmt.Errorf("room ID and handler are required")
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.closed || m.ctx.Err() != nil {
		return nil, ErrClosed
	}
	if _, exists := m.rooms[roomID]; exists {
		return nil, ErrRoomExists
	}
	ctx, cancel := context.WithCancel(m.ctx)
	h := &Handle{
		id: roomID, ctx: ctx, cancel: cancel, manager: m, handler: handler,
		commands: make(chan request, m.opts.QueueCapacity), done: make(chan struct{}),
	}
	m.rooms[roomID] = h
	m.wg.Add(1)
	go h.run()
	return h, nil
}

func (m *Manager) Get(roomID string) (*Handle, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	h, ok := m.rooms[roomID]
	return h, ok
}

func (m *Manager) Count() int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return len(m.rooms)
}

// Close stops admission, cancels every loop and waits for all loop goroutines.
// Calling it repeatedly is safe; root-context cancellation also stops loops.
func (m *Manager) Close() {
	m.mu.Lock()
	if !m.closed {
		m.closed = true
		m.cancel()
	}
	m.mu.Unlock()
	m.wg.Wait()
}

func (m *Manager) remove(h *Handle) {
	m.mu.Lock()
	if m.rooms[h.id] == h {
		delete(m.rooms, h.id)
	}
	m.mu.Unlock()
}

type request struct {
	command any
	reply   chan response
}

type response struct {
	value any
	err   error
}

type Handle struct {
	id       string
	ctx      context.Context
	cancel   context.CancelFunc
	manager  *Manager
	handler  Handler
	commands chan request
	done     chan struct{}
	// tick is written only by run.
	tick uint64
}

func (h *Handle) ID() string            { return h.id }
func (h *Handle) Done() <-chan struct{} { return h.done }

// Submit refuses a full queue immediately. Once enqueued, a caller whose
// context expires cannot assume whether the command was applied.
func (h *Handle) Submit(ctx context.Context, command any) (any, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	select {
	case <-h.done:
		return nil, ErrClosed
	case <-h.ctx.Done():
		return nil, ErrClosed
	default:
	}
	req := request{command: command, reply: make(chan response, 1)}
	select {
	case <-h.ctx.Done():
		return nil, ErrClosed
	case h.commands <- req:
	default:
		return nil, ErrQueueFull
	}
	select {
	case answer := <-req.reply:
		return answer.value, answer.err
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-h.ctx.Done():
		return nil, ErrClosed
	}
}

// Cancel requests closure without waiting, including from inside a handler.
func (h *Handle) Cancel() { h.cancel() }

// Stop waits for termination and must be called from outside this room's loop.
func (h *Handle) Stop() {
	h.cancel()
	<-h.done
}

func (h *Handle) run() {
	ticker := h.manager.opts.Clock.NewTicker(h.manager.opts.TickInterval)
	defer func() {
		ticker.Stop()
		h.manager.remove(h)
		close(h.done)
		h.manager.wg.Done()
	}()
	for {
		select {
		case <-h.ctx.Done():
			return
		case req := <-h.commands:
			if h.ctx.Err() != nil {
				return
			}
			value, err := h.handler.HandleCommand(h.ctx, req.command)
			req.reply <- response{value: value, err: err}
		case at, ok := <-ticker.Chan():
			if !ok || h.ctx.Err() != nil {
				return
			}
			h.tick++
			h.handler.HandleTick(h.ctx, Tick{Number: h.tick, Step: h.manager.opts.TickInterval, At: at})
		}
	}
}

type realClock struct{}

func (realClock) NewTicker(interval time.Duration) Ticker {
	return realTicker{time.NewTicker(interval)}
}

type realTicker struct{ *time.Ticker }

func (t realTicker) Chan() <-chan time.Time { return t.C }
