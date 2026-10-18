package metrics

import (
	"fmt"
	"net/http"
)

// Register retains the existing minimal process metric until observability work.
func Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /metrics", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/plain; version=0.0.4")
		_, _ = fmt.Fprintln(w, "# HELP match_service_up Whether the match service process is running.")
		_, _ = fmt.Fprintln(w, "# TYPE match_service_up gauge")
		_, _ = fmt.Fprintln(w, "match_service_up 1")
	})
}
