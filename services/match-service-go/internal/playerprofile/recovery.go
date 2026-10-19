package playerprofile

import (
	"context"
	"errors"

	"github.com/aepatino5112/compunube-proyecto-1/services/match-service-go/internal/workpool"
)

// RecoveryProber checks the shared logical circuit for pending settlement.
// Only a half-open circuit needs a safe read; the read uses the profile pool.
type RecoveryProber struct {
	Port *ResilientPort
	Pool *workpool.Pool
}

func (p RecoveryProber) Probe(ctx context.Context, playerID string) error {
	if p.Port == nil || p.Pool == nil || playerID == "" {
		return &Fault{Kind: Fatal, Code: "INVALID_RECOVERY_PROBE"}
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	switch p.Port.Stats().State {
	case Closed:
		return nil
	case Open:
		return unavailable()
	}
	done, err := p.Pool.Submit(ctx, func(jobCtx context.Context) error {
		_, callErr := p.Port.GetProfile(jobCtx, playerID)
		return callErr
	})
	if err != nil {
		return err
	}
	select {
	case err = <-done:
	case <-ctx.Done():
		return ctx.Err()
	}
	var fault *Fault
	if errors.As(err, &fault) && fault.Kind == Business {
		return nil // A deterministic response proves the dependency is reachable.
	}
	return err
}
