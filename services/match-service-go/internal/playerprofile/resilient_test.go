package playerprofile

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"
)

func testResilient(t *testing.T, f *Fake, clock func() time.Time) *ResilientPort {
	t.Helper()
	p, err := NewResilient(f, ResilienceOptions{FailureThreshold: 2, OpenDuration: time.Second, HalfOpenProbes: 1, ReadMaxRetries: 0, RetryBase: time.Millisecond, RetryCap: time.Millisecond, Clock: clock})
	if err != nil {
		t.Fatal(err)
	}
	return p
}

func TestCircuitTransitionsAndProbe(t *testing.T) {
	now := time.Now()
	var mu sync.Mutex
	clock := func() time.Time { mu.Lock(); defer mu.Unlock(); return now }
	calls := 0
	entered := make(chan struct{})
	release := make(chan struct{})
	f := &Fake{GetProfileFn: func(context.Context, string) (Profile, error) {
		calls++
		if calls <= 2 {
			return Profile{}, &Fault{Kind: Unavailable}
		}
		close(entered)
		<-release
		return Profile{PlayerID: "p"}, nil
	}}
	p := testResilient(t, f, clock)
	for i := 0; i < 2; i++ {
		_, err := p.GetProfile(context.Background(), "p")
		if Kind(err) != Unavailable {
			t.Fatal(err)
		}
	}
	if s := p.Stats(); s.State != Open || s.ConsecutiveFailures != 2 {
		t.Fatalf("open: %+v", s)
	}
	_, _ = p.GetProfile(context.Background(), "p")
	if calls != 2 || p.Stats().FastRejects != 1 {
		t.Fatal("open emitted RPC")
	}
	mu.Lock()
	now = now.Add(time.Second)
	mu.Unlock()
	done := make(chan error, 1)
	go func() { _, err := p.GetProfile(context.Background(), "p"); done <- err }()
	<-entered
	_, err := p.GetCatalog(context.Background(), "")
	if Kind(err) != Unavailable || p.Stats().State != HalfOpen {
		t.Fatalf("probe gating: %v %+v", err, p.Stats())
	}
	close(release)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if p.Stats().State != Closed {
		t.Fatal("successful probe did not close")
	}
}

func TestCircuitIgnoresBusinessAndCancellation(t *testing.T) {
	n := 0
	f := &Fake{GetProfileFn: func(context.Context, string) (Profile, error) {
		n++
		if n == 1 {
			return Profile{}, &Fault{Kind: Unavailable}
		}
		if n == 2 {
			return Profile{}, &Fault{Kind: Business, Code: "INVALID_ITEM"}
		}
		return Profile{}, &Fault{Kind: Canceled}
	}}
	p := testResilient(t, f, time.Now)
	for i := 0; i < 3; i++ {
		_, _ = p.GetProfile(context.Background(), "p")
	}
	if s := p.Stats(); s.State != Closed || s.ConsecutiveFailures != 1 {
		t.Fatalf("noneligible failures counted: %+v", s)
	}
}

func TestFailedProbeReopens(t *testing.T) {
	now := time.Now()
	calls := 0
	f := &Fake{GetCatalogFn: func(context.Context, string) (Catalog, error) { calls++; return Catalog{}, &Fault{Kind: Unavailable} }}
	p := testResilient(t, f, func() time.Time { return now })
	for i := 0; i < 2; i++ {
		_, _ = p.GetCatalog(context.Background(), "")
	}
	now = now.Add(time.Second)
	_, _ = p.GetCatalog(context.Background(), "")
	if s := p.Stats(); s.State != Open || !s.OpenUntil.Equal(now.Add(time.Second)) || calls != 3 {
		t.Fatalf("failed probe: %+v calls=%d", s, calls)
	}
}

func TestReadRetrySameContextAndMutationNoRetry(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	profileCalls, catalogCalls, mutationCalls, settlementCalls := 0, 0, 0, 0
	f := &Fake{
		GetProfileFn: func(got context.Context, _ string) (Profile, error) {
			if got != ctx {
				t.Fatal("new context")
			}
			profileCalls++
			if profileCalls == 1 {
				return Profile{}, &Fault{Kind: Unavailable}
			}
			return Profile{}, nil
		},
		GetCatalogFn: func(got context.Context, _ string) (Catalog, error) {
			if got != ctx {
				t.Fatal("new context")
			}
			catalogCalls++
			return Catalog{}, &Fault{Kind: Deadline}
		},
		BuyItemFn: func(context.Context, ItemCommand) (MutationResult, error) {
			mutationCalls++
			return MutationResult{}, &Fault{Kind: Unavailable}
		},
		CraftItemFn: func(context.Context, ItemCommand) (MutationResult, error) {
			mutationCalls++
			return MutationResult{}, &Fault{Kind: Unavailable}
		},
		ExchangeMaterialsFn: func(context.Context, ExchangeCommand) (MutationResult, error) {
			mutationCalls++
			return MutationResult{}, &Fault{Kind: Unavailable}
		},
		EquipItemFn: func(context.Context, ItemCommand) (MutationResult, error) {
			mutationCalls++
			return MutationResult{}, &Fault{Kind: Unavailable}
		},
		SetAppearanceFn: func(context.Context, AppearanceCommand) (MutationResult, error) {
			mutationCalls++
			return MutationResult{}, &Fault{Kind: Unavailable}
		},
		SettleRaceFn: func(context.Context, SettlementCommand) (SettlementResult, error) {
			settlementCalls++
			return SettlementResult{}, &Fault{Kind: Unavailable}
		},
	}
	p, err := NewResilient(f, ResilienceOptions{FailureThreshold: 9, OpenDuration: time.Second, HalfOpenProbes: 1, ReadMaxRetries: 1, RetryBase: time.Millisecond, RetryCap: time.Millisecond, Wait: func(context.Context, time.Duration) error { return nil }, Jitter: func(time.Duration) time.Duration { return 0 }})
	if err != nil {
		t.Fatal(err)
	}
	_, err = p.GetProfile(ctx, "p")
	if err != nil {
		t.Fatal(err)
	}
	_, _ = p.GetCatalog(ctx, "")
	_, _ = p.BuyItem(ctx, ItemCommand{})
	_, _ = p.CraftItem(ctx, ItemCommand{})
	_, _ = p.ExchangeMaterials(ctx, ExchangeCommand{})
	_, _ = p.EquipItem(ctx, ItemCommand{})
	_, _ = p.SetAppearance(ctx, AppearanceCommand{})
	_, _ = p.SettleRace(ctx, SettlementCommand{})
	if profileCalls != 2 || catalogCalls != 2 || mutationCalls != 5 || settlementCalls != 1 || p.Stats().Retries != 2 {
		t.Fatalf("counts %d %d %d %d %+v", profileCalls, catalogCalls, mutationCalls, settlementCalls, p.Stats())
	}
	expired, c := context.WithCancel(ctx)
	c()
	_, err = p.GetProfile(expired, "p")
	if !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
}
