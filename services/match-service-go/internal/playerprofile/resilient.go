package playerprofile

import (
	"context"
	"errors"
	"fmt"
	"math/rand"
	"sync"
	"time"
)

type CircuitState string

const (
	Closed   CircuitState = "closed"
	Open     CircuitState = "open"
	HalfOpen CircuitState = "half-open"
)

type ResilienceOptions struct {
	FailureThreshold int
	OpenDuration     time.Duration
	HalfOpenProbes   int
	ReadMaxRetries   int
	RetryBase        time.Duration
	RetryCap         time.Duration
	Clock            func() time.Time
	Wait             func(context.Context, time.Duration) error
	Jitter           func(time.Duration) time.Duration
}

type ResilienceStats struct {
	State               CircuitState
	ConsecutiveFailures int
	OpenUntil           time.Time
	FastRejects         uint64
	Retries             uint64
}

type ResilientPort struct {
	upstream    Port
	opts        ResilienceOptions
	mu          sync.Mutex
	stats       ResilienceStats
	probeActive bool
	generation  uint64
}

func NewResilient(upstream Port, opts ResilienceOptions) (*ResilientPort, error) {
	if upstream == nil || opts.FailureThreshold < 1 || opts.OpenDuration <= 0 || opts.HalfOpenProbes != 1 || opts.ReadMaxRetries < 0 || opts.ReadMaxRetries > 1 || opts.RetryBase <= 0 || opts.RetryCap < opts.RetryBase {
		return nil, fmt.Errorf("invalid Player/Profile resilience options")
	}
	if opts.Clock == nil {
		opts.Clock = time.Now
	}
	if opts.Wait == nil {
		opts.Wait = waitContext
	}
	if opts.Jitter == nil {
		opts.Jitter = func(max time.Duration) time.Duration { return time.Duration(rand.Int63n(int64(max) + 1)) }
	}
	return &ResilientPort{upstream: upstream, opts: opts, stats: ResilienceStats{State: Closed}}, nil
}

func waitContext(ctx context.Context, d time.Duration) error {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}

func (p *ResilientPort) Stats() ResilienceStats {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.advanceLocked()
	return p.stats
}

// Observe reports the effective state without changing circuit behavior on a scrape.
func (p *ResilientPort) Observe() ResilienceStats {
	p.mu.Lock()
	defer p.mu.Unlock()
	s := p.stats
	if s.State == Open && !p.opts.Clock().Before(s.OpenUntil) {
		s.State = HalfOpen
	}
	return s
}

func (p *ResilientPort) advanceLocked() {
	if p.stats.State == Open && !p.opts.Clock().Before(p.stats.OpenUntil) {
		p.stats.State = HalfOpen
		p.probeActive = false
		p.generation++
	}
}

func (p *ResilientPort) begin(ctx context.Context, read bool) (uint64, bool, error) {
	if err := ctx.Err(); err != nil {
		return 0, false, err
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	p.advanceLocked()
	if p.stats.State == Open || (p.stats.State == HalfOpen && (!read || p.probeActive)) {
		p.stats.FastRejects++
		return 0, false, unavailable()
	}
	probe := p.stats.State == HalfOpen
	if probe {
		p.probeActive = true
	}
	return p.generation, probe, nil
}

func eligible(err error) bool {
	var f *Fault
	if !errors.As(err, &f) {
		return false
	}
	switch f.Kind {
	case Unavailable, Deadline, ResourceExhausted, System:
		return true
	}
	return false
}

func retryable(err error) bool {
	var f *Fault
	return errors.As(err, &f) && (f.Kind == Unavailable || f.Kind == Deadline)
}

func (p *ResilientPort) finish(generation uint64, probe bool, err error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if generation != p.generation {
		return
	}
	if probe {
		p.probeActive = false
		if eligible(err) {
			p.stats.State = Open
			p.stats.OpenUntil = p.opts.Clock().Add(p.opts.OpenDuration)
			p.stats.ConsecutiveFailures = p.opts.FailureThreshold
			p.generation++
		} else if err == nil || Kind(err) == Business {
			p.stats.State = Closed
			p.stats.ConsecutiveFailures = 0
			p.stats.OpenUntil = time.Time{}
			p.generation++
		}
		return
	}
	if p.stats.State != Closed {
		return
	}
	if err == nil {
		p.stats.ConsecutiveFailures = 0
		return
	}
	if eligible(err) {
		p.stats.ConsecutiveFailures++
		if p.stats.ConsecutiveFailures >= p.opts.FailureThreshold {
			p.stats.State = Open
			p.stats.OpenUntil = p.opts.Clock().Add(p.opts.OpenDuration)
			p.generation++
		}
	}
}

func call[T any](p *ResilientPort, ctx context.Context, read bool, fn func() (T, error)) (T, error) {
	var zero T
	generation, probe, err := p.begin(ctx, read)
	if err != nil {
		return zero, err
	}
	var result T
	for attempt := 0; ; attempt++ {
		if err = ctx.Err(); err != nil {
			break
		}
		result, err = fn()
		if ctx.Err() != nil && !read {
			// A mutable RPC may already have committed. Keep its outcome to the
			// caller, but never attribute local cancellation to the dependency.
			if errors.Is(ctx.Err(), context.Canceled) {
				err = ctx.Err()
			}
		}
		if err == nil || !read || attempt >= p.opts.ReadMaxRetries || !retryable(err) || ctx.Err() != nil {
			break
		}
		backoff := p.opts.RetryBase
		if backoff > p.opts.RetryCap {
			backoff = p.opts.RetryCap
		}
		backoff = p.opts.Jitter(backoff)
		if backoff < 0 || backoff > p.opts.RetryCap {
			break
		}
		if deadline, ok := ctx.Deadline(); ok && time.Until(deadline) <= backoff {
			break
		}
		if err = p.opts.Wait(ctx, backoff); err != nil {
			break
		}
		p.mu.Lock()
		p.stats.Retries++
		p.mu.Unlock()
	}
	if errors.Is(ctx.Err(), context.Canceled) {
		err = ctx.Err()
	}
	p.finish(generation, probe, err)
	return result, err
}

func (p *ResilientPort) GetProfile(ctx context.Context, id string) (Profile, error) {
	return call(p, ctx, true, func() (Profile, error) { return p.upstream.GetProfile(ctx, id) })
}
func (p *ResilientPort) GetCatalog(ctx context.Context, v string) (Catalog, error) {
	return call(p, ctx, true, func() (Catalog, error) { return p.upstream.GetCatalog(ctx, v) })
}
func (p *ResilientPort) BuyItem(ctx context.Context, c ItemCommand) (MutationResult, error) {
	return call(p, ctx, false, func() (MutationResult, error) { return p.upstream.BuyItem(ctx, c) })
}
func (p *ResilientPort) CraftItem(ctx context.Context, c ItemCommand) (MutationResult, error) {
	return call(p, ctx, false, func() (MutationResult, error) { return p.upstream.CraftItem(ctx, c) })
}
func (p *ResilientPort) ExchangeMaterials(ctx context.Context, c ExchangeCommand) (MutationResult, error) {
	return call(p, ctx, false, func() (MutationResult, error) { return p.upstream.ExchangeMaterials(ctx, c) })
}
func (p *ResilientPort) EquipItem(ctx context.Context, c ItemCommand) (MutationResult, error) {
	return call(p, ctx, false, func() (MutationResult, error) { return p.upstream.EquipItem(ctx, c) })
}
func (p *ResilientPort) SetAppearance(ctx context.Context, c AppearanceCommand) (MutationResult, error) {
	return call(p, ctx, false, func() (MutationResult, error) { return p.upstream.SetAppearance(ctx, c) })
}
func (p *ResilientPort) SettleRace(ctx context.Context, c SettlementCommand) (SettlementResult, error) {
	return call(p, ctx, false, func() (SettlementResult, error) { return p.upstream.SettleRace(ctx, c) })
}

var _ Port = (*ResilientPort)(nil)
