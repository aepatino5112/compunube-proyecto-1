package race

import (
	"embed"
	"encoding/json"
	"fmt"
)

//go:embed courses/*.json
var courseFiles embed.FS

// RulesVersion is the ruleset Go simulates. surf-mvp-2 doubled the course of
// surf-mvp-1 (900 -> 1800) with the same spacing between objects; surf-mvp-3
// keeps that course and lays the trash out in sections (forks, tridents and
// coves) instead of one line the leader could sweep. Older manifests stay
// embedded unchanged as released versions.
const (
	RulesVersion   = "surf-mvp-3"
	courseLength   = 1800
	obstacleCount  = 113
	trashCount     = 211
	lifesaverCount = 21
)

func CourseVersion(mapID string) string { return mapID + "-" + RulesVersion }

type Point struct {
	X float64 `json:"x"`
	Z float64 `json:"z"`
}
type Obstacle struct {
	ItemID string  `json:"itemId"`
	X      float64 `json:"x"`
	Z      float64 `json:"z"`
	Radius float64 `json:"radius"`
}
type Trash struct {
	ItemID   string  `json:"itemId"`
	X        float64 `json:"x"`
	Z        float64 `json:"z"`
	Kind     string  `json:"kind"`
	Material string  `json:"material"`
	Rotation float64 `json:"rotation"`
	Phase    float64 `json:"phase"`
}
type Lifesaver struct {
	ItemID string  `json:"itemId"`
	X      float64 `json:"x"`
	Z      float64 `json:"z"`
}
type CourseManifest struct {
	MapID             string      `json:"mapId"`
	CourseVersion     string      `json:"courseVersion"`
	LengthUnits       float64     `json:"lengthUnits"`
	LateralLimitUnits float64     `json:"lateralLimitUnits"`
	StartSlotsX       []float64   `json:"startSlotsX"`
	Obstacles         []Obstacle  `json:"obstacles"`
	Trash             []Trash     `json:"trash"`
	Lifesavers        []Lifesaver `json:"lifesavers"`
}

// LoadCourse returns a private copy: a race never depends on mutable frontend
// generation or on the seed after the versioned manifest is fixed.
func LoadCourse(mapID string) (CourseManifest, error) {
	if mapID != "maracaibo" && mapID != "orinoco" {
		return CourseManifest{}, fmt.Errorf("unknown map")
	}
	data, err := courseFiles.ReadFile("courses/" + CourseVersion(mapID) + ".json")
	if err != nil {
		return CourseManifest{}, err
	}
	var c CourseManifest
	if err := json.Unmarshal(data, &c); err != nil {
		return CourseManifest{}, err
	}
	if c.MapID != mapID || c.CourseVersion != CourseVersion(mapID) || c.LengthUnits != courseLength || c.LateralLimitUnits != 15 || len(c.StartSlotsX) != 4 || len(c.Obstacles) != obstacleCount || len(c.Trash) != trashCount || len(c.Lifesavers) != lifesaverCount {
		return CourseManifest{}, fmt.Errorf("invalid course manifest")
	}
	return c, nil
}
