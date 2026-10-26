package correlation

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gorilla/websocket"
	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"
)

func TestHTTPGeneratesPreservesAndReplacesIDs(t *testing.T) {
	for _, tc := range []struct {
		name, incoming string
		preserve       bool
	}{
		{name: "missing"},
		{name: "valid", incoming: "client-ABC_123", preserve: true},
		{name: "unsafe", incoming: "secret /?\n"},
		{name: "too_long", incoming: strings.Repeat("a", 65)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var logs bytes.Buffer
			logger := slog.New(slog.NewJSONHandler(&logs, nil))
			var fromContext string
			handler := HTTP(logger, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				fromContext = FromContext(r.Context())
				w.WriteHeader(http.StatusAccepted)
			}))
			request := httptest.NewRequest(http.MethodPost, "/v1/items/private-player-id?token=secret", nil)
			if tc.incoming != "" {
				request.Header.Set(Header, tc.incoming)
			}
			w := httptest.NewRecorder()
			handler.ServeHTTP(w, request)
			id := w.Header().Get(Header)
			if !Valid(id) || id != fromContext || w.Code != http.StatusAccepted {
				t.Fatalf("invalid correlation: %q, context=%q, status=%d", id, fromContext, w.Code)
			}
			if (id == tc.incoming) != tc.preserve {
				t.Fatalf("preserve=%v incoming=%q returned=%q", tc.preserve, tc.incoming, id)
			}
			if strings.Contains(logs.String(), "secret") || strings.Contains(logs.String(), "private-player-id") {
				t.Fatal("request data leaked into logs")
			}
			lines := strings.Split(strings.TrimSpace(logs.String()), "\n")
			if len(lines) != 2 {
				t.Fatalf("expected start and completion logs: %s", logs.String())
			}
			for _, line := range lines {
				var event map[string]any
				if err := json.Unmarshal([]byte(line), &event); err != nil || event["correlation_id"] != id {
					t.Fatalf("correlation missing in log: %s (%v)", line, err)
				}
			}
		})
	}
}

func TestWebSocketHandshakeKeepsCorrelation(t *testing.T) {
	logger := slog.New(slog.NewJSONHandler(&bytes.Buffer{}, nil))
	upgrader := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}
	server := httptest.NewServer(HTTP(logger, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if FromContext(r.Context()) != "socket-123" {
			t.Error("handshake context lost correlation")
		}
		responseHeaders := http.Header{}
		responseHeaders.Set(Header, FromContext(r.Context()))
		conn, err := upgrader.Upgrade(w, r, responseHeaders)
		if err != nil {
			t.Error(err)
			return
		}
		_ = conn.Close()
	})))
	defer server.Close()
	headers := http.Header{Header: []string{"socket-123"}}
	conn, response, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http"), headers)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	if response.StatusCode != http.StatusSwitchingProtocols || response.Header.Get(Header) != "socket-123" {
		t.Fatalf("handshake lost correlation: %d %q", response.StatusCode, response.Header.Get(Header))
	}
}

func TestUnaryClientInterceptorPropagatesSafeID(t *testing.T) {
	for _, tc := range []struct {
		name string
		ctx  context.Context
		want string
	}{
		{"http", WithID(context.Background(), "client-ABC_123"), "client-ABC_123"},
		{"background", context.Background(), ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			err := UnaryClientInterceptor(tc.ctx, "/compunube.player.v1.PlayerProfileService/GetProfile", nil, nil, nil,
				func(ctx context.Context, _ string, _, _ any, _ *grpc.ClientConn, _ ...grpc.CallOption) error {
					md, ok := metadata.FromOutgoingContext(ctx)
					if !ok || len(md.Get(MetadataKey)) != 1 {
						t.Fatalf("missing outgoing metadata: %v", md)
					}
					id := md.Get(MetadataKey)[0]
					if !Valid(id) || tc.want != "" && id != tc.want {
						t.Fatalf("invalid ID: %q", id)
					}
					return nil
				})
			if err != nil {
				t.Fatal(err)
			}
		})
	}
}
