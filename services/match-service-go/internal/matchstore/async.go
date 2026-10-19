package matchstore

import (
	"context"
	"log/slog"
	"sync"
	"time"
)

type queued struct {
	record  Record
	version uint64
}

// Async keeps unsaved records in process memory and retries them outside the
// RoomLoop. A DB outage leaves them available until process exit; it cannot
// make an uncommitted result durable.
type Async struct {
	mu      sync.Mutex
	pending map[string]queued
	repo    Repository
	logger  *slog.Logger
	wake    chan struct{}
	durable chan struct{}
	done    chan struct{}
}

func NewAsync(ctx context.Context, repo Repository, logger *slog.Logger) *Async {
	a := &Async{pending: map[string]queued{}, repo: repo, logger: logger, wake: make(chan struct{}, 1), durable: make(chan struct{}, 1), done: make(chan struct{})}
	go a.run(ctx)
	return a
}
func (a *Async) Offer(r Record) {
	r = CopyRecord(r)
	a.mu.Lock()
	old := a.pending[r.RaceID]
	if r.RaceID == "" {
		old = a.pending["room:"+r.RoomID]
	}
	key := r.RaceID
	if key == "" {
		key = "room:" + r.RoomID
	}
	a.pending[key] = queued{record: r, version: old.version + 1}
	a.mu.Unlock()
	select {
	case a.wake <- struct{}{}:
	default:
	}
}
func (a *Async) Pending() int             { a.mu.Lock(); defer a.mu.Unlock(); return len(a.pending) }
func (a *Async) Durable() <-chan struct{} { return a.durable }
func (a *Async) Close()                   { <-a.done }
func (a *Async) run(ctx context.Context) {
	defer close(a.done)
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-a.wake:
		case <-ticker.C:
		}
		a.mu.Lock()
		batch := make(map[string]queued, len(a.pending))
		for k, v := range a.pending {
			batch[k] = v
		}
		a.mu.Unlock()
		for k, v := range batch {
			callCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
			err := a.repo.Save(callCtx, v.record)
			cancel()
			if err != nil {
				a.logger.Warn("match record not durable yet", "room_id", v.record.RoomID, "race_id", v.record.RaceID, "error", err)
				continue
			}
			a.mu.Lock()
			if current, ok := a.pending[k]; ok && current.version == v.version {
				delete(a.pending, k)
			}
			a.mu.Unlock()
			if v.record.Result != nil {
				select {
				case a.durable <- struct{}{}:
				default:
				}
			}
		}
	}
}
