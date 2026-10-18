// Package rooms owns the mutable room lifecycle. Each Room is accessed only by
// its roomruntime loop; callers receive copied snapshots.
package rooms

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"sort"
	"sync"
	"time"

	"github.com/aepatino5112/compunube-proyecto-1/services/match-service-go/internal/roomruntime"
)

const (
	Lobby        = "LOBBY"
	Countdown    = "COUNTDOWN"
	Racing       = "RACING"
	Results      = "RESULTS"
	Closed       = "CLOSED"
	RulesVersion = "surf-mvp-1"
)

var (
	ErrNotFound = errors.New("room not found")
	ErrFull     = errors.New("room full")
	ErrState    = errors.New("invalid room state")
	ErrMember   = errors.New("not a member")
	ErrReady    = errors.New("invalid ready")
)

type Equipment struct {
	BoardID     string `json:"boardId"`
	OutfitID    string `json:"outfitId"`
	NetID       string `json:"netId"`
	HairID      string `json:"hairId"`
	CharacterID string `json:"characterId"`
}
type Appearance struct {
	SkinID      string `json:"skinId"`
	HairColorID string `json:"hairColorId"`
}
type Preparation struct {
	Revision    uint64
	DisplayName string
	Equipment   Equipment
	Appearance  Appearance
}

// Verifier runs outside the room loop. The production implementation fails
// closed until the future Player/Profile adapter can prove this preparation.
type Verifier interface {
	Verify(context.Context, string, uint64) (Preparation, error)
}
type UnavailableVerifier struct{}

func (UnavailableVerifier) Verify(context.Context, string, uint64) (Preparation, error) {
	return Preparation{}, errors.New("profile unavailable")
}

type Member struct {
	PlayerID         string     `json:"playerId"`
	DisplayName      string     `json:"displayName"`
	Connected        bool       `json:"connected"`
	Ready            bool       `json:"ready"`
	ParticipantState string     `json:"participantState"`
	ProfileRevision  uint64     `json:"profileRevision"`
	ReduceChoice     *string    `json:"reduceChoice"`
	Equipment        Equipment  `json:"equipment"`
	Appearance       Appearance `json:"appearance"`
	connectionID     string
	disconnectedAt   time.Time
}
type State struct {
	RoomID            string   `json:"roomId"`
	MapID             string   `json:"mapId"`
	Capacity          int      `json:"capacity"`
	State             string   `json:"state"`
	RulesVersion      string   `json:"rulesVersion"`
	CourseVersion     string   `json:"courseVersion"`
	RaceID            *string  `json:"raceId"`
	CountdownEndsAtMs *int64   `json:"countdownEndsAtMs"`
	Members           []Member `json:"members"`
}
type Membership struct {
	RoomID   string `json:"roomId"`
	MapID    string `json:"mapId"`
	State    string `json:"state"`
	PlayerID string `json:"playerId"`
}
type Message struct {
	Type            string `json:"type"`
	ProtocolVersion int    `json:"protocolVersion"`
	SelfPlayerID    string `json:"selfPlayerId,omitempty"`
	Room            *State `json:"room,omitempty"`
}
type Sink interface{ Send(any) bool }

type Manager struct {
	mu       sync.RWMutex
	rooms    map[string]*entry
	runtime  *roomruntime.Manager
	verifier Verifier
}
type entry struct {
	room   *room
	handle *roomruntime.Handle
}

func NewManager(runtime *roomruntime.Manager, verifier Verifier) *Manager {
	return &Manager{rooms: map[string]*entry{}, runtime: runtime, verifier: verifier}
}
func validMap(id string) bool           { return id == "maracaibo" || id == "orinoco" }
func courseVersion(mapID string) string { return mapID + "-surf-mvp-1" }
func newID(prefix string) (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return prefix + base64.RawURLEncoding.EncodeToString(b), nil
}

func (m *Manager) Create(ctx context.Context, mapID, playerID string) (Membership, error) {
	if !validMap(mapID) || playerID == "" {
		return Membership{}, ErrReady
	}
	id, err := newID("room_")
	if err != nil {
		return Membership{}, err
	}
	r := &room{id: id, mapID: mapID, state: Lobby, members: map[string]*Member{}, sinks: map[string]Sink{}}
	m.mu.Lock()
	h, err := m.runtime.Start(id, r)
	if err == nil {
		r.close = func() { h.Cancel(); m.mu.Lock(); delete(m.rooms, id); m.mu.Unlock() }
		m.rooms[id] = &entry{r, h}
	}
	m.mu.Unlock()
	if err != nil {
		return Membership{}, err
	}
	if _, err = h.Submit(ctx, join{playerID}); err != nil {
		h.Cancel()
		m.mu.Lock()
		delete(m.rooms, id)
		m.mu.Unlock()
		return Membership{}, err
	}
	return Membership{id, mapID, Lobby, playerID}, nil
}
func (m *Manager) get(id string) (*entry, error) {
	m.mu.RLock()
	e := m.rooms[id]
	m.mu.RUnlock()
	if e == nil {
		return nil, ErrNotFound
	}
	return e, nil
}
func (m *Manager) Join(ctx context.Context, id, playerID string) (Membership, error) {
	e, err := m.get(id)
	if err != nil {
		return Membership{}, err
	}
	v, err := e.handle.Submit(ctx, join{playerID})
	if err != nil {
		return Membership{}, err
	}
	s := v.(State)
	return Membership{s.RoomID, s.MapID, Lobby, playerID}, nil
}
func (m *Manager) Ready(ctx context.Context, id, playerID string, ready bool, revision uint64, choice string) error {
	e, err := m.get(id)
	if err != nil {
		return err
	}
	var prep Preparation
	if ready {
		if revision == 0 || (choice != "reusable" && choice != "disposable") {
			return ErrReady
		}
		prep, err = m.verifier.Verify(ctx, playerID, revision)
		if err != nil {
			return err
		}
		if prep.Revision != revision || prep.DisplayName == "" || prep.Equipment.BoardID == "" || prep.Equipment.OutfitID == "" || prep.Equipment.NetID == "" || prep.Equipment.HairID == "" || prep.Equipment.CharacterID == "" || prep.Appearance.SkinID == "" || prep.Appearance.HairColorID == "" {
			return ErrReady
		}
	}
	_, err = e.handle.Submit(ctx, setReady{playerID, ready, choice, prep})
	return err
}
func (m *Manager) Leave(ctx context.Context, id, playerID string) error {
	e, err := m.get(id)
	if err != nil {
		return err
	}
	_, err = e.handle.Submit(ctx, leave{playerID})
	return err
}
func (m *Manager) Bind(ctx context.Context, id, playerID, connectionID string, sink Sink) error {
	e, err := m.get(id)
	if err != nil {
		return err
	}
	_, err = e.handle.Submit(ctx, bind{playerID, connectionID, sink})
	return err
}
func (m *Manager) Disconnect(ctx context.Context, id, playerID, connectionID string) {
	e, err := m.get(id)
	if err == nil {
		_, _ = e.handle.Submit(ctx, disconnect{playerID, connectionID})
	}
}
func (m *Manager) Snapshot(ctx context.Context, id string) (State, error) {
	e, err := m.get(id)
	if err != nil {
		return State{}, err
	}
	v, err := e.handle.Submit(ctx, snapshot{})
	if err != nil {
		return State{}, err
	}
	return v.(State), nil
}

// Finish is an internal seam for F53. It never fabricates a competitive result.
func (m *Manager) Finish(ctx context.Context, id string) error {
	e, err := m.get(id)
	if err != nil {
		return err
	}
	_, err = e.handle.Submit(ctx, finish{})
	return err
}
func (m *Manager) Repeat(ctx context.Context, id string) error {
	e, err := m.get(id)
	if err != nil {
		return err
	}
	_, err = e.handle.Submit(ctx, repeat{})
	return err
}

type room struct {
	id, mapID, state string
	members          map[string]*Member
	sinks            map[string]Sink
	countdownEnd     time.Time
	raceID           string
	close            func()
}
type join struct{ playerID string }
type leave struct{ playerID string }
type bind struct {
	playerID, connectionID string
	sink                   Sink
}
type disconnect struct{ playerID, connectionID string }
type snapshot struct{}
type finish struct{}
type repeat struct{}
type setReady struct {
	playerID string
	ready    bool
	choice   string
	prep     Preparation
}

func (r *room) HandleCommand(_ context.Context, c any) (any, error) {
	switch x := c.(type) {
	case join:
		if r.state != Lobby {
			return nil, ErrState
		}
		if _, ok := r.members[x.playerID]; ok {
			return r.view(), nil
		}
		if len(r.members) >= 4 {
			return nil, ErrFull
		}
		r.members[x.playerID] = &Member{PlayerID: x.playerID, ParticipantState: "not_ready"}
		r.publish()
		return r.view(), nil
	case setReady:
		p := r.members[x.playerID]
		if p == nil {
			return nil, ErrMember
		}
		if r.state != Lobby && r.state != Countdown {
			return nil, ErrState
		}
		if r.state == Countdown && x.ready && p.Ready && p.ProfileRevision == x.prep.Revision && p.ReduceChoice != nil && *p.ReduceChoice == x.choice && p.Equipment == x.prep.Equipment && p.Appearance == x.prep.Appearance {
			return nil, nil
		}
		wasCountdown := r.state == Countdown
		if wasCountdown {
			r.state = Lobby
			r.countdownEnd = time.Time{}
		}
		if x.ready {
			p.Ready = true
			p.ParticipantState = "ready"
			p.ProfileRevision = x.prep.Revision
			p.DisplayName = x.prep.DisplayName
			p.Equipment = x.prep.Equipment
			p.Appearance = x.prep.Appearance
			p.ReduceChoice = &x.choice
		} else {
			p.Ready = false
			p.ParticipantState = "not_ready"
			p.ReduceChoice = nil
		}
		if !wasCountdown {
			r.maybeCountdown(time.Now())
		}
		r.publish()
		return nil, nil
	case leave:
		p := r.members[x.playerID]
		if p == nil {
			return nil, ErrMember
		}
		if r.state == Racing {
			p.ParticipantState = "left"
			p.Ready = false
		} else {
			delete(r.members, x.playerID)
			if r.state == Countdown {
				r.state = Lobby
				r.countdownEnd = time.Time{}
			}
		}
		if len(r.members) == 0 {
			r.state = Closed
			r.close()
		} else if r.state == Lobby {
			r.maybeCountdown(time.Now())
		}
		r.publish()
		delete(r.sinks, x.playerID)
		return nil, nil
	case bind:
		p := r.members[x.playerID]
		if p == nil {
			return nil, ErrMember
		}
		p.connectionID = x.connectionID
		p.Connected = true
		p.disconnectedAt = time.Time{}
		if p.ParticipantState == "reconnecting" {
			p.ParticipantState = "racing"
		}
		r.sinks[x.playerID] = x.sink
		r.publish()
		return nil, nil
	case disconnect:
		p := r.members[x.playerID]
		if p == nil || p.connectionID != x.connectionID {
			return nil, nil
		}
		p.Connected = false
		p.connectionID = ""
		delete(r.sinks, x.playerID)
		if r.state == Racing && p.ParticipantState == "racing" {
			p.ParticipantState = "reconnecting"
			p.disconnectedAt = time.Now()
		} else if r.state == Lobby || r.state == Countdown {
			delete(r.members, x.playerID)
			if r.state == Countdown {
				r.state = Lobby
				r.countdownEnd = time.Time{}
			}
			if len(r.members) == 0 {
				r.state = Closed
				r.close()
			} else {
				r.maybeCountdown(time.Now())
			}
		}
		r.publish()
		return nil, nil
	case snapshot:
		return r.view(), nil
	case finish:
		if r.state != Racing {
			return nil, ErrState
		}
		r.state = Results
		r.publish()
		return nil, nil
	case repeat:
		if r.state != Results {
			return nil, ErrState
		}
		r.state = Lobby
		r.raceID = ""
		for _, p := range r.members {
			p.Ready = false
			p.ParticipantState = "not_ready"
			p.ReduceChoice = nil
		}
		r.publish()
		return nil, nil
	}
	return nil, ErrState
}
func (r *room) HandleTick(_ context.Context, t roomruntime.Tick) {
	if r.state == Lobby {
		r.maybeCountdown(t.At)
		if r.state == Countdown {
			r.publish()
		}
	}
	if r.state == Countdown && !t.At.Before(r.countdownEnd) {
		id, err := newID("race_")
		if err == nil {
			r.raceID = id
			r.state = Racing
			for _, p := range r.members {
				p.ParticipantState = "racing"
			}
			r.publish()
		}
	}
	if r.state == Racing {
		changed := false
		for _, p := range r.members {
			if p.ParticipantState == "reconnecting" && !t.At.Before(p.disconnectedAt.Add(15*time.Second)) {
				p.ParticipantState = "left"
				changed = true
			}
		}
		if changed {
			r.publish()
		}
	}
}
func (r *room) maybeCountdown(now time.Time) {
	if len(r.members) < 2 {
		return
	}
	for _, p := range r.members {
		if !p.Ready {
			return
		}
	}
	r.state = Countdown
	r.countdownEnd = now.Add(3 * time.Second)
}
func (r *room) view() State {
	s := State{RoomID: r.id, MapID: r.mapID, Capacity: 4, State: r.state, RulesVersion: RulesVersion, CourseVersion: courseVersion(r.mapID), Members: make([]Member, 0, len(r.members))}
	if r.raceID != "" {
		id := r.raceID
		s.RaceID = &id
	}
	if r.state == Countdown {
		n := r.countdownEnd.UnixMilli()
		s.CountdownEndsAtMs = &n
	}
	for _, p := range r.members {
		cp := *p
		cp.connectionID = ""
		s.Members = append(s.Members, cp)
	}
	sort.Slice(s.Members, func(i, j int) bool { return s.Members[i].PlayerID < s.Members[j].PlayerID })
	return s
}
func (r *room) publish() {
	s := r.view()
	for id, sink := range r.sinks {
		if !sink.Send(Message{Type: "room.state", ProtocolVersion: 1, SelfPlayerID: id, Room: &s}) {
			delete(r.sinks, id)
		}
	}
}
