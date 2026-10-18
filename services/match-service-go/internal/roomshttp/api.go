package roomshttp

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"sync"
	"time"

	"github.com/aepatino5112/compunube-proyecto-1/services/match-service-go/internal/config"
	"github.com/aepatino5112/compunube-proyecto-1/services/match-service-go/internal/identity"
	"github.com/aepatino5112/compunube-proyecto-1/services/match-service-go/internal/outbox"
	"github.com/aepatino5112/compunube-proyecto-1/services/match-service-go/internal/ratelimit"
	"github.com/aepatino5112/compunube-proyecto-1/services/match-service-go/internal/rooms"
	"github.com/aepatino5112/compunube-proyecto-1/services/match-service-go/internal/sessionhttp"
	"github.com/gorilla/websocket"
)

type API struct {
	rooms              *rooms.Manager
	identities         *identity.Registry
	sessions           *sessionhttp.API
	cfg                config.Config
	mu                 sync.Mutex
	connections        int
	admitted, rejected uint64
}

func New(r *rooms.Manager, i *identity.Registry, s *sessionhttp.API, cfg config.Config) *API {
	return &API{rooms: r, identities: i, sessions: s, cfg: cfg}
}
func (a *API) admit() bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.connections >= a.cfg.MaxConnections {
		a.rejected++
		return false
	}
	a.connections++
	a.admitted++
	return true
}
func (a *API) release() { a.mu.Lock(); a.connections--; a.mu.Unlock() }
func (a *API) ConnectionStats() (active int, admitted, rejected uint64) {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.connections, a.admitted, a.rejected
}
func (a *API) Register(mux *http.ServeMux) {
	mux.Handle("POST /v1/rooms", a.sessions.Require(http.HandlerFunc(a.create)))
	mux.Handle("POST /v1/rooms/{roomId}/memberships", a.sessions.Require(http.HandlerFunc(a.join)))
	mux.HandleFunc("GET /v1/realtime", a.realtime)
}
func decode(r *http.Request, v any) error {
	if r.URL.RawQuery != "" {
		return errors.New("query not allowed")
	}
	d := json.NewDecoder(io.LimitReader(r.Body, 2048))
	d.DisallowUnknownFields()
	if err := d.Decode(v); err != nil {
		return err
	}
	var extra any
	if err := d.Decode(&extra); err != io.EOF {
		return errors.New("extra JSON")
	}
	return nil
}
func write(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func fail(w http.ResponseWriter, status int, code string) {
	write(w, status, struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	}{code, code})
}
func (a *API) create(w http.ResponseWriter, r *http.Request) {
	var body struct {
		MapID string `json:"mapId"`
	}
	if err := decode(r, &body); err != nil {
		fail(w, 400, "INVALID_REQUEST")
		return
	}
	if body.MapID != "maracaibo" && body.MapID != "orinoco" {
		fail(w, 422, "INVALID_ACTION")
		return
	}
	id, _ := sessionhttp.PlayerID(r.Context())
	if p, ok := a.identities.Snapshot(r.Context(), id); ok && p.RoomID != "" {
		fail(w, 409, "INVALID_STATE")
		return
	}
	v, err := a.rooms.Create(r.Context(), body.MapID, id)
	if err != nil {
		fail(w, 503, "SERVICE_UNAVAILABLE")
		return
	}
	_ = a.identities.SetRoom(r.Context(), id, v.RoomID)
	write(w, 201, v)
}
func (a *API) join(w http.ResponseWriter, r *http.Request) {
	if r.URL.RawQuery != "" || r.ContentLength > 0 {
		fail(w, 400, "INVALID_REQUEST")
		return
	}
	id, _ := sessionhttp.PlayerID(r.Context())
	if p, ok := a.identities.Snapshot(r.Context(), id); ok && p.RoomID != "" && p.RoomID != r.PathValue("roomId") {
		fail(w, 409, "INVALID_STATE")
		return
	}
	v, err := a.rooms.Join(r.Context(), r.PathValue("roomId"), id)
	if err != nil {
		switch {
		case errors.Is(err, rooms.ErrNotFound):
			fail(w, 404, "ROOM_NOT_FOUND")
		case errors.Is(err, rooms.ErrFull):
			fail(w, 409, "ROOM_FULL")
		default:
			fail(w, 409, "INVALID_STATE")
		}
		return
	}
	_ = a.identities.SetRoom(r.Context(), id, v.RoomID)
	write(w, 200, v)
}

type outbound struct {
	queue *outbox.Queue
	stop  func()
	once  sync.Once
}

func (o *outbound) Send(v any) bool {
	kind := outbox.Critical
	if classified, ok := v.(interface{ RealtimeClass() outbox.Kind }); ok {
		kind = classified.RealtimeClass()
	}
	if !o.queue.Push(kind, v) {
		o.once.Do(o.stop)
		return false
	}
	return true
}

type wire struct {
	Type            string   `json:"type"`
	ProtocolVersion int      `json:"protocolVersion"`
	RoomID          string   `json:"roomId"`
	Ready           *bool    `json:"ready"`
	ProfileRevision *uint64  `json:"profileRevision"`
	ReduceChoice    string   `json:"reduceChoice"`
	RaceID          string   `json:"raceId"`
	Seq             *uint64  `json:"seq"`
	Steer           *float64 `json:"steer"`
	NetSide         *int     `json:"netSide"`
	Boost           *bool    `json:"boost"`
	JumpSeq         *uint64  `json:"jumpSeq"`
}

func errorMessage(code, related string) any {
	return map[string]any{"type": "error", "protocolVersion": 1, "error": map[string]any{"code": code, "message": code, "relatedType": related, "fatal": false}}
}
func (a *API) realtime(w http.ResponseWriter, r *http.Request) {
	id, ok := a.sessions.AuthenticateUpgrade(r)
	if !ok {
		fail(w, 401, "SESSION_REQUIRED")
		return
	}
	protocolOK := false
	for _, candidate := range websocket.Subprotocols(r) {
		if candidate == "compunube.realtime.v1" {
			protocolOK = true
		}
	}
	if !protocolOK {
		fail(w, 400, "INCOMPATIBLE_VERSION")
		return
	}
	p, ok := a.identities.Snapshot(r.Context(), id)
	if !ok {
		fail(w, 401, "SESSION_REQUIRED")
		return
	}
	if !a.admit() {
		fail(w, 503, "SERVICE_UNAVAILABLE")
		return
	}
	defer a.release()
	u := websocket.Upgrader{Subprotocols: []string{"compunube.realtime.v1"}, CheckOrigin: func(*http.Request) bool { return true }}
	c, err := u.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer c.Close()
	c.SetReadLimit(4096)
	bound, err := a.identities.Bind(r.Context(), id)
	if err != nil {
		return
	}
	roomID := p.RoomID
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	out := &outbound{queue: outbox.New(a.cfg.ConnectionCriticalQueue, a.cfg.ConnectionEventQueue), stop: func() { cancel(); _ = c.Close() }}
	if roomID != "" {
		if err = a.rooms.Bind(ctx, roomID, id, bound.ConnectionID, out); err != nil {
			roomID = ""
		}
	}
	writerDone := make(chan struct{})
	go func() {
		defer close(writerDone)
		for {
			v, ok := out.queue.Next(ctx)
			if !ok {
				return
			}
			_ = c.SetWriteDeadline(time.Now().Add(5 * time.Second))
			if err := c.WriteJSON(v); err != nil {
				return
			}
		}
	}()
	defer func() {
		cancel()
		out.queue.Close()
		_ = c.Close()
		<-writerDone
		changed, _ := a.identities.Disconnect(context.Background(), id, bound.ConnectionID)
		if changed && roomID != "" {
			cleanup, cancel := context.WithTimeout(context.Background(), time.Second)
			defer cancel()
			a.rooms.Disconnect(cleanup, roomID, id, bound.ConnectionID)
			state, err := a.rooms.Snapshot(cleanup, roomID)
			member := false
			if err == nil {
				for _, p := range state.Members {
					if p.PlayerID == id {
						member = true
						break
					}
				}
			}
			if !member {
				_ = a.identities.SetRoom(cleanup, id, "")
			}
		}
	}()
	rate := ratelimit.New(a.cfg.ConnectionInputRate, a.cfg.ConnectionInputBurst)
	var lastRateError time.Time
	for {
		var msg wire
		_, payload, err := c.ReadMessage()
		if err != nil {
			return
		}
		decoder := json.NewDecoder(bytes.NewReader(payload))
		decoder.DisallowUnknownFields()
		if err = decoder.Decode(&msg); err != nil {
			out.Send(errorMessage("INVALID_MESSAGE", ""))
			continue
		}
		var extra any
		if err = decoder.Decode(&extra); err != io.EOF {
			out.Send(errorMessage("INVALID_MESSAGE", msg.Type))
			continue
		}
		current, ok := a.identities.Snapshot(ctx, id)
		if !ok || current.ConnectionID != bound.ConnectionID {
			return
		}
		if msg.ProtocolVersion != 1 {
			out.Send(errorMessage("INCOMPATIBLE_VERSION", msg.Type))
			return
		}
		if msg.Type == "race.input" {
			now := time.Now()
			if !rate.Allow(now) {
				if now.Sub(lastRateError) >= 100*time.Millisecond {
					out.Send(errorMessage("RATE_LIMITED", msg.Type))
					lastRateError = now
				}
				continue
			}
			out.Send(errorMessage("RACE_NOT_ACTIVE", msg.Type))
			continue
		}
		if msg.RoomID == "" || msg.RoomID != roomID {
			out.Send(errorMessage("NOT_A_MEMBER", msg.Type))
			continue
		}
		switch msg.Type {
		case "room.ready":
			if msg.Ready == nil {
				out.Send(errorMessage("INVALID_MESSAGE", msg.Type))
				continue
			}
			rev := uint64(0)
			if msg.ProfileRevision != nil {
				rev = *msg.ProfileRevision
			}
			err = a.rooms.Ready(ctx, roomID, id, *msg.Ready, rev, msg.ReduceChoice)
			if err != nil {
				code := "INVALID_READY"
				if errors.Is(err, rooms.ErrState) {
					code = "INVALID_STATE"
				} else if !errors.Is(err, rooms.ErrReady) {
					code = "PROFILE_UNAVAILABLE"
				}
				out.Send(errorMessage(code, msg.Type))
			}
		case "room.leave":
			err = a.rooms.Leave(ctx, roomID, id)
			if err != nil {
				out.Send(errorMessage("INVALID_STATE", msg.Type))
			} else {
				_ = a.identities.SetRoom(ctx, id, "")
				roomID = ""
			}
		default:
			out.Send(errorMessage("INVALID_MESSAGE", msg.Type))
		}
	}
}
