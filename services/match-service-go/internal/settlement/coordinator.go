// Package settlement drains durable match.settlement_delivery rows through the
// Player/Profile port. No worker runs in a RoomLoop.
package settlement

import (
	"context"
	"errors"
	"log/slog"
	"math/rand/v2"
	"sync"
	"time"

	"github.com/aepatino5112/compunube-proyecto-1/services/match-service-go/internal/matchstore"
	"github.com/aepatino5112/compunube-proyecto-1/services/match-service-go/internal/playerprofile"
	"github.com/aepatino5112/compunube-proyecto-1/services/match-service-go/internal/rooms"
	"github.com/aepatino5112/compunube-proyecto-1/services/match-service-go/internal/workpool"
)

type Store interface {
	ClaimDue(context.Context, time.Time, time.Duration) (matchstore.Delivery, bool, error)
	Confirm(context.Context, matchstore.Delivery, time.Time) (bool, error)
	Retry(context.Context, matchstore.Delivery, time.Time, string) error
	Fail(context.Context, matchstore.Delivery, string) error
}
type Publisher interface {
	ConfirmSettlement(context.Context, string, string) error
}
type RecoveryProber interface {
	Probe(context.Context, string) error
}
type Coordinator struct {
	store       Store
	port        playerprofile.Port
	prober      RecoveryProber
	pool        *workpool.Pool
	publish     Publisher
	logger      *slog.Logger
	ctx         context.Context
	cancel      context.CancelFunc
	wake        <-chan struct{}
	wg          sync.WaitGroup
	pubMu       sync.Mutex
	pubPending  map[string]string
	lease, poll time.Duration
}

func New(parent context.Context, store Store, port playerprofile.Port, prober RecoveryProber, pool *workpool.Pool, publish Publisher, wake <-chan struct{}, workers int, logger *slog.Logger) (*Coordinator, error) {
	if parent == nil || store == nil || port == nil || prober == nil || pool == nil || workers < 1 || logger == nil {
		return nil, errors.New("invalid settlement coordinator options")
	}
	ctx, cancel := context.WithCancel(parent)
	c := &Coordinator{store: store, port: port, prober: prober, pool: pool, publish: publish, logger: logger, ctx: ctx, cancel: cancel, wake: wake, lease: 10 * time.Second, poll: 500 * time.Millisecond}
	c.wg.Add(workers)
	for i := 0; i < workers; i++ {
		go c.worker()
	}
	return c, nil
}
func (c *Coordinator) Close() { c.cancel(); c.wg.Wait() }
func (c *Coordinator) worker() {
	defer c.wg.Done()
	ticker := time.NewTicker(c.poll)
	defer ticker.Stop()
	for {
		if c.ctx.Err() != nil {
			return
		}
		c.flushPublish()
		claimCtx, cancel := context.WithTimeout(c.ctx, 2*time.Second)
		d, ok, err := c.store.ClaimDue(claimCtx, time.Now(), c.lease)
		cancel()
		if err != nil {
			if c.ctx.Err() == nil {
				c.logger.Warn("settlement recovery query failed", "error", err)
			}
		} else if ok {
			c.process(d)
			continue
		}
		select {
		case <-c.ctx.Done():
			return
		case <-ticker.C:
		case <-c.wake:
		}
	}
}
func (c *Coordinator) process(d matchstore.Delivery) {
	if d.RaceID == "" || d.PlayerID == "" || d.RoomID == "" || d.CreditedPlastic < 0 || d.CreditedMetal < 0 || d.Outcome != "finished" && (d.CreditedPlastic != 0 || d.CreditedMetal != 0) {
		c.fail(d, "INVALID_DURABLE_RESULT")
		return
	}
	cmd := playerprofile.SettlementCommand{RaceID: d.RaceID, PlayerID: d.PlayerID, Outcome: d.Outcome, CreditedPlastic: uint64(d.CreditedPlastic), CreditedMetal: uint64(d.CreditedMetal)}
	done, err := c.pool.Submit(c.ctx, func(ctx context.Context) error { _, err := c.port.SettleRace(ctx, cmd); return err })
	if err == nil {
		select {
		case err = <-done:
		case <-c.ctx.Done():
			return
		}
	}
	if c.ctx.Err() != nil {
		return
	}
	if err == nil {
		dbCtx, cancel := context.WithTimeout(c.ctx, 2*time.Second)
		all, saveErr := c.store.Confirm(dbCtx, d, time.Now())
		cancel()
		if saveErr != nil {
			c.logger.Warn("settlement confirmation not durable yet", "race_id", d.RaceID, "player_id", d.PlayerID, "error", saveErr)
			return
		}
		if all {
			c.queuePublish(d.RoomID, d.RaceID)
			c.flushPublish()
		}
		return
	}
	if errors.Is(err, workpool.ErrSaturated) {
		c.retry(d, "LOCAL_SATURATED")
		return
	}
	if errors.Is(err, context.Canceled) {
		return
	}
	if errors.Is(err, context.DeadlineExceeded) {
		c.retryTransient(d, "DEADLINE_EXCEEDED")
		return
	}
	var fault *playerprofile.Fault
	if !errors.As(err, &fault) {
		c.fail(d, "UNCLASSIFIED")
		return
	}
	switch fault.Kind {
	case playerprofile.Unavailable, playerprofile.ResourceExhausted, playerprofile.Deadline, playerprofile.System:
		c.retryTransient(d, fault.Code)
	case playerprofile.Canceled:
		return
	default:
		c.fail(d, fault.Code)
	}
}
func (c *Coordinator) retryTransient(d matchstore.Delivery, code string) {
	if c.prober != nil {
		// Even a successful read only closes the circuit. The claimed delivery
		// follows its normal durable Retry; no second SettleRace is sent here.
		if probeErr := c.prober.Probe(c.ctx, d.PlayerID); probeErr != nil {
			var fault *playerprofile.Fault
			if errors.As(probeErr, &fault) && fault.Kind == playerprofile.Fatal {
				c.logger.Error("settlement recovery probe configuration failure", "code", fault.Code)
			}
		}
	}
	if c.ctx.Err() == nil {
		c.retry(d, code)
	}
}
func (c *Coordinator) queuePublish(roomID, raceID string) {
	if c.publish == nil {
		return
	}
	c.pubMu.Lock()
	if c.pubPending == nil {
		c.pubPending = map[string]string{}
	}
	c.pubPending[raceID] = roomID
	c.pubMu.Unlock()
}
func (c *Coordinator) flushPublish() {
	if c.publish == nil {
		return
	}
	c.pubMu.Lock()
	batch := make(map[string]string, len(c.pubPending))
	for raceID, roomID := range c.pubPending {
		batch[raceID] = roomID
	}
	c.pubMu.Unlock()
	for raceID, roomID := range batch {
		ctx, cancel := context.WithTimeout(c.ctx, time.Second)
		err := c.publish.ConfirmSettlement(ctx, roomID, raceID)
		cancel()
		if err == nil || errors.Is(err, rooms.ErrNotFound) {
			c.pubMu.Lock()
			if c.pubPending[raceID] == roomID {
				delete(c.pubPending, raceID)
			}
			c.pubMu.Unlock()
		}
	}
}
func (c *Coordinator) retry(d matchstore.Delivery, code string) {
	at := time.Now().Add(Backoff(d.AttemptCount))
	ctx, cancel := context.WithTimeout(c.ctx, 2*time.Second)
	err := c.store.Retry(ctx, d, at, code)
	cancel()
	if err != nil && c.ctx.Err() == nil {
		c.logger.Warn("settlement retry scheduling failed", "race_id", d.RaceID, "player_id", d.PlayerID, "error", err)
	}
}
func (c *Coordinator) fail(d matchstore.Delivery, code string) {
	ctx, cancel := context.WithTimeout(c.ctx, 2*time.Second)
	err := c.store.Fail(ctx, d, code)
	cancel()
	if err != nil && c.ctx.Err() == nil {
		c.logger.Warn("settlement permanent failure not recorded", "race_id", d.RaceID, "player_id", d.PlayerID, "error", err)
	}
}
func Backoff(attempt int) time.Duration {
	if attempt < 1 {
		attempt = 1
	}
	if attempt > 7 {
		attempt = 7
	}
	max := time.Second * time.Duration(1<<(attempt-1))
	if max > time.Minute {
		max = time.Minute
	}
	floor := 100 * time.Millisecond
	return floor + time.Duration(rand.Int64N(int64(max-floor)+1))
}
