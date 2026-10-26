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
	"github.com/aepatino5112/compunube-proyecto-1/services/match-service-go/internal/metrics"
	"github.com/aepatino5112/compunube-proyecto-1/services/match-service-go/internal/playerprofile"
	"github.com/aepatino5112/compunube-proyecto-1/services/match-service-go/internal/profilehttp"
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
	measure := metrics.New()
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
	sessions := sessionhttp.New(identities, cfg.PublicOrigins...)
	verifier := playerprofile.ProfileVerifier{Port: resilientProfile, Pool: profilePool}
	roomManager := rooms.NewManager(runtime, verifier, rooms.Options{InputSlots: cfg.RoomInputSlots, JumpEdges: cfg.RoomJumpEdgesPerPlayer, Recorder: recorder, InputObserver: measure})
	if store != nil {
		prober := playerprofile.RecoveryProber{Port: resilientProfile, Pool: profilePool}
		coordinator, err := settlement.New(ctx, store, resilientProfile, prober, settlementPool, roomManager, async.Durable(), cfg.SettlementConcurrency, logger, measure)
		if err != nil {
			return err
		}
		defer coordinator.Close()
	}
	roomAPI := roomshttp.New(roomManager, identities, sessions, cfg, measure)
	profileAPI := profilehttp.New(sessions, resilientProfile, profilePool)
	measure.SetSnapshot(func() metrics.Snapshot {
		roomsAdmitted, roomsRejected := runtime.AdmissionStats()
		roomQueue, roomQueueRejected := runtime.QueueStats()
		connections, connectionsAdmitted, connectionsRejected := roomAPI.ConnectionStats()
		profile := profilePool.Stats()
		settle := settlementPool.Stats()
		circuit := resilientProfile.Observe()
		state := string(circuit.State)
		if circuit.State == playerprofile.HalfOpen {
			state = "half_open"
		}
		s := metrics.Snapshot{
			Rooms: runtime.Count(), Connections: connections, RoomQueue: roomQueue,
			RoomsAdmitted: roomsAdmitted, RoomsRejected: roomsRejected,
			ConnectionsAdmitted: connectionsAdmitted, ConnectionsRejected: connectionsRejected,
			RoomQueueRejected: roomQueueRejected,
			ProfilePool:       metrics.Pool{Active: profile.Active, Queued: profile.Queued, Rejected: profile.Rejected},
			SettlementPool:    metrics.Pool{Active: settle.Active, Queued: settle.Queued, Rejected: settle.Rejected},
			CircuitState:      state, FastRejects: circuit.FastRejects, ReadRetries: circuit.Retries,
		}
		if async != nil {
			s.RecordQueue = async.Pending()
		}
		return s
	})
	return server.New(cfg, logger, func(mux *http.ServeMux) { sessions.Register(mux); roomAPI.Register(mux); profileAPI.Register(mux) }, measure).Run(ctx)
}
