// Package profilehttp implements the E45 public Profile/Economy boundary.
package profilehttp

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync/atomic"
	"unicode/utf8"

	"github.com/aepatino5112/compunube-proyecto-1/services/match-service-go/internal/playerprofile"
	"github.com/aepatino5112/compunube-proyecto-1/services/match-service-go/internal/sessionhttp"
	"github.com/aepatino5112/compunube-proyecto-1/services/match-service-go/internal/workpool"
)

const maxSafeCount uint64 = 9007199254740991

type API struct {
	sessions *sessionhttp.API
	port     playerprofile.Port
	pool     *workpool.Pool
}

func New(sessions *sessionhttp.API, port playerprofile.Port, pool *workpool.Pool) *API {
	return &API{sessions, port, pool}
}
func (a *API) Register(mux *http.ServeMux) {
	mux.Handle("GET /v1/profile", a.sessions.Require(http.HandlerFunc(a.profile)))
	mux.Handle("GET /v1/catalog", a.sessions.Require(http.HandlerFunc(a.catalog)))
	mux.Handle("POST /v1/profile/purchases", a.sessions.Require(http.HandlerFunc(a.item("buy"))))
	mux.Handle("POST /v1/profile/crafts", a.sessions.Require(http.HandlerFunc(a.item("craft"))))
	mux.Handle("POST /v1/profile/exchanges", a.sessions.Require(http.HandlerFunc(a.exchange)))
	mux.Handle("POST /v1/profile/equipment", a.sessions.Require(http.HandlerFunc(a.item("equip"))))
	mux.Handle("PUT /v1/profile/appearance", a.sessions.Require(http.HandlerFunc(a.appearance)))
}
func write(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func fail(w http.ResponseWriter, status int, code, requestID string) {
	v := struct {
		Code      string `json:"code"`
		Message   string `json:"message"`
		RequestID string `json:"requestId,omitempty"`
	}{code, code, requestID}
	write(w, status, v)
}
func validID(v string) bool {
	if len(v) < 1 || len(v) > 128 || !utf8.ValidString(v) {
		return false
	}
	for _, r := range v {
		if r < 32 || r == 127 {
			return false
		}
	}
	return true
}
func decode(w http.ResponseWriter, r *http.Request, v any) error {
	if r.URL.RawQuery != "" {
		return errors.New("query not allowed")
	}
	r.Body = http.MaxBytesReader(w, r.Body, 2048)
	d := json.NewDecoder(r.Body)
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
func run[T any](ctx context.Context, pool *workpool.Pool, fn func(context.Context) (T, error)) (T, error, bool) {
	var result T
	var zero T
	var started atomic.Bool
	done, err := pool.Submit(ctx, func(jobCtx context.Context) error {
		started.Store(true)
		var callErr error
		result, callErr = fn(jobCtx)
		return callErr
	})
	if err != nil {
		return zero, err, false
	}
	select {
	case err = <-done:
		return result, err, started.Load()
	case <-ctx.Done():
		return zero, ctx.Err(), started.Load()
	}
}
func (a *API) profile(w http.ResponseWriter, r *http.Request) {
	if r.URL.RawQuery != "" {
		fail(w, 400, "INVALID_REQUEST", "")
		return
	}
	id, _ := sessionhttp.PlayerID(r.Context())
	p, err, _ := run(r.Context(), a.pool, func(ctx context.Context) (playerprofile.Profile, error) { return a.port.GetProfile(ctx, id) })
	if err != nil {
		a.error(w, err, false, "")
		return
	}
	if p.PlayerID != id || !validProfile(p) {
		fail(w, 503, "PROFILE_UNAVAILABLE", "")
		return
	}
	write(w, 200, profileDTO(p))
}
func (a *API) catalog(w http.ResponseWriter, r *http.Request) {
	q, queryErr := url.ParseQuery(r.URL.RawQuery)
	if queryErr != nil || len(q) > 1 || (len(q) == 1 && !q.Has("catalogVersion")) || len(q["catalogVersion"]) > 1 || (q.Has("catalogVersion") && !validID(q.Get("catalogVersion"))) {
		fail(w, 400, "INVALID_REQUEST", "")
		return
	}
	version := q.Get("catalogVersion")
	c, err, _ := run(r.Context(), a.pool, func(ctx context.Context) (playerprofile.Catalog, error) { return a.port.GetCatalog(ctx, version) })
	if err != nil {
		var f *playerprofile.Fault
		if version != "" && errors.As(err, &f) && f.Kind == playerprofile.Business && f.Code == "NOT_FOUND" {
			fail(w, 422, "INVALID_CATALOG_VERSION", "")
			return
		}
		a.error(w, err, false, "")
		return
	}
	if !validCatalog(c) || (version != "" && c.Version != version) {
		fail(w, 503, "PROFILE_UNAVAILABLE", "")
		return
	}
	write(w, 200, catalogDTO(c))
}

// A started mutable call with a deadline has an uncertain outcome until a replay
// with the same requestId confirms it. No HTTP handler chooses a replacement key.
func (a *API) error(w http.ResponseWriter, err error, mutation bool, requestID string) {
	var f *playerprofile.Fault
	if errors.As(err, &f) && f.Kind == playerprofile.Business {
		switch f.Code {
		case "IDEMPOTENCY_CONFLICT":
			fail(w, 409, f.Code, requestID)
			return
		case "INVALID_ACTION", "INVALID_ITEM", "INSUFFICIENT_COINS", "INSUFFICIENT_MATERIALS", "NOT_OWNED", "ALREADY_OWNED", "INVALID_APPEARANCE", "INVALID_CATALOG_VERSION":
			fail(w, 422, f.Code, requestID)
			return
		case "INVALID_ARGUMENT":
			fail(w, 400, "INVALID_REQUEST", requestID)
			return
		}
	}
	if mutation && (errors.Is(err, context.DeadlineExceeded) || (errors.As(err, &f) && f.Kind == playerprofile.Deadline)) {
		fail(w, 504, "MUTATION_OUTCOME_UNKNOWN", requestID)
		return
	}
	fail(w, 503, "PROFILE_UNAVAILABLE", requestID)
}

type key struct {
	RequestID      string `json:"requestId"`
	CatalogVersion string `json:"catalogVersion"`
}
type itemRequest struct {
	key
	ItemID string `json:"itemId"`
}
type exchangeRequest struct {
	key
	Material string `json:"material"`
	Amount   uint64 `json:"amount"`
}
type appearanceRequest struct {
	key
	SkinID      string `json:"skinId"`
	HairColorID string `json:"hairColorId"`
}

func validKey(k key) bool { return validID(k.RequestID) && validID(k.CatalogVersion) }
func (a *API) mutate(w http.ResponseWriter, r *http.Request, k key, fn func(context.Context, playerprofile.MutationKey) (playerprofile.MutationResult, error)) {
	id, _ := sessionhttp.PlayerID(r.Context())
	mk := playerprofile.MutationKey{PlayerID: id, RequestID: k.RequestID, CatalogVersion: k.CatalogVersion}
	m, err, started := run(r.Context(), a.pool, func(ctx context.Context) (playerprofile.MutationResult, error) { return fn(ctx, mk) })
	if err != nil {
		if !started && errors.Is(err, context.DeadlineExceeded) {
			fail(w, 503, "PROFILE_UNAVAILABLE", k.RequestID)
			return
		}
		a.error(w, err, started, k.RequestID)
		return
	}
	if m.RequestID != k.RequestID || m.Profile.PlayerID != id || !validProfile(m.Profile) {
		fail(w, 503, "PROFILE_UNAVAILABLE", k.RequestID)
		return
	}
	write(w, 200, struct {
		RequestID string `json:"requestId"`
		Replayed  bool   `json:"replayed"`
		Profile   any    `json:"profile"`
	}{m.RequestID, m.Replayed, profileDTO(m.Profile)})
}
func (a *API) item(kind string) func(http.ResponseWriter, *http.Request) {
	return func(w http.ResponseWriter, r *http.Request) {
		var body itemRequest
		if decode(w, r, &body) != nil || !validKey(body.key) || !validID(body.ItemID) {
			fail(w, 400, "INVALID_REQUEST", "")
			return
		}
		a.mutate(w, r, body.key, func(ctx context.Context, k playerprofile.MutationKey) (playerprofile.MutationResult, error) {
			cmd := playerprofile.ItemCommand{MutationKey: k, ItemID: body.ItemID}
			switch kind {
			case "buy":
				return a.port.BuyItem(ctx, cmd)
			case "craft":
				return a.port.CraftItem(ctx, cmd)
			default:
				return a.port.EquipItem(ctx, cmd)
			}
		})
	}
}
func (a *API) exchange(w http.ResponseWriter, r *http.Request) {
	var body exchangeRequest
	if decode(w, r, &body) != nil || !validKey(body.key) || (body.Material != "plastic" && body.Material != "metal") || body.Amount < 1 || body.Amount > maxSafeCount {
		fail(w, 400, "INVALID_REQUEST", "")
		return
	}
	a.mutate(w, r, body.key, func(ctx context.Context, k playerprofile.MutationKey) (playerprofile.MutationResult, error) {
		return a.port.ExchangeMaterials(ctx, playerprofile.ExchangeCommand{MutationKey: k, Material: body.Material, Amount: body.Amount})
	})
}
func (a *API) appearance(w http.ResponseWriter, r *http.Request) {
	var body appearanceRequest
	if decode(w, r, &body) != nil || !validKey(body.key) || !validID(body.SkinID) || !validID(body.HairColorID) {
		fail(w, 400, "INVALID_REQUEST", "")
		return
	}
	a.mutate(w, r, body.key, func(ctx context.Context, k playerprofile.MutationKey) (playerprofile.MutationResult, error) {
		return a.port.SetAppearance(ctx, playerprofile.AppearanceCommand{MutationKey: k, SkinID: body.SkinID, HairColorID: body.HairColorID})
	})
}

type equipment struct {
	BoardID     string `json:"boardId"`
	OutfitID    string `json:"outfitId"`
	NetID       string `json:"netId"`
	HairID      string `json:"hairId"`
	CharacterID string `json:"characterId"`
}
type appearance struct {
	SkinID      string `json:"skinId"`
	HairColorID string `json:"hairColorId"`
}
type profile struct {
	PlayerID        string     `json:"playerId"`
	ProfileRevision uint64     `json:"profileRevision"`
	Coins           uint64     `json:"coins"`
	Plastic         uint64     `json:"plastic"`
	Metal           uint64     `json:"metal"`
	OwnedItemIDs    []string   `json:"ownedItemIds"`
	Equipment       equipment  `json:"equipment"`
	Appearance      appearance `json:"appearance"`
}

func validProfile(p playerprofile.Profile) bool {
	if !validID(p.PlayerID) || p.Revision > maxSafeCount || p.Coins > maxSafeCount || p.Plastic > maxSafeCount || p.Metal > maxSafeCount ||
		!validID(p.Equipment.BoardID) || !validID(p.Equipment.OutfitID) || !validID(p.Equipment.NetID) || !validID(p.Equipment.HairID) || !validID(p.Equipment.CharacterID) ||
		!validID(p.Appearance.SkinID) || !validID(p.Appearance.HairColorID) {
		return false
	}
	for _, id := range p.OwnedItemIDs {
		if !validID(id) {
			return false
		}
	}
	return true
}
func validCatalog(c playerprofile.Catalog) bool {
	if !validID(c.Version) {
		return false
	}
	for _, item := range c.Items {
		switch strings.ToLower(item.ItemType) {
		case "character", "board", "outfit", "net", "hair":
		default:
			return false
		}
		if !validID(item.ItemID) || item.PriceCoins > maxSafeCount || item.RecipePlastic > maxSafeCount || item.RecipeMetal > maxSafeCount {
			return false
		}
	}
	for _, option := range append(append([]playerprofile.AppearanceOption{}, c.SkinTones...), c.HairColors...) {
		if !validID(option.OptionID) {
			return false
		}
	}
	return true
}
func profileDTO(p playerprofile.Profile) profile {
	owned := p.OwnedItemIDs
	if owned == nil {
		owned = []string{}
	}
	return profile{p.PlayerID, p.Revision, p.Coins, p.Plastic, p.Metal, owned, equipment{p.Equipment.BoardID, p.Equipment.OutfitID, p.Equipment.NetID, p.Equipment.HairID, p.Equipment.CharacterID}, appearance{p.Appearance.SkinID, p.Appearance.HairColorID}}
}

type catalogItem struct {
	ItemID        string            `json:"itemId"`
	ItemType      string            `json:"itemType"`
	Name          string            `json:"name"`
	Description   string            `json:"description"`
	Enabled       bool              `json:"enabled"`
	Purchasable   bool              `json:"purchasable"`
	PriceCoins    uint64            `json:"priceCoins"`
	Craftable     bool              `json:"craftable"`
	RecipePlastic uint64            `json:"recipePlastic"`
	RecipeMetal   uint64            `json:"recipeMetal"`
	Metadata      map[string]string `json:"metadata,omitempty"`
}
type option struct {
	OptionID string `json:"optionId"`
	Name     string `json:"name"`
	Color    string `json:"color"`
}
type catalog struct {
	CatalogVersion string        `json:"catalogVersion"`
	Items          []catalogItem `json:"items"`
	SkinTones      []option      `json:"skinTones"`
	HairColors     []option      `json:"hairColors"`
}

func catalogDTO(c playerprofile.Catalog) catalog {
	out := catalog{CatalogVersion: c.Version, Items: []catalogItem{}, SkinTones: []option{}, HairColors: []option{}}
	for _, i := range c.Items {
		out.Items = append(out.Items, catalogItem{i.ItemID, strings.ToLower(i.ItemType), i.Name, i.Description, i.Enabled, i.Purchasable, i.PriceCoins, i.Craftable, i.RecipePlastic, i.RecipeMetal, i.Metadata})
	}
	for _, o := range c.SkinTones {
		out.SkinTones = append(out.SkinTones, option{o.OptionID, o.Name, o.Color})
	}
	for _, o := range c.HairColors {
		out.HairColors = append(out.HairColors, option{o.OptionID, o.Name, o.Color})
	}
	return out
}
