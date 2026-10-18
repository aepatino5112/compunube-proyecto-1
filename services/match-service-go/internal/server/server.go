package server

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"time"

	"github.com/aepatino5112/compunube-proyecto-1/services/match-service-go/internal/config"
	"github.com/aepatino5112/compunube-proyecto-1/services/match-service-go/internal/health"
	"github.com/aepatino5112/compunube-proyecto-1/services/match-service-go/internal/metrics"
)

// RouteRegistrar lets later HTTP and WebSocket cards mount their handlers.
type RouteRegistrar func(*http.ServeMux)

type Server struct {
	config config.Config
	logger *slog.Logger
	state  *health.State
	http   *http.Server
}

func New(cfg config.Config, logger *slog.Logger, register RouteRegistrar) *Server {
	mux := http.NewServeMux()
	state := &health.State{}
	state.Register(mux)
	metrics.Register(mux)
	if register != nil {
		register(mux)
	}
	return &Server{
		config: cfg,
		logger: logger,
		state:  state,
		http: &http.Server{
			Addr:              cfg.HTTPAddr,
			Handler:           mux,
			ReadHeaderTimeout: 5 * time.Second,
		},
	}
}

func (s *Server) Handler() http.Handler { return s.http.Handler }

func (s *Server) Run(ctx context.Context) error {
	listener, err := net.Listen("tcp", s.config.HTTPAddr)
	if err != nil {
		return fmt.Errorf("listen HTTP: %w", err)
	}
	return s.Serve(ctx, listener)
}

// Serve owns the listener and waits for the HTTP goroutine before returning.
func (s *Server) Serve(ctx context.Context, listener net.Listener) error {
	if err := ctx.Err(); err != nil {
		_ = listener.Close()
		return err
	}
	errorsCh := make(chan error, 1)
	go func() { errorsCh <- s.http.Serve(listener) }()
	s.state.MarkReady()
	s.logger.Info("match service listening", "addr", listener.Addr().String())
	select {
	case err := <-errorsCh:
		s.state.Stop()
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return fmt.Errorf("serve HTTP: %w", err)
	case <-ctx.Done():
		s.state.Stop()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), s.config.ShutdownTimeout)
		defer cancel()
		err := s.http.Shutdown(shutdownCtx)
		if err != nil {
			_ = s.http.Close()
		}
		serveErr := <-errorsCh
		if err != nil {
			return fmt.Errorf("shutdown HTTP: %w", err)
		}
		if !errors.Is(serveErr, http.ErrServerClosed) {
			return fmt.Errorf("serve HTTP: %w", serveErr)
		}
		s.logger.Info("match service stopped")
		return nil
	}
}
