package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/aepatino5112/compunube-proyecto-1/services/match-service-go/internal/config"
	"github.com/aepatino5112/compunube-proyecto-1/services/match-service-go/internal/identity"
	"github.com/aepatino5112/compunube-proyecto-1/services/match-service-go/internal/matchstore"
	"github.com/aepatino5112/compunube-proyecto-1/services/match-service-go/internal/playerprofile"
	"github.com/aepatino5112/compunube-proyecto-1/services/match-service-go/internal/roomruntime"
	"github.com/aepatino5112/compunube-proyecto-1/services/match-service-go/internal/rooms"
	"github.com/aepatino5112/compunube-proyecto-1/services/match-service-go/internal/roomshttp"
	"github.com/aepatino5112/compunube-proyecto-1/services/match-service-go/internal/server"
	"github.com/aepatino5112/compunube-proyecto-1/services/match-service-go/internal/sessionhttp"
	"github.com/aepatino5112/compunube-proyecto-1/services/match-service-go/internal/settlement"
	"github.com/aepatino5112/compunube-proyecto-1/services/match-service-go/internal/workpool"
)

var version = "dev"

func main() {
	cfg, err := config.Load()
	if err != nil {
		slog.Error("invalid configuration", "error", err)
		os.Exit(1)
	}
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: cfg.LogLevel})).With("service", "match-service-go", "version", version)
	if err := run(cfg, logger); err != nil {
		logger.Error("match service stopped with error", "error", err)
		os.Exit(1)
	}
}

func run(cfg config.Config, logger *slog.Logger) error {
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	runtime, err := roomruntime.NewManager(ctx, roomruntime.Options{
		TickInterval: 50 * time.Millisecond, QueueCapacity: cfg.RoomCommandQueueCapacity,
		MaxRooms: cfg.MaxActiveRooms, MaxCommandsPerTick: cfg.RoomMaxCommandsPerTick,
	})
	if err != nil {
		return err
	}
	defer runtime.Close()
	profilePool, err := workpool.New(ctx, cfg.ProfileConcurrency, cfg.ProfileQueueCapacity, cfg.ProfileJobTimeout)
	if err != nil {
		return err
	}
	defer profilePool.Close()
	profileClient, err := playerprofile.NewGRPC(cfg.PlayerProfileGRPCAddr)
	if err != nil {
		return err
	}
	defer profileClient.Close()
	resilientProfile, err := playerprofile.NewResilient(profileClient, playerprofile.ResilienceOptions{
		FailureThreshold: cfg.PlayerProfileCBFailureThreshold, OpenDuration: cfg.PlayerProfileCBOpenDuration,
		HalfOpenProbes: cfg.PlayerProfileCBHalfOpenProbes, ReadMaxRetries: cfg.PlayerProfileReadMaxRetries,
		RetryBase: cfg.PlayerProfileRetryBase, RetryCap: cfg.PlayerProfileRetryCap,
	})
	if err != nil {
		return err
	}
	settlementPool, err := workpool.New(ctx, cfg.SettlementConcurrency, cfg.SettlementQueueCapacity, cfg.SettlementJobTimeout)
	if err != nil {
		return err
	}
	defer settlementPool.Close()
	var recorder interface{ Offer(matchstore.Record) }
	var store *matchstore.Postgres
	var async *matchstore.Async
	if cfg.DatabaseURL != "" {
		store, err = matchstore.Open(ctx, cfg.DatabaseURL, int32(cfg.SettlementConcurrency+2))
		if err != nil {
			return err
		}
		storeCtx, cancelStore := context.WithCancel(ctx)
		async = matchstore.NewAsync(storeCtx, store, logger)
		defer func() { cancelStore(); async.Close(); store.Close() }()
		recorder = async
	} else {
		logger.Warn("DATABASE_URL absent; match results are not durable")
	}
	identities := identity.NewRegistry()
	sessions := sessionhttp.New(identities)
	verifier := playerprofile.ProfileVerifier{Port: resilientProfile, Pool: profilePool}
	roomManager := rooms.NewManager(runtime, verifier, rooms.Options{InputSlots: cfg.RoomInputSlots, JumpEdges: cfg.RoomJumpEdgesPerPlayer, Recorder: recorder})
	if store != nil {
		coordinator, err := settlement.New(ctx, store, resilientProfile, settlementPool, roomManager, async.Durable(), cfg.SettlementConcurrency, logger)
		if err != nil {
			return err
		}
		defer coordinator.Close()
	}
	roomAPI := roomshttp.New(roomManager, identities, sessions, cfg)
	return server.New(cfg, logger, func(mux *http.ServeMux) { sessions.Register(mux); roomAPI.Register(mux) }).Run(ctx)
}
