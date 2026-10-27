// Package race is the deterministic, single-writer surf-mvp simulation (see RulesVersion).
// RoomLoop owns every Race; only the synchronized input mailbox is shared with
// WebSocket readers.
package race

import (
	"errors"
	"math"
	"sort"
	"time"

	"github.com/aepatino5112/compunube-proyecto-1/services/match-service-go/internal/inputmailbox"
)

const stepSeconds = 0.05
const maxSafeInteger = 9007199254740991

type Equipment struct{ BoardID, OutfitID, NetID, HairID, CharacterID string }
type Appearance struct{ SkinID, HairColorID string }
type RosterMember struct {
	PlayerID     string
	Equipment    Equipment
	Appearance   Appearance
	ReduceChoice string
}
type InputState struct {
	Steer   float64
	NetSide int
	Boost   bool
}
type Pursuit struct{ Gap, RetreatRemaining float64 }
type RaceParticipant struct {
	PlayerID                                                      string
	State                                                         string
	X, Z, Speed, Turn, NetAngle, Energy, JumpHeight, JumpVelocity float64
	Input                                                         InputState
	Boosting                                                      bool
	Lives                                                         int
	ProtectionRemaining, SlowRemaining                            float64
	CollectedPlastic, CollectedMetal                              int
	FinishTimeMs                                                  *int64
	LastProcessedInputSeq, LastProcessedJumpSeq                   uint64
	Pursuit                                                       Pursuit
	DisconnectedAt                                                time.Time
	ReduceChoice                                                  string
	oldBoard, oldNet                                              Point
}
type PickupState struct{ CollectedBy string }
type Race struct {
	ID, RoomID, RulesVersion string
	Course                   CourseManifest
	Roster                   []RosterMember
	Participants             map[string]*RaceParticipant
	Order                    []string
	Trash                    []PickupState
	Lifesavers               []PickupState
	StartedAt                time.Time
	Tick                     uint64
	ElapsedMs                int64
	firstFinishMs            *int64
	Result                   *RaceResult
	events                   []RaceEvent
}

func New(roomID, raceID, mapID string, startedAt time.Time, roster []RosterMember) (*Race, error) {
	if roomID == "" || raceID == "" || len(roster) < 2 || len(roster) > 4 {
		return nil, errors.New("invalid race roster")
	}
	course, err := LoadCourse(mapID)
	if err != nil {
		return nil, err
	}
	members := append([]RosterMember(nil), roster...)
	sort.Slice(members, func(i, j int) bool { return members[i].PlayerID < members[j].PlayerID })
	r := &Race{ID: raceID, RoomID: roomID, RulesVersion: RulesVersion, Course: course, Roster: members, Participants: map[string]*RaceParticipant{}, Trash: make([]PickupState, len(course.Trash)), Lifesavers: make([]PickupState, len(course.Lifesavers)), StartedAt: startedAt}
	for i, m := range members {
		if m.PlayerID == "" || m.ReduceChoice != "reusable" && m.ReduceChoice != "disposable" {
			return nil, errors.New("invalid race member")
		}
		if i > 0 && members[i-1].PlayerID == m.PlayerID {
			return nil, errors.New("duplicate race member")
		}
		p := &RaceParticipant{PlayerID: m.PlayerID, State: "racing", X: course.StartSlotsX[i], NetAngle: 0, Input: InputState{NetSide: 1}, Lives: 3, Pursuit: Pursuit{Gap: 48}, ReduceChoice: m.ReduceChoice}
		r.Participants[m.PlayerID] = p
		r.Order = append(r.Order, m.PlayerID)
	}
	return r, nil
}

func ValidInput(in inputmailbox.Input) bool {
	return in.Seq <= maxSafeInteger && in.JumpSeq <= maxSafeInteger && !math.IsNaN(in.Steer) && !math.IsInf(in.Steer, 0) && in.Steer >= -1 && in.Steer <= 1 && (in.NetSide == -1 || in.NetSide == 1)
}
func (r *Race) Disconnect(id string, at time.Time) {
	p := r.Participants[id]
	if p != nil && p.State == "racing" {
		p.State = "reconnecting"
		p.DisconnectedAt = at
		p.Input = InputState{NetSide: p.Input.NetSide}
	}
}
func (r *Race) Rebind(id string, at time.Time) string {
	p := r.Participants[id]
	if p == nil {
		return ""
	}
	if p.State == "reconnecting" {
		if at.Sub(p.DisconnectedAt) <= 15*time.Second {
			p.State = "racing"
			p.DisconnectedAt = time.Time{}
		} else {
			r.markLeft(p)
		}
	}
	return p.State
}
func (r *Race) Leave(id string) {
	if p := r.Participants[id]; p != nil && (p.State == "racing" || p.State == "reconnecting") {
		r.markLeft(p)
	}
}
func (r *Race) markLeft(p *RaceParticipant) {
	p.State = "left"
	p.Input = InputState{NetSide: p.Input.NetSide}
	r.addEvent("player.left", p.PlayerID, "", "", 0, 0)
}
func (r *Race) State(id string) string {
	if p := r.Participants[id]; p != nil {
		return p.State
	}
	return ""
}

// Advance consumes at most one jump edge/player, then executes B16's fixed
// phase order. The caller publishes returned events, snapshot and result.
func (r *Race) Advance(at time.Time, deliveries []inputmailbox.Delivery) ([]RaceEvent, *RaceSnapshot, *RaceResult) {
	if r.Result != nil {
		return nil, nil, nil
	}
	r.Tick++
	r.ElapsedMs += 50
	for _, d := range deliveries {
		p := r.Participants[d.PlayerID]
		if p == nil || p.State != "racing" {
			continue
		}
		if d.Latest != nil {
			p.Input = InputState{Steer: d.Latest.Steer, NetSide: d.Latest.NetSide, Boost: d.Latest.Boost}
			p.LastProcessedInputSeq = d.Latest.Seq
		}
		if d.JumpSeq != nil && *d.JumpSeq > p.LastProcessedJumpSeq {
			p.LastProcessedJumpSeq = *d.JumpSeq
			if p.JumpHeight == 0 && p.JumpVelocity == 0 {
				p.JumpVelocity = 6
			}
		}
	}
	for _, id := range r.Order {
		p := r.Participants[id]
		if !active(p) {
			continue
		}
		r.move(p)
	}
	for _, id := range r.Order {
		p := r.Participants[id]
		if !active(p) {
			continue
		}
		for _, o := range r.Course.Obstacles {
			if math.Abs(o.Z-p.Z) < o.Radius+0.70 && math.Abs(o.X-p.X) < o.Radius+0.45 && p.JumpHeight < 0.75 {
				if r.hit(p, "obstacle") {
					break
				}
			}
		}
	}
	r.collectTrash()
	r.collectLifesavers()
	for _, id := range r.Order {
		p := r.Participants[id]
		if !active(p) {
			continue
		}
		r.advancePursuit(p)
	}
	for _, id := range r.Order {
		p := r.Participants[id]
		if !active(p) {
			continue
		}
		if p.Z <= -r.Course.LengthUnits {
			p.Z = -r.Course.LengthUnits
			p.State = "finished"
			p.Boosting = false
			finish := r.ElapsedMs
			p.FinishTimeMs = &finish
			r.addEvent("player.finished", id, "", "", 0, finish)
			if r.firstFinishMs == nil {
				deadline := finish + 45000
				r.firstFinishMs = &deadline
			}
		}
	}
	for _, id := range r.Order {
		p := r.Participants[id]
		if p.State == "reconnecting" && !p.DisconnectedAt.IsZero() && !at.Before(p.DisconnectedAt.Add(15*time.Second)) {
			r.markLeft(p)
		}
	}
	if r.firstFinishMs != nil && r.ElapsedMs >= *r.firstFinishMs {
		for _, id := range r.Order {
			p := r.Participants[id]
			if active(p) {
				p.State = "dnf"
				r.addEvent("player.dnf", id, "", "", 0, 0)
			}
		}
	}
	allTerminal := true
	for _, id := range r.Order {
		if active(r.Participants[id]) {
			allTerminal = false
			break
		}
	}
	if allTerminal {
		result := r.buildResult(at)
		r.Result = &result
	}
	events := append([]RaceEvent(nil), r.events...)
	for i := range events {
		events[i].EventID = r.ID + ":" + itoa(r.Tick) + ":" + itoa(uint64(i+1))
		events[i].RaceID = r.ID
		events[i].Tick = r.Tick
	}
	r.events = nil
	var snapshot *RaceSnapshot
	if r.Tick%2 == 0 {
		s := r.Snapshot(at)
		snapshot = &s
	}
	if r.Result != nil {
		copy := r.Result.Copy()
		return events, snapshot, &copy
	}
	return events, snapshot, nil
}

func active(p *RaceParticipant) bool           { return p.State == "racing" || p.State == "reconnecting" }
func clamp(v, min, max float64) float64        { return math.Max(min, math.Min(max, v)) }
func approach(v, target, rate float64) float64 { return v + (target-v)*(1-math.Exp(-rate*stepSeconds)) }
func netContact(p *RaceParticipant) Point {
	angle := p.NetAngle - p.Turn*0.2
	return Point{X: p.X + 2.05*math.Cos(angle) - 1.4*math.Sin(angle), Z: p.Z - 2.05*math.Sin(angle) - 1.4*math.Cos(angle)}
}
func (r *Race) move(p *RaceParticipant) {
	p.oldBoard = Point{p.X, p.Z}
	p.oldNet = netContact(p)
	if p.ProtectionRemaining > 0 {
		p.ProtectionRemaining = math.Max(0, p.ProtectionRemaining-stepSeconds)
	}
	neutral := p.State == "reconnecting"
	intent := p.Input
	if neutral {
		intent = InputState{NetSide: p.Input.NetSide}
	}
	p.Turn = approach(p.Turn, intent.Steer, 8)
	p.X = clamp(p.X+p.Turn*10*stepSeconds, -15, 15)
	targetAngle := 0.0
	if intent.NetSide < 0 {
		targetAngle = 2 * math.Atan2(2.05, 1.4)
	}
	p.NetAngle = approach(p.NetAngle, targetAngle, 8)
	p.Boosting = intent.Boost && p.Energy > 0
	if p.Boosting {
		p.Energy = math.Max(0, p.Energy-0.25*stepSeconds)
	}
	targetSpeed := 16.4
	if p.Boosting {
		targetSpeed *= 1.40
	}
	if p.SlowRemaining > 0 {
		targetSpeed *= 0.5
		p.SlowRemaining = math.Max(0, p.SlowRemaining-stepSeconds)
	}
	p.Speed = approach(p.Speed, targetSpeed, 3)
	p.Z -= p.Speed * stepSeconds
	if p.JumpVelocity != 0 || p.JumpHeight > 0 {
		p.JumpVelocity -= 16 * stepSeconds
		p.JumpHeight = math.Max(0, p.JumpHeight+p.JumpVelocity*stepSeconds)
		if p.JumpHeight == 0 {
			p.JumpVelocity = 0
		}
	}
}
func (r *Race) hit(p *RaceParticipant, cause string) bool {
	if p.ProtectionRemaining > 0 || !active(p) {
		return false
	}
	p.Lives--
	p.Speed *= 0.45
	p.SlowRemaining = 1.15
	p.ProtectionRemaining = 2.6
	r.addEvent("player.hit", p.PlayerID, "", cause, p.Lives, 0)
	if p.Lives <= 0 {
		p.Lives = 0
		p.State = "disqualified"
		r.addEvent("player.disqualified", p.PlayerID, "", "", 0, 0)
	}
	return true
}
func (r *Race) advancePursuit(p *RaceParticipant) {
	if r.ElapsedMs < 6000 {
		return
	}
	if p.Pursuit.RetreatRemaining > 0 {
		d := math.Min(stepSeconds, p.Pursuit.RetreatRemaining)
		p.Pursuit.Gap = math.Min(64, p.Pursuit.Gap+12*d)
		p.Pursuit.RetreatRemaining = math.Max(0, p.Pursuit.RetreatRemaining-stepSeconds)
		return
	}
	p.Pursuit.Gap = clamp(p.Pursuit.Gap+(p.Speed-17.2)*stepSeconds, 3.5, 64)
	if p.Pursuit.Gap <= 3.5 {
		p.Pursuit.RetreatRemaining = 3
		r.hit(p, "octopus")
	}
}
func segmentDistanceSquared(start, end, point Point) float64 {
	dx, dz := end.X-start.X, end.Z-start.Z
	length := dx*dx + dz*dz
	t := 0.0
	if length > 0 {
		t = clamp(((point.X-start.X)*dx+(point.Z-start.Z)*dz)/length, 0, 1)
	}
	x, z := start.X+dx*t, start.Z+dz*t
	return (point.X-x)*(point.X-x) + (point.Z-z)*(point.Z-z)
}
func (r *Race) winner(point Point, radius float64, net bool) string {
	winner := ""
	best := math.Inf(1)
	for _, id := range r.Order {
		p := r.Participants[id]
		if !active(p) {
			continue
		}
		if net && p.JumpHeight > 0.45 {
			continue
		}
		if !net && (p.JumpHeight >= 0.55 || p.Lives >= 3) {
			continue
		}
		start, end := p.oldBoard, Point{p.X, p.Z}
		if net {
			start, end = p.oldNet, netContact(p)
		}
		d := segmentDistanceSquared(start, end, point)
		if d <= radius*radius && (d < best || (d == best && (winner == "" || id < winner))) {
			best = d
			winner = id
		}
	}
	return winner
}
func (r *Race) collectTrash() {
	for i, item := range r.Course.Trash {
		if r.Trash[i].CollectedBy != "" {
			continue
		}
		owner := r.winner(Point{item.X, item.Z}, 1.25, true)
		if owner == "" {
			continue
		}
		r.Trash[i].CollectedBy = owner
		p := r.Participants[owner]
		if item.Material == "metal" {
			p.CollectedMetal++
		} else {
			p.CollectedPlastic++
		}
		p.Energy = math.Min(1, p.Energy+0.20)
		r.addEvent("trash.collected", owner, item.ItemID, item.Material, 0, 0)
	}
}
func (r *Race) collectLifesavers() {
	for i, item := range r.Course.Lifesavers {
		if r.Lifesavers[i].CollectedBy != "" {
			continue
		}
		owner := r.winner(Point{item.X, item.Z}, 1.70, false)
		if owner == "" {
			continue
		}
		r.Lifesavers[i].CollectedBy = owner
		p := r.Participants[owner]
		p.Lives++
		if p.Lives > 3 {
			p.Lives = 3
		}
		r.addEvent("lifesaver.collected", owner, item.ItemID, "", p.Lives, 0)
	}
}
func (r *Race) addEvent(kind, playerID, itemID, detail string, lives int, finishMs int64) {
	r.events = append(r.events, RaceEvent{Kind: kind, PlayerID: playerID, ItemID: itemID, Detail: detail, Lives: lives, FinishTimeMs: finishMs})
}
func itoa(v uint64) string {
	if v == 0 {
		return "0"
	}
	var b [20]byte
	i := len(b)
	for v > 0 {
		i--
		b[i] = byte('0' + v%10)
		v /= 10
	}
	return string(b[i:])
}
