package workpool

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestSeparatePoolsAndShutdown(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	profile, err := New(ctx, 1, 1, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	settlement, err := New(ctx, 1, 1, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	defer settlement.Close()
	entered := make(chan struct{})
	first, err := profile.Submit(ctx, func(jobCtx context.Context) error { close(entered); <-jobCtx.Done(); return jobCtx.Err() })
	if err != nil {
		t.Fatal(err)
	}
	<-entered
	second, err := profile.Submit(ctx, func(context.Context) error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	if _, err := profile.Submit(ctx, func(context.Context) error { return nil }); !errors.Is(err, ErrSaturated) {
		t.Fatalf("profile overflow: %v", err)
	}
	healthy, err := settlement.Submit(ctx, func(context.Context) error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	if err := <-healthy; err != nil {
		t.Fatal(err)
	}
	done := make(chan struct{})
	go func() { profile.Close(); close(done) }()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("shutdown leaked worker")
	}
	if err := <-first; err == nil {
		t.Fatal("running job missed cancellation")
	}
	if err := <-second; !errors.Is(err, ErrClosed) {
		t.Fatalf("queued job after close: %v", err)
	}
	stats := profile.Stats()
	if stats.Rejected != 1 || stats.Active != 0 || stats.Queued != 0 {
		t.Fatalf("stats: %+v", stats)
	}
	profile.Close()
}
