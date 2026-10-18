// Package inputmailbox bounds continuous intentions and discrete jump edges.
// WebSocket readers offer inputs; only the owning RoomLoop drains them.
package inputmailbox

import (
	"errors"
	"sort"
	"sync"
)

var ErrFull = errors.New("input slots full")
var ErrJumpFull = errors.New("jump edge queue full")
var ErrSequence = errors.New("input sequence invalid")

type Input struct {
	Seq, JumpSeq uint64
	Steer        float64
	NetSide      int
	Boost        bool
}
type Delivery struct {
	PlayerID string
	Latest   *Input
	JumpSeq  *uint64
}
type Stats struct{ Accepted, Coalesced, Rejected, JumpRejected uint64 }
type slot struct {
	lastSeq, lastJump uint64
	seen              bool
	latest            *Input
	jumps             []uint64
}
type Mailbox struct {
	mu                     sync.Mutex
	slots                  map[string]*slot
	capacity, jumpCapacity int
	stats                  Stats
}

func New(capacity, jumpCapacity int) *Mailbox {
	if capacity <= 0 || jumpCapacity <= 0 {
		panic("invalid mailbox capacity")
	}
	return &Mailbox{slots: map[string]*slot{}, capacity: capacity, jumpCapacity: jumpCapacity}
}
func (m *Mailbox) Offer(playerID string, in Input) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	s := m.slots[playerID]
	if s == nil {
		if len(m.slots) >= m.capacity {
			m.stats.Rejected++
			return ErrFull
		}
		s = &slot{}
		m.slots[playerID] = s
	}
	if (s.seen && in.Seq <= s.lastSeq) || in.JumpSeq < s.lastJump {
		m.stats.Rejected++
		return ErrSequence
	}
	if in.JumpSeq > s.lastJump && len(s.jumps) >= m.jumpCapacity {
		m.stats.JumpRejected++
		return ErrJumpFull
	}
	if in.JumpSeq > s.lastJump {
		s.jumps = append(s.jumps, in.JumpSeq)
		s.lastJump = in.JumpSeq
	}
	if s.latest != nil {
		m.stats.Coalesced++
	}
	copy := in
	s.latest = &copy
	s.lastSeq = in.Seq
	s.seen = true
	m.stats.Accepted++
	return nil
}

// Drain yields at most one jump edge per player per tick. A later continuous
// packet never erases a previously accepted edge.
func (m *Mailbox) Drain() []Delivery {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]Delivery, 0, len(m.slots))
	for id, s := range m.slots {
		d := Delivery{PlayerID: id, Latest: s.latest}
		s.latest = nil
		if len(s.jumps) > 0 {
			v := s.jumps[0]
			d.JumpSeq = &v
			s.jumps = s.jumps[1:]
		}
		if d.Latest != nil || d.JumpSeq != nil {
			out = append(out, d)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].PlayerID < out[j].PlayerID })
	return out
}

// Neutral discards pending input and resets admission to the last processed
// counters that the reconnecting client can see in its authoritative snapshot.
func (m *Mailbox) Neutral(playerID string, processedSeq, processedJumpSeq uint64) {
	m.mu.Lock()
	if s := m.slots[playerID]; s != nil {
		s.latest = nil
		s.jumps = nil
		// Pending accepted packets were never applied. The reconnecting client
		// resumes from the snapshot's processed counters, not discarded packets.
		s.lastSeq = processedSeq
		s.lastJump = processedJumpSeq
		s.seen = true
	}
	m.mu.Unlock()
}
func (m *Mailbox) Stats() Stats { m.mu.Lock(); defer m.mu.Unlock(); return m.stats }
