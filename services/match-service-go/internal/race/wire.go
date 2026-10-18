package race

import (
	"math"
	"sort"
	"time"

	"github.com/aepatino5112/compunube-proyecto-1/services/match-service-go/internal/outbox"
)

// Domain events are translated to E43 envelopes at the publication boundary.
type RaceEvent struct {
	Kind, EventID, RaceID, PlayerID, ItemID, Detail string
	Tick                                            uint64
	Lives                                           int
	FinishTimeMs                                    int64
}
type StartMember struct {
	PlayerID     string         `json:"playerId"`
	StartSlotX   float64        `json:"startSlotX"`
	Equipment    EquipmentWire  `json:"equipment"`
	Appearance   AppearanceWire `json:"appearance"`
	ReduceChoice string         `json:"reduceChoice"`
}
type EquipmentWire struct {
	BoardID     string `json:"boardId"`
	OutfitID    string `json:"outfitId"`
	NetID       string `json:"netId"`
	HairID      string `json:"hairId"`
	CharacterID string `json:"characterId"`
}
type AppearanceWire struct {
	SkinID      string `json:"skinId"`
	HairColorID string `json:"hairColorId"`
}
type StartMessage struct {
	Type            string         `json:"type"`
	ProtocolVersion int            `json:"protocolVersion"`
	RoomID          string         `json:"roomId"`
	RaceID          string         `json:"raceId"`
	ServerTimeMs    int64          `json:"serverTimeMs"`
	StartedAtMs     int64          `json:"startedAtMs"`
	RulesVersion    string         `json:"rulesVersion"`
	Course          CourseManifest `json:"course"`
	Roster          []StartMember  `json:"roster"`
}

func (StartMessage) RealtimeClass() outbox.Kind { return outbox.Critical }
func (r *Race) StartMessage() StartMessage {
	roster := make([]StartMember, 0, len(r.Roster))
	for i, m := range r.Roster {
		roster = append(roster, StartMember{PlayerID: m.PlayerID, StartSlotX: r.Course.StartSlotsX[i], Equipment: EquipmentWire{m.Equipment.BoardID, m.Equipment.OutfitID, m.Equipment.NetID, m.Equipment.HairID, m.Equipment.CharacterID}, Appearance: AppearanceWire{m.Appearance.SkinID, m.Appearance.HairColorID}, ReduceChoice: m.ReduceChoice})
	}
	return StartMessage{Type: "race.start", ProtocolVersion: 1, RoomID: r.RoomID, RaceID: r.ID, ServerTimeMs: r.StartedAt.UnixMilli(), StartedAtMs: r.StartedAt.UnixMilli(), RulesVersion: r.RulesVersion, Course: r.Course, Roster: roster}
}

type PlayerSnapshot struct {
	PlayerID              string  `json:"playerId"`
	ParticipantState      string  `json:"participantState"`
	X                     float64 `json:"x"`
	Z                     float64 `json:"z"`
	Speed                 float64 `json:"speed"`
	Steer                 float64 `json:"steer"`
	NetSide               int     `json:"netSide"`
	NetAngle              float64 `json:"netAngle"`
	Energy                float64 `json:"energy"`
	Boosting              bool    `json:"boosting"`
	JumpHeight            float64 `json:"jumpHeight"`
	JumpVelocity          float64 `json:"jumpVelocity"`
	Lives                 int     `json:"lives"`
	ProtectionRemainingMs int64   `json:"protectionRemainingMs"`
	CollectedPlastic      int     `json:"collectedPlastic"`
	CollectedMetal        int     `json:"collectedMetal"`
	FinishTimeMs          *int64  `json:"finishTimeMs"`
	LastProcessedInputSeq uint64  `json:"lastProcessedInputSeq"`
	LastProcessedJumpSeq  uint64  `json:"lastProcessedJumpSeq"`
}
type PickupOwnership struct {
	ItemID      string  `json:"itemId"`
	CollectedBy *string `json:"collectedBy"`
}
type PursuitSnapshot struct {
	TargetPlayerID     string  `json:"targetPlayerId"`
	Gap                float64 `json:"gap"`
	RetreatRemainingMs int64   `json:"retreatRemainingMs"`
}
type RaceSnapshot struct {
	RaceID       string            `json:"raceId"`
	Tick         uint64            `json:"tick"`
	ServerTimeMs int64             `json:"serverTimeMs"`
	ElapsedMs    int64             `json:"elapsedMs"`
	Players      []PlayerSnapshot  `json:"players"`
	Trash        []PickupOwnership `json:"trash"`
	Lifesavers   []PickupOwnership `json:"lifesavers"`
	Pursuits     []PursuitSnapshot `json:"pursuits"`
}
type SnapshotMessage struct {
	Type            string       `json:"type"`
	ProtocolVersion int          `json:"protocolVersion"`
	Snapshot        RaceSnapshot `json:"snapshot"`
}

func (SnapshotMessage) RealtimeClass() outbox.Kind { return outbox.Snapshot }
func (r *Race) Snapshot(at time.Time) RaceSnapshot {
	s := RaceSnapshot{RaceID: r.ID, Tick: r.Tick, ServerTimeMs: at.UnixMilli(), ElapsedMs: r.ElapsedMs, Players: make([]PlayerSnapshot, 0, len(r.Order)), Trash: make([]PickupOwnership, len(r.Trash)), Lifesavers: make([]PickupOwnership, len(r.Lifesavers)), Pursuits: make([]PursuitSnapshot, 0, len(r.Order))}
	for _, id := range r.Order {
		p := r.Participants[id]
		s.Players = append(s.Players, PlayerSnapshot{PlayerID: id, ParticipantState: p.State, X: p.X, Z: p.Z, Speed: p.Speed, Steer: p.Turn, NetSide: p.Input.NetSide, NetAngle: p.NetAngle, Energy: p.Energy, Boosting: p.Boosting, JumpHeight: p.JumpHeight, JumpVelocity: p.JumpVelocity, Lives: p.Lives, ProtectionRemainingMs: int64(math.Round(p.ProtectionRemaining * 1000)), CollectedPlastic: p.CollectedPlastic, CollectedMetal: p.CollectedMetal, FinishTimeMs: p.FinishTimeMs, LastProcessedInputSeq: p.LastProcessedInputSeq, LastProcessedJumpSeq: p.LastProcessedJumpSeq})
		s.Pursuits = append(s.Pursuits, PursuitSnapshot{TargetPlayerID: id, Gap: p.Pursuit.Gap, RetreatRemainingMs: int64(math.Round(p.Pursuit.RetreatRemaining * 1000))})
	}
	for i, p := range r.Trash {
		s.Trash[i] = PickupOwnership{ItemID: r.Course.Trash[i].ItemID, CollectedBy: ownerPointer(p.CollectedBy)}
	}
	for i, p := range r.Lifesavers {
		s.Lifesavers[i] = PickupOwnership{ItemID: r.Course.Lifesavers[i].ItemID, CollectedBy: ownerPointer(p.CollectedBy)}
	}
	return s
}
func ownerPointer(id string) *string {
	if id == "" {
		return nil
	}
	copy := id
	return &copy
}

type EventMessage struct {
	Type            string         `json:"type"`
	ProtocolVersion int            `json:"protocolVersion"`
	Event           map[string]any `json:"event"`
}

func (EventMessage) RealtimeClass() outbox.Kind { return outbox.Event }
func WireEvent(e RaceEvent) EventMessage {
	v := map[string]any{"eventId": e.EventID, "raceId": e.RaceID, "tick": e.Tick, "kind": e.Kind, "playerId": e.PlayerID}
	switch e.Kind {
	case "trash.collected":
		v["itemId"] = e.ItemID
		v["material"] = e.Detail
	case "lifesaver.collected":
		v["itemId"] = e.ItemID
		v["lives"] = e.Lives
	case "player.hit":
		v["cause"] = e.Detail
		v["lives"] = e.Lives
	case "player.finished":
		v["finishTimeMs"] = e.FinishTimeMs
	}
	return EventMessage{Type: "race.event", ProtocolVersion: 1, Event: v}
}

type MaterialCounts struct {
	Plastic int `json:"plastic"`
	Metal   int `json:"metal"`
}
type ParticipantResult struct {
	PlayerID        string         `json:"playerId"`
	Outcome         string         `json:"outcome"`
	Rank            *int           `json:"rank"`
	FinishTimeMs    *int64         `json:"finishTimeMs"`
	Collected       MaterialCounts `json:"collected"`
	Credited        MaterialCounts `json:"credited"`
	ReduceChoice    string         `json:"reduceChoice"`
	SettlementState string         `json:"settlementState"`
}
type RaceResult struct {
	RaceID        string              `json:"raceId"`
	RoomID        string              `json:"roomId"`
	RulesVersion  string              `json:"rulesVersion"`
	CourseVersion string              `json:"courseVersion"`
	EndedAtMs     int64               `json:"endedAtMs"`
	Participants  []ParticipantResult `json:"participants"`
}

func (r RaceResult) Copy() RaceResult {
	copy := r
	copy.Participants = append([]ParticipantResult(nil), r.Participants...)
	for i := range copy.Participants {
		if v := copy.Participants[i].Rank; v != nil {
			n := *v
			copy.Participants[i].Rank = &n
		}
		if v := copy.Participants[i].FinishTimeMs; v != nil {
			n := *v
			copy.Participants[i].FinishTimeMs = &n
		}
	}
	return copy
}

type EndedMessage struct {
	Type            string     `json:"type"`
	ProtocolVersion int        `json:"protocolVersion"`
	Result          RaceResult `json:"result"`
}

func (EndedMessage) RealtimeClass() outbox.Kind { return outbox.Critical }
func (r *Race) buildResult(at time.Time) RaceResult {
	order := append([]string(nil), r.Order...)
	category := func(state string) int {
		switch state {
		case "finished":
			return 0
		case "dnf":
			return 1
		case "disqualified":
			return 2
		default:
			return 3
		}
	}
	sort.Slice(order, func(i, j int) bool {
		a, b := r.Participants[order[i]], r.Participants[order[j]]
		ca, cb := category(a.State), category(b.State)
		if ca != cb {
			return ca < cb
		}
		if ca == 0 {
			if *a.FinishTimeMs != *b.FinishTimeMs {
				return *a.FinishTimeMs < *b.FinishTimeMs
			}
		} else if a.Z != b.Z {
			return a.Z < b.Z
		}
		return a.PlayerID < b.PlayerID
	})
	result := RaceResult{RaceID: r.ID, RoomID: r.RoomID, RulesVersion: r.RulesVersion, CourseVersion: r.Course.CourseVersion, EndedAtMs: at.UnixMilli(), Participants: make([]ParticipantResult, 0, len(order))}
	rank := 0
	for _, id := range order {
		p := r.Participants[id]
		entry := ParticipantResult{PlayerID: id, Outcome: p.State, FinishTimeMs: p.FinishTimeMs, Collected: MaterialCounts{p.CollectedPlastic, p.CollectedMetal}, ReduceChoice: p.ReduceChoice, SettlementState: "pending"}
		if p.State == "finished" {
			rank++
			value := rank
			entry.Rank = &value
			entry.Credited = entry.Collected
		}
		result.Participants = append(result.Participants, entry)
	}
	return result
}
