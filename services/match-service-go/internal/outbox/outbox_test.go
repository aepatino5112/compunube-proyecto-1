package outbox

import (
	"context"
	"testing"
)

func TestBoundedDeliveryAndIsolation(t *testing.T) {
	a := New(1, 1)
	b := New(1, 1)
	ctx := context.Background()
	if !a.Push(Snapshot, "old") || !a.Push(Snapshot, "new") {
		t.Fatal("snapshot rejected")
	}
	if !a.Push(Event, "event-1") || !a.Push(Event, "event-2") {
		t.Fatal("transient event should drop without closing")
	}
	if !a.Push(Critical, "state") {
		t.Fatal("critical rejected early")
	}
	if a.Push(Critical, "overflow") {
		t.Fatal("full critical queue accepted")
	}
	if !b.Push(Critical, "healthy") {
		t.Fatal("another connection affected")
	}
	for _, want := range []string{"state", "new", "event-1"} {
		v, ok := a.Next(ctx)
		if !ok || v != want {
			t.Fatalf("got %v, want %s", v, want)
		}
	}
	v, ok := b.Next(ctx)
	if !ok || v != "healthy" {
		t.Fatalf("other queue: %v", v)
	}
	s := a.Stats()
	if s.SnapshotReplaced != 1 || s.EventDropped != 1 || s.CriticalRejected != 1 {
		t.Fatalf("stats: %+v", s)
	}
	a.Close()
	if _, ok := a.Next(ctx); ok {
		t.Fatal("closed queue delivered")
	}
}
