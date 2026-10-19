// Package playerprofile is the Go domain boundary to the future Rust service.
// Callers never depend on protobuf types.
package playerprofile

import (
	"context"
	"errors"
)

type FaultKind string

const (
	Business          FaultKind = "business"
	Unavailable       FaultKind = "unavailable"
	ResourceExhausted FaultKind = "resource_exhausted"
	Deadline          FaultKind = "deadline"
	Fatal             FaultKind = "fatal"
	System            FaultKind = "system"
	Canceled          FaultKind = "canceled"
)

type Fault struct {
	Kind FaultKind
	Code string
}

func (f *Fault) Error() string { return string(f.Kind) + ": " + f.Code }
func Kind(err error) FaultKind {
	var f *Fault
	if errors.As(err, &f) {
		return f.Kind
	}
	return System
}

type Equipment struct{ BoardID, OutfitID, NetID, HairID, CharacterID string }
type Appearance struct{ SkinID, HairColorID string }
type Profile struct {
	PlayerID                        string
	Revision, Coins, Plastic, Metal uint64
	OwnedItemIDs                    []string
	Equipment                       Equipment
	Appearance                      Appearance
}
type CatalogItem struct {
	ItemID, ItemType, Name, Description    string
	Enabled, Purchasable, Craftable        bool
	PriceCoins, RecipePlastic, RecipeMetal uint64
	Metadata                               map[string]string
}
type AppearanceOption struct{ OptionID, Name, Color string }
type Catalog struct {
	Version               string
	Items                 []CatalogItem
	SkinTones, HairColors []AppearanceOption
}
type MutationKey struct{ PlayerID, RequestID, CatalogVersion string }
type ItemCommand struct {
	MutationKey
	ItemID string
}
type ExchangeCommand struct {
	MutationKey
	Material string
	Amount   uint64
}
type AppearanceCommand struct {
	MutationKey
	SkinID, HairColorID string
}
type MutationResult struct {
	RequestID string
	Replayed  bool
	Profile   Profile
}
type SettlementCommand struct {
	RaceID, PlayerID, Outcome      string
	CreditedPlastic, CreditedMetal uint64
}
type SettlementResult struct {
	RaceID, PlayerID string
	Replayed         bool
	Profile          Profile
}

type Port interface {
	GetProfile(context.Context, string) (Profile, error)
	GetCatalog(context.Context, string) (Catalog, error)
	BuyItem(context.Context, ItemCommand) (MutationResult, error)
	CraftItem(context.Context, ItemCommand) (MutationResult, error)
	ExchangeMaterials(context.Context, ExchangeCommand) (MutationResult, error)
	EquipItem(context.Context, ItemCommand) (MutationResult, error)
	SetAppearance(context.Context, AppearanceCommand) (MutationResult, error)
	SettleRace(context.Context, SettlementCommand) (SettlementResult, error)
}

// Fake has a separate hook for every method. An unset hook fails closed.
type Fake struct {
	GetProfileFn        func(context.Context, string) (Profile, error)
	GetCatalogFn        func(context.Context, string) (Catalog, error)
	BuyItemFn           func(context.Context, ItemCommand) (MutationResult, error)
	CraftItemFn         func(context.Context, ItemCommand) (MutationResult, error)
	ExchangeMaterialsFn func(context.Context, ExchangeCommand) (MutationResult, error)
	EquipItemFn         func(context.Context, ItemCommand) (MutationResult, error)
	SetAppearanceFn     func(context.Context, AppearanceCommand) (MutationResult, error)
	SettleRaceFn        func(context.Context, SettlementCommand) (SettlementResult, error)
}

func unavailable() error { return &Fault{Kind: Unavailable, Code: "PROFILE_UNAVAILABLE"} }
func (f *Fake) GetProfile(ctx context.Context, id string) (Profile, error) {
	if f.GetProfileFn == nil {
		return Profile{}, unavailable()
	}
	return f.GetProfileFn(ctx, id)
}
func (f *Fake) GetCatalog(ctx context.Context, v string) (Catalog, error) {
	if f.GetCatalogFn == nil {
		return Catalog{}, unavailable()
	}
	return f.GetCatalogFn(ctx, v)
}
func (f *Fake) BuyItem(ctx context.Context, c ItemCommand) (MutationResult, error) {
	if f.BuyItemFn == nil {
		return MutationResult{}, unavailable()
	}
	return f.BuyItemFn(ctx, c)
}
func (f *Fake) CraftItem(ctx context.Context, c ItemCommand) (MutationResult, error) {
	if f.CraftItemFn == nil {
		return MutationResult{}, unavailable()
	}
	return f.CraftItemFn(ctx, c)
}
func (f *Fake) ExchangeMaterials(ctx context.Context, c ExchangeCommand) (MutationResult, error) {
	if f.ExchangeMaterialsFn == nil {
		return MutationResult{}, unavailable()
	}
	return f.ExchangeMaterialsFn(ctx, c)
}
func (f *Fake) EquipItem(ctx context.Context, c ItemCommand) (MutationResult, error) {
	if f.EquipItemFn == nil {
		return MutationResult{}, unavailable()
	}
	return f.EquipItemFn(ctx, c)
}
func (f *Fake) SetAppearance(ctx context.Context, c AppearanceCommand) (MutationResult, error) {
	if f.SetAppearanceFn == nil {
		return MutationResult{}, unavailable()
	}
	return f.SetAppearanceFn(ctx, c)
}
func (f *Fake) SettleRace(ctx context.Context, c SettlementCommand) (SettlementResult, error) {
	if f.SettleRaceFn == nil {
		return SettlementResult{}, unavailable()
	}
	return f.SettleRaceFn(ctx, c)
}
