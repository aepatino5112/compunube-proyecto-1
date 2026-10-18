package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/aepatino5112/compunube-proyecto-1/services/match-service-go/internal/config"
	"github.com/aepatino5112/compunube-proyecto-1/services/match-service-go/internal/identity"
	"github.com/aepatino5112/compunube-proyecto-1/services/match-service-go/internal/roomruntime"
	"github.com/aepatino5112/compunube-proyecto-1/services/match-service-go/internal/server"
	"github.com/aepatino5112/compunube-proyecto-1/services/match-service-go/internal/sessionhttp"
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
	rooms, err := roomruntime.NewManager(ctx, roomruntime.Options{
		TickInterval: 50 * time.Millisecond, QueueCapacity: cfg.RoomCommandQueueCapacity,
	})
	if err != nil {
		return err
	}
	defer rooms.Close()
	sessions := sessionhttp.New(identity.NewRegistry())
	return server.New(cfg, logger, sessions.Register).Run(ctx)
}
