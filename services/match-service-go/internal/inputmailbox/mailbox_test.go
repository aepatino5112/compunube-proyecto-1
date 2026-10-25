package inputmailbox

import (
	"errors"
	"testing"
)

type observedInputs struct {
	drops     map[string]int
	coalesced int
}

func (o *observedInputs) InputDropped(reason string) { o.drops[reason]++ }
func (o *observedInputs) InputCoalesced()            { o.coalesced++ }

func TestLatestInputAndJumpEdges(t *testing.T) {
	observer := &observedInputs{drops: map[string]int{}}
	m := New(1, 2, observer)
	for _, in := range []Input{{Seq: 0, JumpSeq: 1, Steer: 1}, {Seq: 1, JumpSeq: 1, Steer: 0}, {Seq: 2, JumpSeq: 2, Steer: -1}} {
		if err := m.Offer("p", in); err != nil {
			t.Fatal(err)
		}
	}
	if err := m.Offer("p", Input{Seq: 3, JumpSeq: 3}); !errors.Is(err, ErrJumpFull) {
		t.Fatalf("jump overflow: %v", err)
	}
	if err := m.Offer("p", Input{Seq: 2, JumpSeq: 2}); !errors.Is(err, ErrSequence) {
		t.Fatalf("duplicate: %v", err)
	}
	if err := m.Offer("other", Input{Seq: 1}); !errors.Is(err, ErrFull) {
		t.Fatalf("slot overflow: %v", err)
	}
	d := m.Drain()
	if len(d) != 1 || d[0].Latest.Seq != 2 || *d[0].JumpSeq != 1 {
		t.Fatalf("first drain: %+v", d)
	}
	d = m.Drain()
	if len(d) != 1 || d[0].Latest != nil || *d[0].JumpSeq != 2 {
		t.Fatalf("second drain: %+v", d)
	}
	if err := m.Offer("p", Input{Seq: 3, JumpSeq: 3}); err != nil {
		t.Fatal(err)
	}
	m.Neutral("p", 2, 2)
	if err := m.Offer("p", Input{Seq: 1, JumpSeq: 2}); !errors.Is(err, ErrSequence) {
		t.Fatalf("reentry reset sequence: %v", err)
	}
	if err := m.Offer("p", Input{Seq: 3, JumpSeq: 3}); err != nil {
		t.Fatalf("discarded pending input blocked reentry: %v", err)
	}
	s := m.Stats()
	if s.Coalesced != 2 || s.JumpRejected != 1 {
		t.Fatalf("stats: %+v", s)
	}
	if observer.coalesced != 2 || observer.drops["jump_full"] != 1 || observer.drops["mailbox_full"] != 1 || observer.drops["sequence"] != 2 {
		t.Fatalf("observer: %+v", observer)
	}
}
