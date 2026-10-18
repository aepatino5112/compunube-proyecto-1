package server

import (
	"context"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/aepatino5112/compunube-proyecto-1/services/match-service-go/internal/config"
)

func testServer(register RouteRegistrar) *Server {
	return New(config.Config{HTTPAddr: "127.0.0.1:8080", ShutdownTimeout: time.Second}, slog.New(slog.NewTextHandler(io.Discard, nil)), register)
}

func TestRunPropagatesListenFailure(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	s := testServer(nil)
	s.config.HTTPAddr = listener.Addr().String()
	if err := s.Run(context.Background()); err == nil || !strings.Contains(err.Error(), "listen HTTP") {
		t.Fatalf("expected controlled listen error, got %v", err)
	}
	if s.state.Ready() {
		t.Fatal("failed listener advertised readiness")
	}
}

func status(handler http.Handler, path string) int {
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest(http.MethodGet, path, nil))
	return w.Code
}

func TestHealthReadinessTransitions(t *testing.T) {
	s := testServer(nil)
	if status(s.Handler(), "/healthz") != 200 || status(s.Handler(), "/readyz") != 503 || status(s.Handler(), "/metrics") != 200 {
		t.Fatal("incorrect initial health, readiness or metrics")
	}
	s.state.MarkReady()
	if status(s.Handler(), "/readyz") != 200 {
		t.Fatal("server did not become ready")
	}
	s.state.Stop()
	if status(s.Handler(), "/healthz") != 503 || status(s.Handler(), "/readyz") != 503 {
		t.Fatal("server still advertises health/readiness while stopping")
	}
}

func TestServeDrainsAndStops(t *testing.T) {
	entered := make(chan struct{})
	release := make(chan struct{})
	s := testServer(func(mux *http.ServeMux) {
		mux.HandleFunc("GET /hold", func(w http.ResponseWriter, _ *http.Request) {
			close(entered)
			<-release
			w.WriteHeader(http.StatusNoContent)
		})
	})
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- s.Serve(ctx, listener) }()
	client := &http.Client{Timeout: 2 * time.Second}
	response := make(chan error, 1)
	go func() {
		res, err := client.Get("http://" + listener.Addr().String() + "/hold")
		if err == nil {
			_ = res.Body.Close()
			if res.StatusCode != http.StatusNoContent {
				err = io.ErrUnexpectedEOF
			}
		}
		response <- err
	}()
	select {
	case <-entered:
	case <-time.After(2 * time.Second):
		t.Fatal("request never entered handler")
	}
	if !s.state.Ready() {
		t.Fatal("server not ready while serving")
	}
	cancel()
	deadline := time.After(time.Second)
	for s.state.Ready() {
		select {
		case <-deadline:
			t.Fatal("readiness did not drop on shutdown")
		default:
			time.Sleep(time.Millisecond)
		}
	}
	close(release)
	if err := <-response; err != nil {
		t.Fatal(err)
	}
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if status(s.Handler(), "/readyz") != 503 {
		t.Fatal("readiness recovered after shutdown")
	}
}
