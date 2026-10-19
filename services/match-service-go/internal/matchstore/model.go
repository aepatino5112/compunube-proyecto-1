// Package matchstore owns only PostgreSQL match.* data. Race state stays in Go.
package matchstore

import (
	"context"
	"errors"
	"time"

	"github.com/aepatino5112/compunube-proyecto-1/services/match-service-go/internal/race"
)

var ErrConflict = errors.New("immutable match result conflict")

type Record struct {
	RoomID          string
	MapID           string
	CreatedAt       time.Time
	ClosedAt        *time.Time
	RaceID          string
	RulesVersion    string
	CourseVersion   string
	StartedAt       time.Time
	FirstFinishedAt *time.Time
	Result          *race.RaceResult
}

// Repository is the storage boundary used by the asynchronous recorder and
// later by the settlement coordinator. Save is idempotent and atomic.
type Repository interface {
	Save(context.Context, Record) error
	Due(context.Context, time.Time, int) ([]Delivery, error)
}

type Delivery struct {
	RoomID, RaceID, PlayerID, Outcome string
	CreditedPlastic, CreditedMetal    int64
	AttemptCount                      int
	State                             string
	NextAttemptAt                     *time.Time
}

func CopyRecord(in Record) Record {
	out := in
	if in.ClosedAt != nil {
		t := *in.ClosedAt
		out.ClosedAt = &t
	}
	if in.FirstFinishedAt != nil {
		t := *in.FirstFinishedAt
		out.FirstFinishedAt = &t
	}
	if in.Result != nil {
		r := in.Result.Copy()
		out.Result = &r
	}
	return out
}

func Validate(in Record) error {
	if in.RoomID == "" || in.MapID == "" || in.CreatedAt.IsZero() {
		return errors.New("invalid room record")
	}
	if in.RaceID == "" {
		if in.Result != nil {
			return errors.New("result without race")
		}
		return nil
	}
	if in.RulesVersion == "" || in.CourseVersion == "" || in.StartedAt.IsZero() {
		return errors.New("invalid race record")
	}
	if in.Result == nil {
		return nil
	}
	if in.Result.RaceID != in.RaceID || in.Result.RoomID != in.RoomID || in.Result.RulesVersion != in.RulesVersion || in.Result.CourseVersion != in.CourseVersion || len(in.Result.Participants) < 2 || len(in.Result.Participants) > 4 {
		return errors.New("invalid race result")
	}
	seen := map[string]bool{}
	ranks := map[int]bool{}
	for _, p := range in.Result.Participants {
		if p.PlayerID == "" || seen[p.PlayerID] || p.Collected.Plastic < 0 || p.Collected.Metal < 0 || p.Credited.Plastic < 0 || p.Credited.Metal < 0 || p.Credited.Plastic > p.Collected.Plastic || p.Credited.Metal > p.Collected.Metal || (p.ReduceChoice != "reusable" && p.ReduceChoice != "disposable") {
			return errors.New("invalid participant")
		}
		seen[p.PlayerID] = true
		switch p.Outcome {
		case "finished":
			if p.Rank == nil || p.FinishTimeMs == nil || *p.Rank <= 0 || *p.FinishTimeMs < 0 || ranks[*p.Rank] || p.Credited != p.Collected {
				return errors.New("invalid finished participant")
			}
			ranks[*p.Rank] = true
		case "disqualified", "left", "dnf":
			if p.Rank != nil || p.FinishTimeMs != nil || p.Credited.Plastic != 0 || p.Credited.Metal != 0 {
				return errors.New("invalid non-finisher")
			}
		default:
			return errors.New("invalid outcome")
		}
	}
	return nil
}
