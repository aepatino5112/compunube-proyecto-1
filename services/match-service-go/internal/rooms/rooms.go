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
	"sync/atomic"
	"time"

	"github.com/aepatino5112/compunube-proyecto-1/services/match-service-go/internal/inputmailbox"
	"github.com/aepatino5112/compunube-proyecto-1/services/match-service-go/internal/race"
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
	ErrNotFound      = errors.New("room not found")
	ErrFull          = errors.New("room full")
	ErrState         = errors.New("invalid room state")
	ErrMember        = errors.New("not a member")
	ErrReady         = errors.New("invalid ready")
	ErrRaceNotActive = errors.New("race not active")
	ErrInvalidInput  = errors.New("invalid race input")
	ErrRateLimited   = errors.New("input mailbox full")
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
	departed         bool
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
	mu                    sync.RWMutex
	rooms                 map[string]*entry
	runtime               *roomruntime.Manager
	verifier              Verifier
	inputSlots, jumpEdges int
}
type inputGateway struct {
	raceID  string
	roster  map[string]struct{}
	mailbox *inputmailbox.Mailbox
}
type entry struct {
	room   *room
	handle *roomruntime.Handle
}

type Options struct{ InputSlots, JumpEdges int }

func NewManager(runtime *roomruntime.Manager, verifier Verifier, options ...Options) *Manager {
	opts := Options{InputSlots: 4, JumpEdges: 4}
	if len(options) > 0 {
		opts = options[0]
	}
	if opts.InputSlots <= 0 || opts.JumpEdges <= 0 {
		panic("invalid room input options")
	}
	return &Manager{rooms: map[string]*entry{}, runtime: runtime, verifier: verifier, inputSlots: opts.InputSlots, jumpEdges: opts.JumpEdges}
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
	r := &room{id: id, mapID: mapID, state: Lobby, members: map[string]*Member{}, sinks: map[string]Sink{}, inputSlots: m.inputSlots, jumpEdges: m.jumpEdges}
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
		if errors.Is(err, roomruntime.ErrClosed) {
			return Membership{}, ErrNotFound
		}
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
		if revision == 0 || revision > 9007199254740991 || (choice != "reusable" && choice != "disposable") {
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

// Input validates immutable race admission data before the bounded mailbox.
// It does not occupy a room command slot or write race state from the reader.
func (m *Manager) Input(id, playerID, raceID string, in inputmailbox.Input) error {
	e, err := m.get(id)
	if err != nil {
		return err
	}
	select {
	case <-e.handle.Done():
		return ErrRaceNotActive
	default:
	}
	g := e.room.gateway.Load()
	if g == nil || g.raceID != raceID {
		return ErrRaceNotActive
	}
	if _, ok := g.roster[playerID]; !ok {
		return ErrMember
	}
	if !race.ValidInput(in) {
		return ErrInvalidInput
	}
	if err := g.mailbox.Offer(playerID, in); err != nil {
		if errors.Is(err, inputmailbox.ErrJumpFull) || errors.Is(err, inputmailbox.ErrFull) {
			return ErrRateLimited
		}
		return ErrInvalidInput
	}
	return nil
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
	id, mapID, state      string
	members               map[string]*Member
	sinks                 map[string]Sink
	countdownEnd          time.Time
	raceID                string
	close                 func()
	race                  *race.Race
	gateway               atomic.Pointer[inputGateway]
	inputSlots, jumpEdges int
}
type join struct{ playerID string }
type leave struct{ playerID string }
type bind struct {
	playerID, connectionID string
	sink                   Sink
}
type disconnect struct{ playerID, connectionID string }
type snapshot struct{}
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
			if r.race != nil {
				r.race.Leave(x.playerID)
				p.ParticipantState = r.race.State(x.playerID)
			}
			p.Ready = false
			p.departed = true
			p.Connected = false
			p.connectionID = ""
			r.neutral(x.playerID)
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
		if previous := r.sinks[x.playerID]; previous != nil {
			if closer, ok := previous.(interface{ Close() }); ok {
				closer.Close()
			}
		}
		p.connectionID = x.connectionID
		p.Connected = true
		p.disconnectedAt = time.Time{}
		if r.state == Racing && r.race != nil {
			p.ParticipantState = r.race.Rebind(x.playerID, time.Now())
		}
		r.sinks[x.playerID] = x.sink
		r.publish()
		if r.state == Racing && r.race != nil {
			x.sink.Send(race.SnapshotMessage{Type: "race.snapshot", ProtocolVersion: 1, Snapshot: r.race.Snapshot(time.Now())})
		}
		if r.state == Results && r.race != nil && r.race.Result != nil {
			x.sink.Send(race.EndedMessage{Type: "race.ended", ProtocolVersion: 1, Result: r.race.Result.Copy()})
		}
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
			if r.race != nil {
				r.race.Disconnect(x.playerID, p.disconnectedAt)
			}
			r.neutral(x.playerID)
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
	case repeat:
		if r.state != Results {
			return nil, ErrState
		}
		r.state = Lobby
		r.raceID = ""
		r.race = nil
		r.gateway.Store(nil)
		for id, p := range r.members {
			if p.departed {
				delete(r.members, id)
				delete(r.sinks, id)
				continue
			}
			p.Ready = false
			p.ParticipantState = "not_ready"
			p.ReduceChoice = nil
		}
		if len(r.members) == 0 {
			r.state = Closed
			r.close()
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
		if err != nil {
			return
		}
		members := r.view().Members
		roster := make([]race.RosterMember, 0, len(members))
		admitted := make(map[string]struct{}, len(members))
		for _, p := range members {
			if p.ReduceChoice == nil {
				return
			}
			roster = append(roster, race.RosterMember{PlayerID: p.PlayerID, Equipment: race.Equipment{BoardID: p.Equipment.BoardID, OutfitID: p.Equipment.OutfitID, NetID: p.Equipment.NetID, HairID: p.Equipment.HairID, CharacterID: p.Equipment.CharacterID}, Appearance: race.Appearance{SkinID: p.Appearance.SkinID, HairColorID: p.Appearance.HairColorID}, ReduceChoice: *p.ReduceChoice})
			admitted[p.PlayerID] = struct{}{}
		}
		engine, err := race.New(r.id, id, r.mapID, t.At, roster)
		if err != nil {
			return
		}
		r.race = engine
		r.raceID = id
		r.state = Racing
		for _, p := range r.members {
			p.ParticipantState = "racing"
		}
		r.gateway.Store(&inputGateway{raceID: id, roster: admitted, mailbox: inputmailbox.New(r.inputSlots, r.jumpEdges)})
		r.publish()
		start := engine.StartMessage()
		for _, sink := range r.sinks {
			sink.Send(start)
		}
		return
	}
	if r.state == Racing && r.race != nil {
		g := r.gateway.Load()
		if g == nil {
			return
		}
		events, snapshot, result := r.race.Advance(t.At, g.mailbox.Drain())
		changed := false
		for id, p := range r.members {
			state := r.race.State(id)
			if state != "" && state != p.ParticipantState {
				p.ParticipantState = state
				changed = true
				if state == "left" {
					p.departed = true
				}
			}
		}
		if changed {
			r.publish()
		}
		for _, e := range events {
			message := race.WireEvent(e)
			for _, sink := range r.sinks {
				sink.Send(message)
			}
		}
		if snapshot != nil {
			message := race.SnapshotMessage{Type: "race.snapshot", ProtocolVersion: 1, Snapshot: *snapshot}
			for _, sink := range r.sinks {
				sink.Send(message)
			}
		}
		if result != nil {
			r.gateway.Store(nil)
			r.state = Results
			r.publish()
			message := race.EndedMessage{Type: "race.ended", ProtocolVersion: 1, Result: *result}
			for _, sink := range r.sinks {
				sink.Send(message)
			}
			remaining := false
			for _, p := range r.members {
				if !p.departed {
					remaining = true
					break
				}
			}
			if !remaining {
				r.state = Closed
				r.publish()
				r.close()
			}
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
func (r *room) neutral(id string) {
	g := r.gateway.Load()
	if g == nil || r.race == nil {
		return
	}
	p := r.race.Participants[id]
	if p == nil {
		return
	}
	g.mailbox.Neutral(id, p.LastProcessedInputSeq, p.LastProcessedJumpSeq)
}
