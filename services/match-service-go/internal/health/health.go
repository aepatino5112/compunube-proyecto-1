package health

import (
	"net/http"
	"sync/atomic"
)

// State is local process state only. Dependency outages do not change readiness.
type State struct {
	ready    atomic.Bool
	stopping atomic.Bool
}

func (s *State) Ready() bool { return s.ready.Load() && !s.stopping.Load() }

func (s *State) MarkReady() { s.ready.Store(true) }

func (s *State) Stop() {
	s.stopping.Store(true)
	s.ready.Store(false)
}

func (s *State) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		if s.stopping.Load() {
			http.Error(w, "stopping", http.StatusServiceUnavailable)
			return
		}
		_, _ = w.Write([]byte("ok\n"))
	})
	mux.HandleFunc("GET /readyz", func(w http.ResponseWriter, _ *http.Request) {
		if !s.Ready() {
			http.Error(w, "not ready", http.StatusServiceUnavailable)
			return
		}
		_, _ = w.Write([]byte("ready\n"))
	})
}
