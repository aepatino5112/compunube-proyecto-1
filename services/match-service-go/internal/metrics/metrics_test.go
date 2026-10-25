package metrics

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestOperationalMetrics(t *testing.T) {
	m := New()
	m.SetSnapshot(func() Snapshot {
		return Snapshot{
			Rooms: 2, Connections: 3, RoomQueue: 4, RoomQueueRejected: 5,
			RoomsAdmitted: 6, RoomsRejected: 7, ConnectionsAdmitted: 8, ConnectionsRejected: 9,
			ProfilePool:    Pool{Active: 1, Queued: 2, Rejected: 3},
			SettlementPool: Pool{Active: 4, Queued: 5, Rejected: 6},
			CircuitState:   "half_open", FastRejects: 10, ReadRetries: 11,
		}
	})
	m.InputDropped("rate_limited")
	m.InputDropped("mailbox_full")
	m.InputCoalesced()
	m.SettlementAttempt("retry")
	m.SettlementAttempt("confirmed")
	mux := http.NewServeMux()
	Register(mux, m)
	r := httptest.NewRecorder()
	mux.ServeHTTP(r, httptest.NewRequest(http.MethodGet, "/metrics", nil))
	if r.Code != http.StatusOK || !strings.HasPrefix(r.Header().Get("Content-Type"), "text/plain; version=0.0.4") {
		t.Fatalf("unexpected response: %d %s", r.Code, r.Header().Get("Content-Type"))
	}
	body := r.Body.String()
	for _, want := range []string{
		"match_service_up 1",
		"compunube_match_rooms_active 2",
		"compunube_match_connections_active 3",
		"compunube_match_admission_rejected_total{kind=\"room\",reason=\"limit\"} 7",
		"compunube_match_inputs_dropped_total{reason=\"rate_limited\"} 1",
		"compunube_match_inputs_dropped_total{reason=\"mailbox_full\"} 1",
		"compunube_match_inputs_coalesced_total 1",
		"compunube_match_room_queue_depth 4",
		"compunube_match_workpool_in_flight{pool=\"profile\"} 1",
		"compunube_match_workpool_queue_depth{pool=\"settlement\"} 5",
		"compunube_match_workpool_rejected_total{pool=\"profile\"} 3",
		"compunube_player_profile_circuit_state{state=\"half_open\"} 1",
		"compunube_player_profile_fast_rejects_total 10",
		"compunube_player_profile_read_retries_total 11",
		"compunube_settlement_attempts_total{outcome=\"retry\"} 1",
		"compunube_settlement_attempts_total{outcome=\"confirmed\"} 1",
	} {
		if !strings.Contains(body, want+"\n") {
			t.Errorf("missing metric %q", want)
		}
	}
	if strings.Count(body, "# HELP ") != strings.Count(body, "# TYPE ") {
		t.Error("every metric family needs HELP and TYPE")
	}
}
