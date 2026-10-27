package race

import (
	"encoding/json"
	"math"
	"testing"
	"time"

	"github.com/aepatino5112/compunube-proyecto-1/services/match-service-go/internal/inputmailbox"
)

func testRace(t *testing.T) *Race {
	t.Helper()
	r, err := New("room", "race", "maracaibo", time.Unix(100, 0), []RosterMember{{PlayerID: "b", ReduceChoice: "disposable"}, {PlayerID: "a", ReduceChoice: "reusable"}})
	if err != nil {
		t.Fatal(err)
	}
	return r
}
func near(t *testing.T, got, want float64) {
	t.Helper()
	if math.Abs(got-want) > 1e-9 {
		t.Fatalf("got %.12f, want %.12f", got, want)
	}
}

// Released versions stay embedded byte for byte
// (apps/web/tools/generate-course-manifests.mjs --check <version>).
func TestReleasedManifestsStayUnchanged(t *testing.T) {
	for _, v := range []struct {
		version                      string
		length                       float64
		obstacles, trash, lifesavers int
		lastTrashZ                   float64
	}{{"surf-mvp-1", 900, 54, 103, 10, -856.7}, {"surf-mvp-2", 1800, 113, 211, 21, -1753.1000000000001}} {
		for _, mapID := range []string{"maracaibo", "orinoco"} {
			data, err := courseFiles.ReadFile("courses/" + mapID + "-" + v.version + ".json")
			if err != nil {
				t.Fatal(err)
			}
			var c CourseManifest
			if err := json.Unmarshal(data, &c); err != nil {
				t.Fatal(err)
			}
			if c.CourseVersion != mapID+"-"+v.version || c.LengthUnits != v.length || len(c.Obstacles) != v.obstacles || len(c.Trash) != v.trash || len(c.Lifesavers) != v.lifesavers || c.Trash[v.trash-1].Z != v.lastTrashZ {
				t.Fatalf("released manifest %s-%s changed", mapID, v.version)
			}
		}
	}
}

func TestVersionedCoursesAndWireShape(t *testing.T) {
	for _, mapID := range []string{"maracaibo", "orinoco"} {
		c, err := LoadCourse(mapID)
		if err != nil {
			t.Fatal(err)
		}
		if c.CourseVersion != mapID+"-surf-mvp-3" || c.LengthUnits != 1800 || len(c.Obstacles) != 113 || len(c.Trash) != 211 || len(c.Lifesavers) != 21 || len(c.StartSlotsX) != 4 || c.StartSlotsX[0] != -9 || c.StartSlotsX[3] != 9 {
			t.Fatalf("course %s: %+v", mapID, c)
		}
		if c.Obstacles[0].ItemID != "o-001" || c.Trash[0].ItemID != "t-001" || c.Lifesavers[0].ItemID != "l-001" || c.Trash[0].X != 5.2 || c.Trash[0].Z != -6 || c.Trash[210].Z > -1744 || c.Trash[210].Z < -1746 {
			t.Fatalf("course anchors changed: %s", mapID)
		}
		if mapID == "maracaibo" {
			near(t, c.Obstacles[0].X, -12.71764969965443)
			if c.Lifesavers[0].X != 3 {
				t.Fatal("Maracaibo life anchor")
			}
		} else {
			near(t, c.Obstacles[0].X, -11.824650708585978)
			if c.Lifesavers[0].X != -3 {
				t.Fatal("Orinoco life anchor")
			}
		}
		ids := map[string]bool{}
		for _, o := range c.Obstacles {
			if ids[o.ItemID] {
				t.Fatal("duplicate obstacle ID")
			}
			ids[o.ItemID] = true
		}
		metal, plastic := 0, 0
		for _, o := range c.Trash {
			if ids[o.ItemID] {
				t.Fatal("duplicate trash ID")
			}
			ids[o.ItemID] = true
			if o.Material == "metal" {
				metal++
			} else if o.Material == "plastic" {
				plastic++
			} else {
				t.Fatal("unknown material")
			}
		}
		if want := map[string]int{"maracaibo": 74, "orinoco": 76}[mapID]; metal != want || plastic != 211-want {
			t.Fatalf("material distribution %s: %d %d", mapID, metal, plastic)
		}
		for _, o := range c.Lifesavers {
			if ids[o.ItemID] {
				t.Fatal("duplicate lifesaver ID")
			}
			ids[o.ItemID] = true
		}
	}
	r := testRace(t)
	start := r.StartMessage()
	if start.Roster[0].PlayerID != "a" || start.Roster[0].StartSlotX != -9 || start.Roster[1].StartSlotX != -3 {
		t.Fatalf("deterministic slots: %+v", start.Roster)
	}
	s := r.Snapshot(r.StartedAt)
	data, err := json.Marshal(s)
	if err != nil {
		t.Fatal(err)
	}
	var object map[string]any
	if err := json.Unmarshal(data, &object); err != nil {
		t.Fatal(err)
	}
	players := object["players"].([]any)
	p := players[0].(map[string]any)
	for _, field := range []string{"x", "z", "speed", "steer", "netSide", "netAngle", "energy", "jumpHeight", "jumpVelocity", "lives", "lastProcessedInputSeq", "lastProcessedJumpSeq"} {
		if _, ok := p[field]; !ok {
			t.Fatalf("snapshot missing %s: %s", field, data)
		}
	}
	if len(s.Trash) != 211 || len(s.Lifesavers) != 21 || len(s.Pursuits) != 2 {
		t.Fatal("incomplete snapshot")
	}
}

func TestMovementBoostJumpAndValidation(t *testing.T) {
	r := testRace(t)
	r.Course.Obstacles = nil
	r.Course.Trash = nil
	r.Trash = nil
	r.Course.Lifesavers = nil
	r.Lifesavers = nil
	p := r.Participants["a"]
	in := inputmailbox.Input{Seq: 1, Steer: 1, NetSide: 1, JumpSeq: 1}
	for _, bad := range []inputmailbox.Input{{Seq: maxSafeInteger + 1, NetSide: 1}, {Steer: 1.01, NetSide: 1}, {Steer: math.NaN(), NetSide: 1}, {NetSide: 0}} {
		if ValidInput(bad) {
			t.Fatalf("accepted bad input: %+v", bad)
		}
	}
	if !ValidInput(in) {
		t.Fatal("valid input rejected")
	}
	events, snapshot, _ := r.Advance(r.StartedAt.Add(50*time.Millisecond), []inputmailbox.Delivery{{PlayerID: "a", Latest: &in, JumpSeq: &in.JumpSeq}})
	if len(events) != 0 || snapshot != nil {
		t.Fatal("first tick publication")
	}
	turn := 1 - math.Exp(-8*stepSeconds)
	near(t, p.Turn, turn)
	near(t, p.X, -9+turn*10*stepSeconds)
	speed := 16.4 * (1 - math.Exp(-3*stepSeconds))
	near(t, p.Speed, speed)
	near(t, p.Z, -speed*stepSeconds)
	near(t, p.JumpVelocity, 6-16*stepSeconds)
	near(t, p.JumpHeight, (6-16*stepSeconds)*stepSeconds)
	if p.LastProcessedInputSeq != 1 || p.LastProcessedJumpSeq != 1 {
		t.Fatal("sequence not processed")
	}
	jumpVelocity := p.JumpVelocity
	p.Energy = 0.5
	boost := inputmailbox.Input{Seq: 2, Steer: 1, NetSide: 1, Boost: true, JumpSeq: 1}
	_, snapshot, _ = r.Advance(r.StartedAt.Add(100*time.Millisecond), []inputmailbox.Delivery{{PlayerID: "a", Latest: &boost}})
	if snapshot == nil || snapshot.Tick != 2 || snapshot.ElapsedMs != 100 {
		t.Fatal("snapshot cadence")
	}
	near(t, p.Energy, 0.5-0.25*stepSeconds)
	if !p.Boosting || p.Speed <= speed || p.JumpVelocity >= jumpVelocity {
		t.Fatal("boost/jump did not progress")
	}
	if p.LastProcessedJumpSeq != 1 {
		t.Fatal("duplicate jump processed")
	}
}

func TestDeterministicPickupOwnershipAndEnergy(t *testing.T) {
	r := testRace(t)
	r.Course.Obstacles = nil
	for _, p := range r.Participants {
		p.X = 0
		p.Z = 0
		p.Lives = 2
	}
	r.Course.Trash = []Trash{{ItemID: "tie-trash", X: 2.05, Z: -1.4, Kind: "bottle", Material: "plastic"}}
	r.Trash = make([]PickupState, 1)
	r.Course.Lifesavers = []Lifesaver{{ItemID: "tie-life", X: 0, Z: 0}}
	r.Lifesavers = make([]PickupState, 1)
	events, _, _ := r.Advance(r.StartedAt.Add(50*time.Millisecond), nil)
	if r.Trash[0].CollectedBy != "a" || r.Lifesavers[0].CollectedBy != "a" {
		t.Fatalf("tie ownership: %+v %+v", r.Trash, r.Lifesavers)
	}
	a, b := r.Participants["a"], r.Participants["b"]
	if a.CollectedPlastic != 1 || b.CollectedPlastic != 0 || a.Lives != 3 || b.Lives != 2 {
		t.Fatalf("effects: a=%+v b=%+v", a, b)
	}
	near(t, a.Energy, 0.2)
	if len(events) != 2 || events[0].Kind != "trash.collected" || events[1].Kind != "lifesaver.collected" {
		t.Fatalf("events: %+v", events)
	}
	r.Advance(r.StartedAt.Add(100*time.Millisecond), nil)
	if a.CollectedPlastic != 1 || a.Lives != 3 {
		t.Fatal("pickup applied twice")
	}
}

func TestObstacleProtectionOctopusAndDisqualification(t *testing.T) {
	r := testRace(t)
	r.Course.Trash = nil
	r.Trash = nil
	r.Course.Lifesavers = nil
	r.Lifesavers = nil
	p := r.Participants["a"]
	r.Course.Obstacles = []Obstacle{{ItemID: "hit", X: p.X, Z: 0, Radius: 1.15}}
	r.Advance(r.StartedAt.Add(50*time.Millisecond), nil)
	if p.Lives != 2 || p.ProtectionRemaining != 2.6 || p.SlowRemaining != 1.15 {
		t.Fatalf("first hit: %+v", p)
	}
	firstSpeed := p.Speed
	r.Advance(r.StartedAt.Add(100*time.Millisecond), nil)
	if p.Lives != 2 || p.Speed >= 16.4 {
		t.Fatal("protection or slowdown failed")
	}
	near(t, p.Speed, firstSpeed+(8.2-firstSpeed)*(1-math.Exp(-3*stepSeconds)))
	if p.Speed <= firstSpeed {
		t.Fatal("speed did not recover toward half target")
	}
	p.ProtectionRemaining = 0
	p.JumpHeight = 1
	p.JumpVelocity = 0
	r.Advance(r.StartedAt.Add(150*time.Millisecond), nil)
	if p.Lives != 2 {
		t.Fatal("jump height did not avoid obstacle")
	}
	p.JumpHeight = 0
	p.ProtectionRemaining = 0
	r.Advance(r.StartedAt.Add(200*time.Millisecond), nil)
	if p.Lives != 1 {
		t.Fatalf("second hit: %d", p.Lives)
	}
	p.ProtectionRemaining = 0
	r.Advance(r.StartedAt.Add(250*time.Millisecond), nil)
	if p.Lives != 0 || p.State != "disqualified" {
		t.Fatalf("terminal damage: %+v", p)
	}
	r = testRace(t)
	r.Course.Obstacles = nil
	r.Course.Trash = nil
	r.Trash = nil
	r.Course.Lifesavers = nil
	r.Lifesavers = nil
	p = r.Participants["a"]
	r.ElapsedMs = 6000
	p.Pursuit.Gap = 3.5
	p.ProtectionRemaining = 1
	r.Advance(r.StartedAt.Add(6050*time.Millisecond), nil)
	if p.Lives != 3 || p.Pursuit.RetreatRemaining != 3 {
		t.Fatalf("protected octopus: %+v", p)
	}
	if r.Participants["b"].Lives != 3 || r.Participants["b"].Pursuit.RetreatRemaining != 0 {
		t.Fatal("octopus affected another player")
	}
	r.Advance(r.StartedAt.Add(6100*time.Millisecond), nil)
	near(t, p.Pursuit.Gap, 4.1)
	near(t, p.Pursuit.RetreatRemaining, 2.95)
	p.Pursuit.RetreatRemaining = 0
	p.Pursuit.Gap = 3.5
	p.ProtectionRemaining = 0
	r.Advance(r.StartedAt.Add(6150*time.Millisecond), nil)
	if p.Lives != 2 {
		t.Fatal("octopus failed to damage")
	}
}

func TestReentryFinishDeadlineRankingAndImmutableResult(t *testing.T) {
	r := testRace(t)
	r.Course.Obstacles = nil
	r.Course.Trash = nil
	r.Trash = nil
	r.Course.Lifesavers = nil
	r.Lifesavers = nil
	a, b := r.Participants["a"], r.Participants["b"]
	a.CollectedPlastic = 2
	a.CollectedMetal = 1
	b.CollectedPlastic = 9
	a.Z = -r.Course.LengthUnits + .01
	r.Disconnect("a", r.StartedAt)
	if a.State != "reconnecting" || a.Input.Boost {
		t.Fatal("disconnect not neutral")
	}
	r.Advance(r.StartedAt.Add(50*time.Millisecond), nil)
	if a.State != "finished" || a.FinishTimeMs == nil || *a.FinishTimeMs != 50 {
		t.Fatalf("finish during absence: %+v", a)
	}
	if state := r.Rebind("a", r.StartedAt.Add(time.Second)); state != "finished" {
		t.Fatalf("terminal rebind changed state: %s", state)
	}
	r.ElapsedMs = 44900
	_, _, early := r.Advance(r.StartedAt.Add(44950*time.Millisecond), nil)
	if early != nil || b.State != "racing" {
		t.Fatal("global deadline fired early")
	}
	r.ElapsedMs = 45000
	_, _, result := r.Advance(r.StartedAt.Add(45050*time.Millisecond), nil)
	if result == nil || b.State != "dnf" {
		t.Fatal("45s deadline did not close")
	}
	if len(result.Participants) != 2 || result.Participants[0].PlayerID != "a" || *result.Participants[0].Rank != 1 || result.Participants[0].Credited.Plastic != 2 || result.Participants[1].Rank != nil || result.Participants[1].Credited.Plastic != 0 || result.Participants[0].SettlementState != "pending" {
		t.Fatalf("result: %+v", result)
	}
	copy := result.Copy()
	copy.Participants[0].Credited.Plastic = 999
	if r.Result.Participants[0].Credited.Plastic != 2 {
		t.Fatal("result copy mutated authority")
	}
	if events, snap, again := r.Advance(r.StartedAt.Add(45100*time.Millisecond), nil); events != nil || snap != nil || again != nil {
		t.Fatal("ended race advanced")
	}
	r = testRace(t)
	r.Course.Obstacles = nil
	r.Course.Trash = nil
	r.Trash = nil
	r.Course.Lifesavers = nil
	r.Lifesavers = nil
	r.Disconnect("b", r.StartedAt)
	r.Advance(r.StartedAt.Add(15050*time.Millisecond), nil)
	if r.Participants["b"].State != "left" {
		t.Fatal("15s lease did not expire")
	}
	r.Leave("a")
	_, _, result = r.Advance(r.StartedAt.Add(15100*time.Millisecond), nil)
	if result == nil || result.Participants[0].Rank != nil || result.Participants[1].Rank != nil {
		t.Fatalf("all terminal without finish: %+v", result)
	}
}

func TestSimultaneousFinishRanksByPlayerID(t *testing.T) {
	r := testRace(t)
	r.Course.Obstacles = nil
	r.Course.Trash = nil
	r.Trash = nil
	r.Course.Lifesavers = nil
	r.Lifesavers = nil
	for _, p := range r.Participants {
		p.Z = -r.Course.LengthUnits + .01
	}
	_, _, result := r.Advance(r.StartedAt.Add(50*time.Millisecond), nil)
	if result == nil || len(result.Participants) != 2 || result.Participants[0].PlayerID != "a" || *result.Participants[0].Rank != 1 || result.Participants[1].PlayerID != "b" || *result.Participants[1].Rank != 2 {
		t.Fatalf("tied ranking: %+v", result)
	}
}

func TestFinishTimePrecedesPlayerID(t *testing.T) {
	r := testRace(t)
	r.Course.Obstacles = nil
	r.Course.Trash = nil
	r.Trash = nil
	r.Course.Lifesavers = nil
	r.Lifesavers = nil
	r.Participants["b"].Z = -r.Course.LengthUnits + .01
	r.Participants["a"].Z = -r.Course.LengthUnits + .3
	r.Advance(r.StartedAt.Add(50*time.Millisecond), nil)
	if r.Participants["b"].State != "finished" || r.Participants["a"].State == "finished" {
		t.Fatal("first finisher setup failed")
	}
	_, _, result := r.Advance(r.StartedAt.Add(100*time.Millisecond), nil)
	if result == nil || result.Participants[0].PlayerID != "b" || *result.Participants[0].Rank != 1 || result.Participants[1].PlayerID != "a" || *result.Participants[1].Rank != 2 {
		t.Fatalf("finish-time order: %+v", result)
	}
}

func TestNonFinishersNeverCreditCollectedMaterials(t *testing.T) {
	r := testRace(t)
	r.Participants["a"].State = "disqualified"
	r.Participants["a"].CollectedPlastic = 5
	r.Participants["b"].State = "left"
	r.Participants["b"].CollectedMetal = 7
	_, _, result := r.Advance(r.StartedAt.Add(50*time.Millisecond), nil)
	if result == nil {
		t.Fatal("all terminal did not close")
	}
	for _, p := range result.Participants {
		if p.Rank != nil || p.Credited.Plastic != 0 || p.Credited.Metal != 0 || p.SettlementState != "pending" {
			t.Fatalf("non-finisher credited: %+v", p)
		}
	}
}

func TestEnergyCapAndExactBoostBurn(t *testing.T) {
	r := testRace(t)
	r.Course.Obstacles = nil
	r.Course.Lifesavers = nil
	r.Lifesavers = nil
	a := r.Participants["a"]
	a.X = 0
	a.Energy = 0.9
	r.Course.Trash = []Trash{{ItemID: "one", X: 2.05, Z: -1.4, Material: "plastic"}, {ItemID: "two", X: 2.05, Z: -1.4, Material: "plastic"}}
	r.Trash = make([]PickupState, 2)
	r.Advance(r.StartedAt.Add(50*time.Millisecond), nil)
	near(t, a.Energy, 1)
	if a.CollectedPlastic != 2 {
		t.Fatal("both pickups not collected")
	}
	input := inputmailbox.Input{Seq: 1, NetSide: 1, Boost: true}
	r.Advance(r.StartedAt.Add(100*time.Millisecond), []inputmailbox.Delivery{{PlayerID: "a", Latest: &input}})
	near(t, a.Energy, 1-0.25*stepSeconds)
}

func TestTerminalDisplayOrderHasNoRank(t *testing.T) {
	r, err := New("room", "race", "orinoco", time.Unix(1, 0), []RosterMember{{PlayerID: "d", ReduceChoice: "reusable"}, {PlayerID: "c", ReduceChoice: "reusable"}, {PlayerID: "b", ReduceChoice: "reusable"}, {PlayerID: "a", ReduceChoice: "reusable"}})
	if err != nil {
		t.Fatal(err)
	}
	r.Participants["a"].State = "left"
	r.Participants["a"].Z = -800
	r.Participants["b"].State = "disqualified"
	r.Participants["b"].Z = -700
	r.Participants["c"].State = "dnf"
	r.Participants["c"].Z = -400
	r.Participants["d"].State = "dnf"
	r.Participants["d"].Z = -600
	_, _, result := r.Advance(r.StartedAt.Add(50*time.Millisecond), nil)
	want := []string{"d", "c", "b", "a"}
	if result == nil {
		t.Fatal("no result")
	}
	for i, p := range result.Participants {
		if p.PlayerID != want[i] || p.Rank != nil {
			t.Fatalf("display order/rank: %+v", result.Participants)
		}
	}
}

func TestCloserPickupCandidateWins(t *testing.T) {
	r := testRace(t)
	r.Course.Obstacles = nil
	r.Course.Lifesavers = nil
	r.Participants["a"].X = 0
	r.Participants["b"].X = 1
	r.Course.Trash = []Trash{{ItemID: "closer", X: 3.05, Z: -1.4, Material: "metal"}}
	r.Trash = make([]PickupState, 1)
	r.Advance(r.StartedAt.Add(50*time.Millisecond), nil)
	if r.Trash[0].CollectedBy != "b" || r.Participants["b"].CollectedMetal != 1 {
		t.Fatalf("distance ownership: %+v", r.Trash)
	}
}
