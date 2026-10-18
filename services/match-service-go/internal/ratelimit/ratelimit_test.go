package ratelimit

import (
	"testing"
	"time"
)

func TestBurstAndRefill(t *testing.T) {
	b := New(20, 4)
	at := time.Unix(100, 0)
	for i := 0; i < 4; i++ {
		if !b.Allow(at) {
			t.Fatal("burst rejected")
		}
	}
	if b.Allow(at) {
		t.Fatal("fifth input accepted")
	}
	if !b.Allow(at.Add(50 * time.Millisecond)) {
		t.Fatal("one token did not refill")
	}
	if b.Allow(at.Add(50 * time.Millisecond)) {
		t.Fatal("refill exceeded 20/s")
	}
	if b.Rejected != 2 {
		t.Fatalf("rejected=%d", b.Rejected)
	}
}
