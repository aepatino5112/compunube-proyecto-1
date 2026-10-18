// Package outbox provides bounded, nonblocking per-connection delivery.
package outbox

import (
	"context"
	"sync"
)

type Kind uint8

const (
	Critical Kind = iota
	Snapshot
	Event
)

type Stats struct {
	CriticalRejected uint64
	EventDropped     uint64
	SnapshotReplaced uint64
}
type Queue struct {
	mu                    sync.Mutex
	critical, event       []any
	snapshot              any
	hasSnapshot, closed   bool
	criticalCap, eventCap int
	notify                chan struct{}
	stats                 Stats
}

func New(criticalCap, eventCap int) *Queue {
	if criticalCap <= 0 || eventCap <= 0 {
		panic("invalid outbox capacity")
	}
	return &Queue{criticalCap: criticalCap, eventCap: eventCap, notify: make(chan struct{}, 1)}
}
func (q *Queue) signal() {
	select {
	case q.notify <- struct{}{}:
	default:
	}
}

// Push never waits for a socket. A false return for Critical means the caller
// must close only this connection; events and snapshots remain recoverable.
func (q *Queue) Push(kind Kind, v any) bool {
	q.mu.Lock()
	defer q.mu.Unlock()
	if q.closed {
		return false
	}
	switch kind {
	case Critical:
		if len(q.critical) >= q.criticalCap {
			q.stats.CriticalRejected++
			return false
		}
		q.critical = append(q.critical, v)
	case Snapshot:
		if q.hasSnapshot {
			q.stats.SnapshotReplaced++
		}
		q.snapshot = v
		q.hasSnapshot = true
	case Event:
		if len(q.event) >= q.eventCap {
			q.stats.EventDropped++
			return true
		}
		q.event = append(q.event, v)
	default:
		return false
	}
	q.signal()
	return true
}
func (q *Queue) Next(ctx context.Context) (any, bool) {
	for {
		q.mu.Lock()
		if q.closed {
			q.mu.Unlock()
			return nil, false
		}
		if len(q.critical) > 0 {
			v := q.critical[0]
			q.critical[0] = nil
			q.critical = q.critical[1:]
			q.mu.Unlock()
			return v, true
		}
		if q.hasSnapshot {
			v := q.snapshot
			q.snapshot = nil
			q.hasSnapshot = false
			q.mu.Unlock()
			return v, true
		}
		if len(q.event) > 0 {
			v := q.event[0]
			q.event[0] = nil
			q.event = q.event[1:]
			q.mu.Unlock()
			return v, true
		}
		q.mu.Unlock()
		select {
		case <-ctx.Done():
			return nil, false
		case <-q.notify:
		}
	}
}
func (q *Queue) Close() {
	q.mu.Lock()
	if !q.closed {
		q.closed = true
		q.critical = nil
		q.event = nil
		q.snapshot = nil
		q.hasSnapshot = false
		q.signal()
	}
	q.mu.Unlock()
}
func (q *Queue) Stats() Stats { q.mu.Lock(); defer q.mu.Unlock(); return q.stats }
