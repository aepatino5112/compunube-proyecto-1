package roomshttp

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/aepatino5112/compunube-proyecto-1/services/match-service-go/internal/identity"
	"github.com/aepatino5112/compunube-proyecto-1/services/match-service-go/internal/roomruntime"
	"github.com/aepatino5112/compunube-proyecto-1/services/match-service-go/internal/rooms"
	"github.com/aepatino5112/compunube-proyecto-1/services/match-service-go/internal/sessionhttp"
	"github.com/gorilla/websocket"
)

func setup(t *testing.T) (*httptest.Server, *identity.Registry) {
	t.Helper()
	rt, err := roomruntime.NewManager(context.Background(), roomruntime.Options{TickInterval: 50 * time.Millisecond, QueueCapacity: 32})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(rt.Close)
	ids := identity.NewRegistry()
	sessions := sessionhttp.New(ids)
	api := New(rooms.NewManager(rt, rooms.UnavailableVerifier{}), ids, sessions)
	mux := http.NewServeMux()
	sessions.Register(mux)
	api.Register(mux)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv, ids
}
func req(t *testing.T, url, token, body string) (int, map[string]any) {
	t.Helper()
	r, err := http.NewRequest(http.MethodPost, url, strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	if token != "" {
		r.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := http.DefaultClient.Do(r)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var out map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatal(err)
	}
	return resp.StatusCode, out
}
func TestHTTPRoomsUseSessionIdentity(t *testing.T) {
	srv, ids := setup(t)
	p, tok, err := ids.Create(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	status, _ := req(t, srv.URL+"/v1/rooms", "", `{"mapId":"maracaibo"}`)
	if status != 401 {
		t.Fatalf("unauthenticated: %d", status)
	}
	for _, body := range []string{`{"mapId":"invalid"}`, `{"mapId":"maracaibo","playerId":"spoof"}`} {
		status, _ = req(t, srv.URL+"/v1/rooms", tok, body)
		if status < 400 {
			t.Fatalf("accepted %s", body)
		}
	}
	status, created := req(t, srv.URL+"/v1/rooms", tok, `{"mapId":"maracaibo"}`)
	if status != 201 || created["playerId"] != p || created["state"] != "LOBBY" {
		t.Fatalf("created: %d %+v", status, created)
	}
	roomID := created["roomId"].(string)
	for i := 0; i < 3; i++ {
		other, secret, err := ids.Create(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		status, joined := req(t, srv.URL+"/v1/rooms/"+roomID+"/memberships", secret, "")
		if status != 200 || joined["playerId"] != other {
			t.Fatalf("join: %d %+v", status, joined)
		}
	}
	_, fifth, _ := ids.Create(context.Background())
	_ = fifth
	status, full := req(t, srv.URL+"/v1/rooms/"+roomID+"/memberships", fifth, "")
	if status != 409 || full["code"] != "ROOM_FULL" {
		t.Fatalf("fifth: %d %+v", status, full)
	}
}
func TestRealtimeHandshakeAndRoomState(t *testing.T) {
	srv, ids := setup(t)
	p, tok, _ := ids.Create(context.Background())
	_, created := req(t, srv.URL+"/v1/rooms", tok, `{"mapId":"orinoco"}`)
	roomID := created["roomId"].(string)
	url := "ws" + strings.TrimPrefix(srv.URL, "http") + "/v1/realtime"
	bad := websocket.Dialer{Subprotocols: []string{"wrong"}}
	if c, resp, err := bad.Dial(url, http.Header{"Authorization": []string{"Bearer " + tok}}); err == nil {
		c.Close()
		t.Fatal("wrong subprotocol accepted")
	} else if resp == nil || resp.StatusCode != 400 {
		t.Fatalf("wrong protocol: %v %+v", err, resp)
	}
	d := websocket.Dialer{Subprotocols: []string{"compunube.realtime.v1"}}
	c, _, err := d.Dial(url, http.Header{"Authorization": []string{"Bearer " + tok}})
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	if c.Subprotocol() != "compunube.realtime.v1" {
		t.Fatal("subprotocol missing")
	}
	_ = c.SetReadDeadline(time.Now().Add(time.Second))
	var state map[string]any
	if err := c.ReadJSON(&state); err != nil {
		t.Fatal(err)
	}
	if state["type"] != "room.state" || state["selfPlayerId"] != p || state["room"].(map[string]any)["roomId"] != roomID {
		t.Fatalf("state: %+v", state)
	}
	if err := c.WriteJSON(map[string]any{"type": "room.ready", "protocolVersion": 1, "roomId": roomID, "ready": true, "profileRevision": 1, "reduceChoice": "reusable"}); err != nil {
		t.Fatal(err)
	}
	var rejected map[string]any
	if err := c.ReadJSON(&rejected); err != nil {
		t.Fatal(err)
	}
	if rejected["type"] != "error" || rejected["error"].(map[string]any)["code"] != "PROFILE_UNAVAILABLE" {
		t.Fatalf("ready without profile: %+v", rejected)
	}
}
