// Package metrics exposes bounded, in-memory operational measurements.
package metrics

import (
	"fmt"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
)

type Pool struct {
	Active, Queued int
	Rejected       uint64
}

type Snapshot struct {
	Rooms, Connections, RoomQueue, RecordQueue int
	RoomsAdmitted, RoomsRejected               uint64
	ConnectionsAdmitted, ConnectionsRejected   uint64
	RoomQueueRejected                          uint64
	ProfilePool, SettlementPool                Pool
	CircuitState                               string
	FastRejects, ReadRetries                   uint64
}

type Registry struct {
	mu                                                      sync.RWMutex
	snapshot                                                func() Snapshot
	rateLimited, mailboxFull, jumpFull, sequence, coalesced atomic.Uint64
	confirmed, retry, failed, canceled, pending             atomic.Uint64
}

func New() *Registry { return &Registry{} }

// SetSnapshot installs a callback that reads only process memory.
func (m *Registry) SetSnapshot(fn func() Snapshot) {
	m.mu.Lock()
	m.snapshot = fn
	m.mu.Unlock()
}
func (m *Registry) InputDropped(reason string) {
	switch reason {
	case "rate_limited":
		m.rateLimited.Add(1)
	case "mailbox_full":
		m.mailboxFull.Add(1)
	case "jump_full":
		m.jumpFull.Add(1)
	case "sequence":
		m.sequence.Add(1)
	}
}
func (m *Registry) InputCoalesced() { m.coalesced.Add(1) }
func (m *Registry) SettlementAttempt(outcome string) {
	switch outcome {
	case "confirmed":
		m.confirmed.Add(1)
	case "retry":
		m.retry.Add(1)
	case "failed":
		m.failed.Add(1)
	case "canceled":
		m.canceled.Add(1)
	case "pending":
		m.pending.Add(1)
	}
}

func (m *Registry) Render() string {
	m.mu.RLock()
	fn := m.snapshot
	m.mu.RUnlock()
	s := Snapshot{CircuitState: "closed"}
	if fn != nil {
		s = fn()
	}
	var b strings.Builder
	write := func(name, kind, help string, samples ...string) {
		fmt.Fprintf(&b, "# HELP %s %s\n# TYPE %s %s\n", name, help, name, kind)
		for _, sample := range samples {
			fmt.Fprintf(&b, "%s%s\n", name, sample)
		}
	}
	write("match_service_up", "gauge", "Whether the match service process is running.", " 1")
	write("compunube_match_rooms_active", "gauge", "Active room loops.", fmt.Sprintf(" %d", s.Rooms))
	write("compunube_match_connections_active", "gauge", "Active WebSocket connections.", fmt.Sprintf(" %d", s.Connections))
	write("compunube_match_admission_total", "counter", "Accepted rooms and connections.",
		fmt.Sprintf("{kind=\"room\"} %d", s.RoomsAdmitted), fmt.Sprintf("{kind=\"connection\"} %d", s.ConnectionsAdmitted))
	write("compunube_match_admission_rejected_total", "counter", "Capacity admission rejections.",
		fmt.Sprintf("{kind=\"room\",reason=\"limit\"} %d", s.RoomsRejected), fmt.Sprintf("{kind=\"connection\",reason=\"limit\"} %d", s.ConnectionsRejected))
	write("compunube_match_inputs_dropped_total", "counter", "Input packets refused by the rate limiter or mailbox.",
		fmt.Sprintf("{reason=\"rate_limited\"} %d", m.rateLimited.Load()), fmt.Sprintf("{reason=\"mailbox_full\"} %d", m.mailboxFull.Load()),
		fmt.Sprintf("{reason=\"jump_full\"} %d", m.jumpFull.Load()), fmt.Sprintf("{reason=\"sequence\"} %d", m.sequence.Load()))
	write("compunube_match_inputs_coalesced_total", "counter", "Continuous inputs replaced before a tick.", fmt.Sprintf(" %d", m.coalesced.Load()))
	write("compunube_match_room_queue_depth", "gauge", "Queued room commands across active rooms.", fmt.Sprintf(" %d", s.RoomQueue))
	write("compunube_match_room_queue_rejected_total", "counter", "Room commands rejected on full queues.", fmt.Sprintf(" %d", s.RoomQueueRejected))
	write("compunube_match_record_queue_depth", "gauge", "Pending asynchronous match records.", fmt.Sprintf(" %d", s.RecordQueue))
	write("compunube_match_workpool_in_flight", "gauge", "Running workpool jobs.",
		fmt.Sprintf("{pool=\"profile\"} %d", s.ProfilePool.Active), fmt.Sprintf("{pool=\"settlement\"} %d", s.SettlementPool.Active))
	write("compunube_match_workpool_queue_depth", "gauge", "Queued workpool jobs.",
		fmt.Sprintf("{pool=\"profile\"} %d", s.ProfilePool.Queued), fmt.Sprintf("{pool=\"settlement\"} %d", s.SettlementPool.Queued))
	write("compunube_match_workpool_rejected_total", "counter", "Workpool jobs rejected on saturation.",
		fmt.Sprintf("{pool=\"profile\"} %d", s.ProfilePool.Rejected), fmt.Sprintf("{pool=\"settlement\"} %d", s.SettlementPool.Rejected))
	values := make([]string, 0, 3)
	for _, state := range []string{"closed", "open", "half_open"} {
		v := 0
		if s.CircuitState == state {
			v = 1
		}
		values = append(values, fmt.Sprintf("{state=\"%s\"} %d", state, v))
	}
	write("compunube_player_profile_circuit_state", "gauge", "Current circuit state as a one-hot gauge.", values...)
	write("compunube_player_profile_fast_rejects_total", "counter", "Calls rejected by an open circuit.", fmt.Sprintf(" %d", s.FastRejects))
	write("compunube_player_profile_read_retries_total", "counter", "Safe profile read retries.", fmt.Sprintf(" %d", s.ReadRetries))
	write("compunube_settlement_attempts_total", "counter", "Claimed settlement delivery outcomes.",
		fmt.Sprintf("{outcome=\"confirmed\"} %d", m.confirmed.Load()), fmt.Sprintf("{outcome=\"retry\"} %d", m.retry.Load()),
		fmt.Sprintf("{outcome=\"failed\"} %d", m.failed.Load()), fmt.Sprintf("{outcome=\"canceled\"} %d", m.canceled.Load()),
		fmt.Sprintf("{outcome=\"pending\"} %d", m.pending.Load()))
	return b.String()
}

func Register(mux *http.ServeMux, registries ...*Registry) {
	m := New()
	if len(registries) > 0 && registries[0] != nil {
		m = registries[0]
	}
	mux.HandleFunc("GET /metrics", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
		_, _ = fmt.Fprint(w, m.Render())
	})
}
