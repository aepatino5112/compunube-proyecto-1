package playerprofile

import (
	"context"
	"errors"
	"strings"

	"github.com/aepatino5112/compunube-proyecto-1/services/match-service-go/internal/correlation"
	pb "github.com/aepatino5112/compunube-proyecto-1/services/match-service-go/internal/playerprofile/pb"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/status"
)

type Adapter struct {
	client pb.PlayerProfileServiceClient
	conn   *grpc.ClientConn
}

func NewGRPC(target string) (*Adapter, error) {
	if target == "" {
		return nil, &Fault{Kind: Fatal, Code: "INVALID_TARGET"}
	}
	conn, err := grpc.NewClient(target, grpc.WithTransportCredentials(insecure.NewCredentials()), grpc.WithUnaryInterceptor(correlation.UnaryClientInterceptor))
	if err != nil {
		return nil, &Fault{Kind: Fatal, Code: "INVALID_TARGET"}
	}
	return &Adapter{client: pb.NewPlayerProfileServiceClient(conn), conn: conn}, nil
}
func (a *Adapter) Close() error {
	if a.conn != nil {
		return a.conn.Close()
	}
	return nil
}
func mapRPC(err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, context.Canceled) {
		return &Fault{Kind: Canceled, Code: "CANCELED"}
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return &Fault{Kind: Deadline, Code: "DEADLINE_EXCEEDED"}
	}
	switch status.Code(err) {
	case codes.Canceled:
		return &Fault{Kind: Canceled, Code: "CANCELED"}
	case codes.DeadlineExceeded:
		return &Fault{Kind: Deadline, Code: "DEADLINE_EXCEEDED"}
	case codes.Unavailable:
		return &Fault{Kind: Unavailable, Code: "UNAVAILABLE"}
	case codes.ResourceExhausted:
		return &Fault{Kind: ResourceExhausted, Code: "RESOURCE_EXHAUSTED"}
	case codes.InvalidArgument:
		return &Fault{Kind: Business, Code: "INVALID_ARGUMENT"}
	case codes.NotFound:
		return &Fault{Kind: Business, Code: "NOT_FOUND"}
	case codes.Unimplemented, codes.PermissionDenied, codes.Unauthenticated:
		return &Fault{Kind: Fatal, Code: status.Code(err).String()}
	default:
		return &Fault{Kind: System, Code: "INTERNAL"}
	}
}
func badResponse() error { return &Fault{Kind: System, Code: "INVALID_RESPONSE"} }
func profileFromPB(p *pb.PlayerProfile) (Profile, error) {
	if p == nil || p.GetPlayerId() == "" {
		return Profile{}, badResponse()
	}
	out := Profile{PlayerID: p.GetPlayerId(), Revision: p.GetProfileRevision(), Coins: p.GetCoins(), Plastic: p.GetPlastic(), Metal: p.GetMetal(), OwnedItemIDs: append([]string(nil), p.GetOwnedItemIds()...)}
	if e := p.GetEquipment(); e != nil {
		out.Equipment = Equipment{e.GetBoardId(), e.GetOutfitId(), e.GetNetId(), e.GetHairId(), e.GetCharacterId()}
	}
	if a := p.GetAppearance(); a != nil {
		out.Appearance = Appearance{a.GetSkinId(), a.GetHairColorId()}
	}
	return out, nil
}
func (a *Adapter) GetProfile(ctx context.Context, id string) (Profile, error) {
	v, err := a.client.GetProfile(ctx, &pb.GetProfileRequest{PlayerId: id})
	if err != nil {
		return Profile{}, mapRPC(err)
	}
	p, err := profileFromPB(v.GetProfile())
	if err != nil {
		return Profile{}, err
	}
	if p.PlayerID != id {
		return Profile{}, badResponse()
	}
	return p, nil
}
func (a *Adapter) GetCatalog(ctx context.Context, version string) (Catalog, error) {
	v, err := a.client.GetCatalog(ctx, &pb.GetCatalogRequest{CatalogVersion: version})
	if err != nil {
		return Catalog{}, mapRPC(err)
	}
	if v == nil || v.GetCatalogVersion() == "" {
		return Catalog{}, badResponse()
	}
	if version != "" && v.GetCatalogVersion() != version {
		return Catalog{}, badResponse()
	}
	out := Catalog{Version: v.GetCatalogVersion()}
	for _, item := range v.GetItems() {
		if item == nil || item.GetItemId() == "" {
			return Catalog{}, badResponse()
		}
		if item.GetItemType() < pb.ItemType_ITEM_TYPE_CHARACTER || item.GetItemType() > pb.ItemType_ITEM_TYPE_HAIR {
			return Catalog{}, badResponse()
		}
		entry := CatalogItem{ItemID: item.GetItemId(), ItemType: strings.TrimPrefix(item.GetItemType().String(), "ITEM_TYPE_"), Name: item.GetName(), Description: item.GetDescription(), Enabled: item.GetEnabled(), Purchasable: item.GetPurchasable(), Craftable: item.GetCraftable(), PriceCoins: item.GetPriceCoins(), RecipePlastic: item.GetRecipePlastic(), RecipeMetal: item.GetRecipeMetal(), Metadata: map[string]string{}}
		for _, kv := range item.GetMetadata() {
			if kv != nil {
				entry.Metadata[kv.GetKey()] = kv.GetValue()
			}
		}
		out.Items = append(out.Items, entry)
	}
	for _, option := range v.GetSkinTones() {
		if option != nil {
			out.SkinTones = append(out.SkinTones, AppearanceOption{option.GetOptionId(), option.GetName(), option.GetColor()})
		}
	}
	for _, option := range v.GetHairColors() {
		if option != nil {
			out.HairColors = append(out.HairColors, AppearanceOption{option.GetOptionId(), option.GetName(), option.GetColor()})
		}
	}
	return out, nil
}
func mutationResult(v *pb.ProfileMutationResponse, requestID, playerID string) (MutationResult, error) {
	if v == nil || v.GetRequestId() != requestID {
		return MutationResult{}, badResponse()
	}
	if s := v.GetSuccess(); s != nil {
		p, err := profileFromPB(s.GetProfile())
		if err != nil {
			return MutationResult{}, err
		}
		if p.PlayerID != playerID {
			return MutationResult{}, badResponse()
		}
		return MutationResult{RequestID: requestID, Replayed: s.GetReplayed(), Profile: p}, nil
	}
	if rejection := v.GetRejection(); rejection != nil {
		code := strings.TrimPrefix(rejection.GetCode().String(), "MUTATION_REJECTION_")
		if rejection.GetCode() < pb.MutationRejectionCode_MUTATION_REJECTION_INVALID_ACTION || rejection.GetCode() > pb.MutationRejectionCode_MUTATION_REJECTION_INVALID_CATALOG_VERSION {
			return MutationResult{}, badResponse()
		}
		return MutationResult{}, &Fault{Kind: Business, Code: code}
	}
	return MutationResult{}, badResponse()
}
func (a *Adapter) BuyItem(ctx context.Context, c ItemCommand) (MutationResult, error) {
	v, err := a.client.BuyItem(ctx, &pb.BuyItemRequest{PlayerId: c.PlayerID, RequestId: c.RequestID, CatalogVersion: c.CatalogVersion, ItemId: c.ItemID})
	if err != nil {
		return MutationResult{}, mapRPC(err)
	}
	return mutationResult(v, c.RequestID, c.PlayerID)
}
func (a *Adapter) CraftItem(ctx context.Context, c ItemCommand) (MutationResult, error) {
	v, err := a.client.CraftItem(ctx, &pb.CraftItemRequest{PlayerId: c.PlayerID, RequestId: c.RequestID, CatalogVersion: c.CatalogVersion, ItemId: c.ItemID})
	if err != nil {
		return MutationResult{}, mapRPC(err)
	}
	return mutationResult(v, c.RequestID, c.PlayerID)
}
func (a *Adapter) EquipItem(ctx context.Context, c ItemCommand) (MutationResult, error) {
	v, err := a.client.EquipItem(ctx, &pb.EquipItemRequest{PlayerId: c.PlayerID, RequestId: c.RequestID, CatalogVersion: c.CatalogVersion, ItemId: c.ItemID})
	if err != nil {
		return MutationResult{}, mapRPC(err)
	}
	return mutationResult(v, c.RequestID, c.PlayerID)
}
func (a *Adapter) ExchangeMaterials(ctx context.Context, c ExchangeCommand) (MutationResult, error) {
	material := pb.Material_MATERIAL_UNSPECIFIED
	switch c.Material {
	case "plastic":
		material = pb.Material_MATERIAL_PLASTIC
	case "metal":
		material = pb.Material_MATERIAL_METAL
	default:
		return MutationResult{}, &Fault{Kind: Business, Code: "INVALID_ARGUMENT"}
	}
	v, err := a.client.ExchangeMaterials(ctx, &pb.ExchangeMaterialsRequest{PlayerId: c.PlayerID, RequestId: c.RequestID, CatalogVersion: c.CatalogVersion, Material: material, Amount: c.Amount})
	if err != nil {
		return MutationResult{}, mapRPC(err)
	}
	return mutationResult(v, c.RequestID, c.PlayerID)
}
func (a *Adapter) SetAppearance(ctx context.Context, c AppearanceCommand) (MutationResult, error) {
	v, err := a.client.SetAppearance(ctx, &pb.SetAppearanceRequest{PlayerId: c.PlayerID, RequestId: c.RequestID, CatalogVersion: c.CatalogVersion, SkinId: c.SkinID, HairColorId: c.HairColorID})
	if err != nil {
		return MutationResult{}, mapRPC(err)
	}
	return mutationResult(v, c.RequestID, c.PlayerID)
}
func (a *Adapter) SettleRace(ctx context.Context, c SettlementCommand) (SettlementResult, error) {
	outcome := pb.RaceOutcome_RACE_OUTCOME_UNSPECIFIED
	switch c.Outcome {
	case "finished":
		outcome = pb.RaceOutcome_RACE_OUTCOME_FINISHED
	case "disqualified":
		outcome = pb.RaceOutcome_RACE_OUTCOME_DISQUALIFIED
	case "left":
		outcome = pb.RaceOutcome_RACE_OUTCOME_LEFT
	case "dnf":
		outcome = pb.RaceOutcome_RACE_OUTCOME_DNF
	default:
		return SettlementResult{}, &Fault{Kind: Business, Code: "INVALID_ARGUMENT"}
	}
	if c.Outcome != "finished" && (c.CreditedPlastic != 0 || c.CreditedMetal != 0) {
		return SettlementResult{}, &Fault{Kind: Business, Code: "INVALID_SETTLEMENT"}
	}
	v, err := a.client.SettleRace(ctx, &pb.SettleRaceRequest{RaceId: c.RaceID, PlayerId: c.PlayerID, Outcome: outcome, CreditedPlastic: c.CreditedPlastic, CreditedMetal: c.CreditedMetal})
	if err != nil {
		return SettlementResult{}, mapRPC(err)
	}
	if v == nil || v.GetRaceId() != c.RaceID || v.GetPlayerId() != c.PlayerID {
		return SettlementResult{}, badResponse()
	}
	if s := v.GetSuccess(); s != nil {
		p, err := profileFromPB(s.GetProfile())
		if err != nil {
			return SettlementResult{}, err
		}
		if p.PlayerID != c.PlayerID {
			return SettlementResult{}, badResponse()
		}
		return SettlementResult{RaceID: c.RaceID, PlayerID: c.PlayerID, Replayed: s.GetReplayed(), Profile: p}, nil
	}
	if rejection := v.GetRejection(); rejection != nil {
		code := strings.TrimPrefix(rejection.GetCode().String(), "SETTLEMENT_REJECTION_")
		if rejection.GetCode() < pb.SettlementRejectionCode_SETTLEMENT_REJECTION_INVALID_SETTLEMENT || rejection.GetCode() > pb.SettlementRejectionCode_SETTLEMENT_REJECTION_CONFLICT {
			return SettlementResult{}, badResponse()
		}
		return SettlementResult{}, &Fault{Kind: Business, Code: code}
	}
	return SettlementResult{}, badResponse()
}
