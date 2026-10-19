package profilehttp

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/aepatino5112/compunube-proyecto-1/services/match-service-go/internal/identity"
	"github.com/aepatino5112/compunube-proyecto-1/services/match-service-go/internal/playerprofile"
	"github.com/aepatino5112/compunube-proyecto-1/services/match-service-go/internal/sessionhttp"
	"github.com/aepatino5112/compunube-proyecto-1/services/match-service-go/internal/workpool"
)

func setup(t *testing.T, f *playerprofile.Fake) (http.Handler, string, string, string) {
	t.Helper()
	ids := identity.NewRegistry()
	id, token, err := ids.Create(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	pool, err := workpool.New(context.Background(), 2, 8, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	sessions := sessionhttp.New(ids)
	api := New(sessions, f, pool)
	mux := http.NewServeMux()
	api.Register(mux)
	return mux, id, token, "compunube_session=" + token
}
func request(h http.Handler, method, path, body, auth string, cookie bool, origin string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, "http://example.test"+path, strings.NewReader(body))
	if cookie {
		r.Header.Set("Cookie", auth)
	} else {
		r.Header.Set("Authorization", "Bearer "+auth)
	}
	if origin != "" {
		r.Header.Set("Origin", origin)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}
func goodProfile(id string) playerprofile.Profile {
	return playerprofile.Profile{PlayerID: id, Revision: 2, Coins: 3, Plastic: 4, Metal: 5, OwnedItemIDs: []string{"board"}, Equipment: playerprofile.Equipment{BoardID: "board", OutfitID: "outfit", NetID: "net", HairID: "hair", CharacterID: "character"}, Appearance: playerprofile.Appearance{SkinID: "skin", HairColorID: "color"}}
}
func TestAllRoutesBearerAndCookieMutations(t *testing.T) {
	var id string
	calls := map[string]int{}
	check := func(k playerprofile.MutationKey) {
		if k.PlayerID != id || k.RequestID != "req" || k.CatalogVersion != "v1" {
			t.Errorf("wrong command: %+v", k)
		}
	}
	result := func() playerprofile.MutationResult {
		return playerprofile.MutationResult{RequestID: "req", Replayed: true, Profile: goodProfile(id)}
	}
	f := &playerprofile.Fake{
		GetProfileFn: func(_ context.Context, got string) (playerprofile.Profile, error) {
			if got != id {
				t.Error(got)
			}
			calls["profile"]++
			return goodProfile(id), nil
		},
		GetCatalogFn: func(_ context.Context, v string) (playerprofile.Catalog, error) {
			if v != "v1" {
				t.Error(v)
			}
			calls["catalog"]++
			return playerprofile.Catalog{Version: "v1", Items: []playerprofile.CatalogItem{{ItemID: "board", ItemType: "BOARD", Name: "Board"}}}, nil
		},
		BuyItemFn: func(_ context.Context, c playerprofile.ItemCommand) (playerprofile.MutationResult, error) {
			check(c.MutationKey)
			calls["buy"]++
			return result(), nil
		},
		CraftItemFn: func(_ context.Context, c playerprofile.ItemCommand) (playerprofile.MutationResult, error) {
			check(c.MutationKey)
			calls["craft"]++
			return result(), nil
		},
		EquipItemFn: func(_ context.Context, c playerprofile.ItemCommand) (playerprofile.MutationResult, error) {
			check(c.MutationKey)
			calls["equip"]++
			return result(), nil
		},
		ExchangeMaterialsFn: func(_ context.Context, c playerprofile.ExchangeCommand) (playerprofile.MutationResult, error) {
			check(c.MutationKey)
			if c.Material != "plastic" || c.Amount != 2 {
				t.Error(c)
			}
			calls["exchange"]++
			return result(), nil
		},
		SetAppearanceFn: func(_ context.Context, c playerprofile.AppearanceCommand) (playerprofile.MutationResult, error) {
			check(c.MutationKey)
			if c.SkinID != "skin" || c.HairColorID != "color" {
				t.Error(c)
			}
			calls["appearance"]++
			return result(), nil
		},
	}
	h, playerID, token, cookie := setup(t, f)
	id = playerID
	cases := []struct{ method, path, body, name string }{
		{"GET", "/v1/profile", "", "profile"}, {"GET", "/v1/catalog?catalogVersion=v1", "", "catalog"},
		{"POST", "/v1/profile/purchases", `{"requestId":"req","catalogVersion":"v1","itemId":"board"}`, "buy"},
		{"POST", "/v1/profile/crafts", `{"requestId":"req","catalogVersion":"v1","itemId":"board"}`, "craft"},
		{"POST", "/v1/profile/equipment", `{"requestId":"req","catalogVersion":"v1","itemId":"board"}`, "equip"},
		{"POST", "/v1/profile/exchanges", `{"requestId":"req","catalogVersion":"v1","material":"plastic","amount":2}`, "exchange"},
		{"PUT", "/v1/profile/appearance", `{"requestId":"req","catalogVersion":"v1","skinId":"skin","hairColorId":"color"}`, "appearance"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			w := request(h, tc.method, tc.path, tc.body, token, false, "")
			if w.Code != 200 {
				t.Fatalf("bearer %d %s", w.Code, w.Body.String())
			}
			if tc.name == "profile" {
				var p profile
				if err := json.Unmarshal(w.Body.Bytes(), &p); err != nil || p.PlayerID != id || p.ProfileRevision != 2 || p.Equipment.BoardID != "board" || p.Appearance.SkinID != "skin" || len(p.OwnedItemIDs) != 1 {
					t.Fatalf("profile DTO: %s %v", w.Body.String(), err)
				}
			}
			if tc.name == "catalog" {
				var c catalog
				if err := json.Unmarshal(w.Body.Bytes(), &c); err != nil || c.CatalogVersion != "v1" || len(c.Items) != 1 || c.Items[0].ItemType != "board" || c.SkinTones == nil || c.HairColors == nil {
					t.Fatalf("catalog DTO: %s %v", w.Body.String(), err)
				}
			}
			if tc.body == "" {
				return
			}
			var m struct {
				RequestID string         `json:"requestId"`
				Replayed  bool           `json:"replayed"`
				Profile   map[string]any `json:"profile"`
			}
			if err := json.Unmarshal(w.Body.Bytes(), &m); err != nil || m.RequestID != "req" || !m.Replayed || m.Profile["playerId"] != id {
				t.Fatalf("result %s %v", w.Body.String(), err)
			}
			w = request(h, tc.method, tc.path, tc.body, cookie, true, "http://example.test")
			if w.Code != 200 {
				t.Fatalf("cookie %d %s", w.Code, w.Body.String())
			}
			for _, origin := range []string{"", "http://evil.test"} {
				w = request(h, tc.method, tc.path, tc.body, cookie, true, origin)
				if w.Code != 401 || !strings.Contains(w.Body.String(), "SESSION_REQUIRED") {
					t.Fatalf("origin %q: %d %s", origin, w.Code, w.Body.String())
				}
			}
		})
	}
	for _, tc := range cases {
		if calls[tc.name] == 0 {
			t.Fatal(tc.name)
		}
	}
}
func TestStrictBodiesAndErrorMapping(t *testing.T) {
	var id string
	var outcome error
	f := &playerprofile.Fake{BuyItemFn: func(_ context.Context, c playerprofile.ItemCommand) (playerprofile.MutationResult, error) {
		if c.PlayerID != id {
			t.Error(c)
		}
		return playerprofile.MutationResult{}, outcome
	}, GetProfileFn: func(context.Context, string) (playerprofile.Profile, error) { return playerprofile.Profile{}, outcome }, GetCatalogFn: func(context.Context, string) (playerprofile.Catalog, error) { return playerprofile.Catalog{}, outcome }}
	h, playerID, token, _ := setup(t, f)
	id = playerID
	for _, body := range []string{`{"requestId":"req","catalogVersion":"v1","itemId":"x","playerId":"evil"}`, `{"requestId":"req","catalogVersion":"v1","itemId":"x","extra":1}`, `{"requestId":"req",`, `{"requestId":"","catalogVersion":"v1","itemId":"x"}`} {
		w := request(h, "POST", "/v1/profile/purchases", body, token, false, "")
		if w.Code != 400 {
			t.Fatalf("body %s: %d", body, w.Code)
		}
	}
	body := `{"requestId":"req","catalogVersion":"v1","itemId":"x"}`
	cases := []struct {
		fault  *playerprofile.Fault
		status int
		code   string
	}{
		{&playerprofile.Fault{Kind: playerprofile.Business, Code: "IDEMPOTENCY_CONFLICT"}, 409, "IDEMPOTENCY_CONFLICT"},
		{&playerprofile.Fault{Kind: playerprofile.Business, Code: "INSUFFICIENT_COINS"}, 422, "INSUFFICIENT_COINS"},
		{&playerprofile.Fault{Kind: playerprofile.Unavailable}, 503, "PROFILE_UNAVAILABLE"},
		{&playerprofile.Fault{Kind: playerprofile.Deadline}, 504, "MUTATION_OUTCOME_UNKNOWN"},
	}
	for _, tc := range cases {
		outcome = tc.fault
		w := request(h, "POST", "/v1/profile/purchases", body, token, false, "")
		if w.Code != tc.status || !strings.Contains(w.Body.String(), tc.code) {
			t.Fatalf("%+v => %d %s", tc.fault, w.Code, w.Body.String())
		}
		if tc.status == 504 && (!strings.Contains(w.Body.String(), `"requestId":"req"`) || strings.Contains(w.Body.String(), "profile")) {
			t.Fatal(w.Body.String())
		}
	}
	outcome = &playerprofile.Fault{Kind: playerprofile.Unavailable}
	w := request(h, "GET", "/v1/profile", "", token, false, "")
	if w.Code != 503 {
		t.Fatal(w.Code)
	}
	outcome = &playerprofile.Fault{Kind: playerprofile.Business, Code: "INVALID_CATALOG_VERSION"}
	w = request(h, "GET", "/v1/catalog?catalogVersion=bad", "", token, false, "")
	if w.Code != 422 {
		t.Fatalf("catalog: %d %s", w.Code, w.Body.String())
	}
	outcome = &playerprofile.Fault{Kind: playerprofile.Business, Code: "NOT_FOUND"}
	w = request(h, "GET", "/v1/catalog?catalogVersion=bad", "", token, false, "")
	if w.Code != 422 || !strings.Contains(w.Body.String(), "INVALID_CATALOG_VERSION") {
		t.Fatalf("catalog not found: %d %s", w.Code, w.Body.String())
	}
	r := httptest.NewRequest("GET", "http://example.test/v1/catalog", nil)
	r.URL.RawQuery = "catalogVersion=%ZZ"
	r.Header.Set("Authorization", "Bearer "+token)
	w = httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 400 {
		t.Fatalf("malformed query: %d %s", w.Code, w.Body.String())
	}
}

func TestAuthAndOpenCircuit(t *testing.T) {
	ids := identity.NewRegistry()
	id, token, err := ids.Create(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	pool, err := workpool.New(context.Background(), 1, 8, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	calls := 0
	upstream := &playerprofile.Fake{GetProfileFn: func(context.Context, string) (playerprofile.Profile, error) {
		calls++
		return playerprofile.Profile{}, &playerprofile.Fault{Kind: playerprofile.Unavailable}
	}}
	port, err := playerprofile.NewResilient(upstream, playerprofile.ResilienceOptions{FailureThreshold: 1, OpenDuration: time.Hour, HalfOpenProbes: 1, ReadMaxRetries: 0, RetryBase: time.Millisecond, RetryCap: time.Millisecond})
	if err != nil {
		t.Fatal(err)
	}
	sessions := sessionhttp.New(ids)
	mux := http.NewServeMux()
	New(sessions, port, pool).Register(mux)
	routes := []struct{ method, path, body string }{{"GET", "/v1/profile", ""}, {"GET", "/v1/catalog", ""}, {"POST", "/v1/profile/purchases", `{"requestId":"r","catalogVersion":"v","itemId":"x"}`}, {"POST", "/v1/profile/crafts", `{"requestId":"r","catalogVersion":"v","itemId":"x"}`}, {"POST", "/v1/profile/exchanges", `{"requestId":"r","catalogVersion":"v","material":"metal","amount":1}`}, {"POST", "/v1/profile/equipment", `{"requestId":"r","catalogVersion":"v","itemId":"x"}`}, {"PUT", "/v1/profile/appearance", `{"requestId":"r","catalogVersion":"v","skinId":"s","hairColorId":"h"}`}}
	for _, tc := range routes {
		r := httptest.NewRequest(tc.method, "http://example.test"+tc.path, strings.NewReader(tc.body))
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, r)
		if w.Code != 401 || !strings.Contains(w.Body.String(), "SESSION_REQUIRED") {
			t.Fatalf("%s %s: %d %s", tc.method, tc.path, w.Code, w.Body.String())
		}
	}
	for i := 0; i < 2; i++ {
		w := request(mux, "GET", "/v1/profile", "", token, false, "")
		if w.Code != 503 || !strings.Contains(w.Body.String(), "PROFILE_UNAVAILABLE") {
			t.Fatalf("open: %d %s", w.Code, w.Body.String())
		}
	}
	if calls != 1 || port.Stats().FastRejects != 1 {
		t.Fatalf("open emitted RPC: calls=%d stats=%+v player=%s", calls, port.Stats(), id)
	}
}
