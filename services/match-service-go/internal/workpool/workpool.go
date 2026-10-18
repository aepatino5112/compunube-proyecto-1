// Package workpool bounds slow jobs without involving a room loop.
package workpool

import (
	"context"
	"errors"
	"sync"
	"time"
)

var ErrSaturated = errors.New("local worker pool saturated")
var ErrClosed = errors.New("worker pool closed")

type Stats struct {
	Accepted, Rejected, Completed uint64
	Active                        int
	Queued                        int
}
type job struct {
	ctx      context.Context
	cancel   context.CancelFunc
	stopRoot func() bool
	run      func(context.Context) error
	done     chan error
}
type Pool struct {
	mu      sync.Mutex
	queue   chan job
	ctx     context.Context
	cancel  context.CancelFunc
	wg      sync.WaitGroup
	timeout time.Duration
	closed  bool
	stats   Stats
}

func New(parent context.Context, workers, capacity int, timeout time.Duration) (*Pool, error) {
	if parent == nil || workers <= 0 || capacity <= 0 || timeout <= 0 {
		return nil, errors.New("invalid worker pool options")
	}
	ctx, cancel := context.WithCancel(parent)
	p := &Pool{queue: make(chan job, capacity), ctx: ctx, cancel: cancel, timeout: timeout}
	p.wg.Add(workers)
	for i := 0; i < workers; i++ {
		go p.worker()
	}
	return p, nil
}
func (p *Pool) Submit(ctx context.Context, fn func(context.Context) error) (<-chan error, error) {
	if ctx == nil || fn == nil {
		return nil, errors.New("job context and function required")
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	jobCtx, cancel := context.WithTimeout(ctx, p.timeout)
	stopRoot := context.AfterFunc(p.ctx, cancel)
	j := job{ctx: jobCtx, cancel: cancel, stopRoot: stopRoot, run: fn, done: make(chan error, 1)}
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.closed || p.ctx.Err() != nil {
		stopRoot()
		cancel()
		return nil, ErrClosed
	}
	select {
	case p.queue <- j:
		p.stats.Accepted++
		p.stats.Queued++
		return j.done, nil
	default:
		p.stats.Rejected++
		stopRoot()
		cancel()
		return nil, ErrSaturated
	}
}
func (p *Pool) worker() {
	defer p.wg.Done()
	for {
		select {
		case <-p.ctx.Done():
			return
		case j := <-p.queue:
			p.mu.Lock()
			p.stats.Queued--
			p.stats.Active++
			p.mu.Unlock()
			var err error
			if p.ctx.Err() != nil {
				err = ErrClosed
			} else if err = j.ctx.Err(); err == nil {
				err = j.run(j.ctx)
			}
			j.done <- err
			j.stopRoot()
			j.cancel()
			p.mu.Lock()
			p.stats.Active--
			p.stats.Completed++
			p.mu.Unlock()
		}
	}
}
func (p *Pool) Stats() Stats { p.mu.Lock(); defer p.mu.Unlock(); return p.stats }
func (p *Pool) Close() {
	p.mu.Lock()
	if !p.closed {
		p.closed = true
		p.cancel()
	}
	p.mu.Unlock()
	p.wg.Wait()
	for {
		select {
		case j := <-p.queue:
			j.done <- ErrClosed
			j.stopRoot()
			j.cancel()
			p.mu.Lock()
			p.stats.Queued--
			p.mu.Unlock()
		default:
			return
		}
	}
}
