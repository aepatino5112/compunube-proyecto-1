package roomshttp

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/aepatino5112/compunube-proyecto-1/services/match-service-go/internal/config"
	"github.com/aepatino5112/compunube-proyecto-1/services/match-service-go/internal/identity"
	"github.com/aepatino5112/compunube-proyecto-1/services/match-service-go/internal/outbox"
	"github.com/aepatino5112/compunube-proyecto-1/services/match-service-go/internal/roomruntime"
	"github.com/aepatino5112/compunube-proyecto-1/services/match-service-go/internal/rooms"
	"github.com/aepatino5112/compunube-proyecto-1/services/match-service-go/internal/sessionhttp"
	"github.com/gorilla/websocket"
)

func setup(t *testing.T) (*httptest.Server, *identity.Registry, *API) {
	t.Helper()
	cfg, err := config.Parse(func(string) string { return "" })
	if err != nil {
		t.Fatal(err)
	}
	rt, err := roomruntime.NewManager(context.Background(), roomruntime.Options{TickInterval: 50 * time.Millisecond, QueueCapacity: cfg.RoomCommandQueueCapacity, MaxRooms: cfg.MaxActiveRooms, MaxCommandsPerTick: cfg.RoomMaxCommandsPerTick})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(rt.Close)
	ids := identity.NewRegistry()
	sessions := sessionhttp.New(ids)
	api := New(rooms.NewManager(rt, rooms.UnavailableVerifier{}), ids, sessions, cfg)
	mux := http.NewServeMux()
	sessions.Register(mux)
	api.Register(mux)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv, ids, api
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
	srv, ids, _ := setup(t)
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
	srv, ids, _ := setup(t)
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

func TestConnectionAdmissionAndRelease(t *testing.T) {
	srv, ids, api := setup(t)
	url := "ws" + strings.TrimPrefix(srv.URL, "http") + "/v1/realtime"
	d := websocket.Dialer{Subprotocols: []string{"compunube.realtime.v1"}}
	connections := make([]*websocket.Conn, 0, 20)
	for i := 0; i < 20; i++ {
		_, token, err := ids.Create(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		c, _, err := d.Dial(url, http.Header{"Authorization": []string{"Bearer " + token}})
		if err != nil {
			t.Fatal(err)
		}
		connections = append(connections, c)
	}
	defer func() {
		for _, c := range connections {
			_ = c.Close()
		}
	}()
	active, admitted, rejected := api.ConnectionStats()
	if active != 20 || admitted != 20 || rejected != 0 {
		t.Fatalf("admission: %d %d %d", active, admitted, rejected)
	}
	_, token, _ := ids.Create(context.Background())
	if c, resp, err := d.Dial(url, http.Header{"Authorization": []string{"Bearer " + token}}); err == nil {
		c.Close()
		t.Fatal("21st connection admitted")
	} else if resp == nil || resp.StatusCode != 503 {
		t.Fatalf("overflow: %v %+v", err, resp)
	}
	_ = connections[0].Close()
	deadline := time.Now().Add(time.Second)
	for {
		active, _, _ = api.ConnectionStats()
		if active == 19 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("connection slot not released")
		}
		runtime.Gosched()
	}
	c, _, err := d.Dial(url, http.Header{"Authorization": []string{"Bearer " + token}})
	if err != nil {
		t.Fatal(err)
	}
	connections = append(connections, c)
	active, admitted, rejected = api.ConnectionStats()
	if active != 20 || admitted != 21 || rejected != 1 {
		t.Fatalf("after release: %d %d %d", active, admitted, rejected)
	}
}

func TestSixthRoomRejectedWhileExistingRoomsStayAvailable(t *testing.T) {
	srv, ids, api := setup(t)
	roomIDs := make([]string, 0, 5)
	for i := 0; i < 6; i++ {
		_, token, _ := ids.Create(context.Background())
		status, result := req(t, srv.URL+"/v1/rooms", token, `{"mapId":"maracaibo"}`)
		if i < 5 {
			if status != 201 {
				t.Fatalf("room %d: %d %+v", i, status, result)
			}
			roomIDs = append(roomIDs, result["roomId"].(string))
		} else if status != 503 || result["code"] != "SERVICE_UNAVAILABLE" {
			t.Fatalf("sixth room: %d %+v", status, result)
		}
	}
	for _, id := range roomIDs {
		if _, err := api.rooms.Snapshot(context.Background(), id); err != nil {
			t.Fatalf("admitted room stopped: %v", err)
		}
	}
}

func TestRealtimeInputRateBeforeRoomCommandQueue(t *testing.T) {
	srv, ids, api := setup(t)
	api.cfg.ConnectionInputRate = 1
	_, token, _ := ids.Create(context.Background())
	url := "ws" + strings.TrimPrefix(srv.URL, "http") + "/v1/realtime"
	d := websocket.Dialer{Subprotocols: []string{"compunube.realtime.v1"}}
	c, _, err := d.Dial(url, http.Header{"Authorization": []string{"Bearer " + token}})
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	for i := 0; i < 5; i++ {
		if err := c.WriteJSON(map[string]any{"type": "race.input", "protocolVersion": 1, "raceId": "race", "seq": i, "steer": 0, "netSide": 1, "boost": false, "jumpSeq": 0}); err != nil {
			t.Fatal(err)
		}
	}
	_ = c.SetReadDeadline(time.Now().Add(time.Second))
	codes := map[string]int{}
	for i := 0; i < 5; i++ {
		var msg struct {
			Error struct {
				Code string `json:"code"`
			} `json:"error"`
		}
		if err := c.ReadJSON(&msg); err != nil {
			t.Fatal(err)
		}
		codes[msg.Error.Code]++
	}
	if codes["RACE_NOT_ACTIVE"] != 4 || codes["RATE_LIMITED"] != 1 {
		t.Fatalf("codes: %+v", codes)
	}
}

func TestCriticalOverflowClosesOnlyOneConnection(t *testing.T) {
	stopped := 0
	a := &outbound{queue: outbox.New(1, 1), stop: func() { stopped++ }}
	b := &outbound{queue: outbox.New(1, 1), stop: func() { t.Fatal("healthy connection closed") }}
	if !a.Send("first") || a.Send("overflow") {
		t.Fatal("critical overflow not detected")
	}
	if stopped != 1 {
		t.Fatalf("stops=%d", stopped)
	}
	if !b.Send("healthy") {
		t.Fatal("other connection affected")
	}
}
