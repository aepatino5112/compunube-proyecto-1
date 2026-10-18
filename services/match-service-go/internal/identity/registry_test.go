package identity

import (
	"context"
	"errors"
	"sync"
	"testing"
)

func TestCreateAndRebind(t *testing.T) {
	r := NewRegistry()
	ctx := context.Background()
	id, token, err := r.Create(ctx)
	if err != nil || id == "" || token == "" || id == token {
		t.Fatalf("invalid session: id=%q err=%v", id, err)
	}
	if actual, ok := r.Lookup(ctx, token); !ok || actual != id {
		t.Fatal("session did not resolve")
	}
	otherID, _, err := r.Create(ctx)
	if err != nil || otherID == id {
		t.Fatal("second identity not distinct")
	}
	first, err := r.Bind(ctx, id)
	if err != nil || !first.Connected || first.ConnectionID == "" {
		t.Fatalf("first bind failed: %v", err)
	}
	if err := r.SetRoom(ctx, id, "room-one"); err != nil {
		t.Fatal(err)
	}
	second, err := r.Bind(ctx, id)
	if err != nil || second.ConnectionID == first.ConnectionID || second.RoomID != "room-one" {
		t.Fatalf("rebind lost identity or room: %v", err)
	}
	if ok, err := r.Disconnect(ctx, id, first.ConnectionID); err != nil || ok {
		t.Fatal("stale connection disconnected rebind")
	}
	if ok, err := r.Disconnect(ctx, otherID, second.ConnectionID); err != nil || ok {
		t.Fatal("other player disconnected this identity")
	}
	if ok, err := r.Disconnect(ctx, id, second.ConnectionID); err != nil || !ok {
		t.Fatal("current connection did not disconnect")
	}
	snapshot, _ := r.Snapshot(ctx, id)
	if snapshot.Connected || snapshot.DisconnectedAt.IsZero() || snapshot.PlayerID != id {
		t.Fatal("disconnect snapshot incorrect")
	}
	third, err := r.Bind(ctx, id)
	if err != nil || third.ConnectionID == second.ConnectionID || !third.DisconnectedAt.IsZero() {
		t.Fatal("rebind did not reset disconnectedAt")
	}
	if _, err := r.Bind(ctx, "not-issued"); !errors.Is(err, ErrUnknownPlayer) {
		t.Fatalf("foreign identity was accepted: %v", err)
	}
}

func TestConcurrentRegistryAndContext(t *testing.T) {
	r := NewRegistry()
	ctx := context.Background()
	const count = 100
	ids := make(chan string, count)
	tokens := make(chan string, count)
	var wg sync.WaitGroup
	for i := 0; i < count; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			id, token, err := r.Create(ctx)
			if err != nil {
				t.Error(err)
				return
			}
			bound, err := r.Bind(ctx, id)
			if err != nil || bound.PlayerID != id {
				t.Errorf("bind: %v", err)
				return
			}
			if _, err := r.Disconnect(ctx, id, bound.ConnectionID); err != nil {
				t.Error(err)
			}
			ids <- id
			tokens <- token
		}()
	}
	wg.Wait()
	close(ids)
	close(tokens)
	seenIDs := map[string]bool{}
	seenTokens := map[string]bool{}
	for id := range ids {
		if seenIDs[id] {
			t.Fatal("duplicate player ID")
		}
		seenIDs[id] = true
	}
	for token := range tokens {
		if seenTokens[token] {
			t.Fatal("duplicate token")
		}
		seenTokens[token] = true
	}
	if len(seenIDs) != count || len(seenTokens) != count {
		t.Fatal("missing concurrent session")
	}
	cancelled, cancel := context.WithCancel(ctx)
	cancel()
	if _, _, err := r.Create(cancelled); err != context.Canceled {
		t.Fatalf("cancelled create: %v", err)
	}
	if _, err := r.Bind(cancelled, "not-issued"); err != context.Canceled {
		t.Fatalf("cancelled bind: %v", err)
	}
	if _, ok := r.Lookup(cancelled, "anything"); ok {
		t.Fatal("cancelled lookup succeeded")
	}
	if _, ok := r.Snapshot(cancelled, "anything"); ok {
		t.Fatal("cancelled snapshot succeeded")
	}
}
