package playerprofile

import (
	"context"
	"errors"
	"net"
	"strings"
	"testing"
	"time"

	pb "github.com/aepatino5112/compunube-proyecto-1/services/match-service-go/internal/playerprofile/pb"
	"github.com/aepatino5112/compunube-proyecto-1/services/match-service-go/internal/roomruntime"
	"github.com/aepatino5112/compunube-proyecto-1/services/match-service-go/internal/rooms"
	"github.com/aepatino5112/compunube-proyecto-1/services/match-service-go/internal/workpool"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/grpc/test/bufconn"
)

func readyProfile(id string) Profile {
	return Profile{PlayerID: id, Revision: 7, OwnedItemIDs: []string{"board", "outfit", "net", "hair", "character"}, Equipment: Equipment{"board", "outfit", "net", "hair", "character"}, Appearance: Appearance{"skin", "color"}}
}
func TestFakeCoversEveryPortMethod(t *testing.T) {
	ctx := context.Background()
	calls := 0
	f := &Fake{
		GetProfileFn:        func(context.Context, string) (Profile, error) { calls++; return readyProfile("p"), nil },
		GetCatalogFn:        func(context.Context, string) (Catalog, error) { calls++; return Catalog{Version: "v"}, nil },
		BuyItemFn:           func(context.Context, ItemCommand) (MutationResult, error) { calls++; return MutationResult{}, nil },
		CraftItemFn:         func(context.Context, ItemCommand) (MutationResult, error) { calls++; return MutationResult{}, nil },
		ExchangeMaterialsFn: func(context.Context, ExchangeCommand) (MutationResult, error) { calls++; return MutationResult{}, nil },
		EquipItemFn:         func(context.Context, ItemCommand) (MutationResult, error) { calls++; return MutationResult{}, nil },
		SetAppearanceFn: func(context.Context, AppearanceCommand) (MutationResult, error) {
			calls++
			return MutationResult{}, nil
		},
		SettleRaceFn: func(context.Context, SettlementCommand) (SettlementResult, error) {
			calls++
			return SettlementResult{}, nil
		},
	}
	if _, err := f.GetProfile(ctx, "p"); err != nil {
		t.Fatal(err)
	}
	if _, err := f.GetCatalog(ctx, ""); err != nil {
		t.Fatal(err)
	}
	if _, err := f.BuyItem(ctx, ItemCommand{}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.CraftItem(ctx, ItemCommand{}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.ExchangeMaterials(ctx, ExchangeCommand{}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.EquipItem(ctx, ItemCommand{}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.SetAppearance(ctx, AppearanceCommand{}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.SettleRace(ctx, SettlementCommand{}); err != nil {
		t.Fatal(err)
	}
	if calls != 8 {
		t.Fatalf("only %d port methods exercised", calls)
	}
	if _, err := (&Fake{}).GetProfile(ctx, "p"); Kind(err) != Unavailable {
		t.Fatalf("unset hook did not fail closed: %v", err)
	}
}
func TestProfileVerifierUsesPoolAndFailsClosed(t *testing.T) {
	ctx := context.Background()
	pool, err := workpool.New(ctx, 1, 2, 100*time.Millisecond)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	rt, err := roomruntime.NewManager(ctx, roomruntime.Options{TickInterval: 50 * time.Millisecond, QueueCapacity: 8})
	if err != nil {
		t.Fatal(err)
	}
	defer rt.Close()
	fake := &Fake{GetProfileFn: func(_ context.Context, id string) (Profile, error) { return readyProfile(id), nil }}
	m := rooms.NewManager(rt, ProfileVerifier{Port: fake, Pool: pool})
	room, err := m.Create(ctx, "maracaibo", "p")
	if err != nil {
		t.Fatal(err)
	}
	if err := m.Ready(ctx, room.RoomID, "p", true, 7, "reusable"); err != nil {
		t.Fatalf("valid profile not ready: %v", err)
	}
	fake.GetProfileFn = func(context.Context, string) (Profile, error) {
		return Profile{}, &Fault{Kind: Unavailable, Code: "UNAVAILABLE"}
	}
	if err := m.Ready(ctx, room.RoomID, "p", true, 8, "reusable"); Kind(err) != Unavailable {
		t.Fatalf("unavailable profile accepted: %v", err)
	}
	fake.GetProfileFn = func(_ context.Context, id string) (Profile, error) {
		p := readyProfile(id)
		p.OwnedItemIDs = nil
		return p, nil
	}
	if err := m.Ready(ctx, room.RoomID, "p", true, 7, "reusable"); !errors.Is(err, rooms.ErrReady) {
		t.Fatalf("unowned equipment accepted: %v", err)
	}
}
func TestRPCErrorClassificationRedactsDetails(t *testing.T) {
	for _, test := range []struct {
		code codes.Code
		kind FaultKind
	}{{codes.InvalidArgument, Business}, {codes.NotFound, Business}, {codes.Unavailable, Unavailable}, {codes.ResourceExhausted, ResourceExhausted}, {codes.DeadlineExceeded, Deadline}, {codes.Internal, System}, {codes.PermissionDenied, Fatal}, {codes.Unimplemented, Fatal}, {codes.Canceled, Canceled}} {
		err := mapRPC(status.Error(test.code, "password=secret"))
		if Kind(err) != test.kind || strings.Contains(err.Error(), "secret") {
			t.Fatalf("classification/leak %s: %v", test.code, err)
		}
	}
}

type testGRPC struct {
	pb.UnimplementedPlayerProfileServiceServer
	settlement *pb.SettleRaceRequest
	reject     bool
}

func profilePB(id string) *pb.PlayerProfile {
	return &pb.PlayerProfile{PlayerId: id, ProfileRevision: 7, OwnedItemIds: []string{"board", "outfit", "net", "hair", "character"}, Equipment: &pb.Equipment{BoardId: "board", OutfitId: "outfit", NetId: "net", HairId: "hair", CharacterId: "character"}, Appearance: &pb.Appearance{SkinId: "skin", HairColorId: "color"}}
}
func (s *testGRPC) GetProfile(_ context.Context, r *pb.GetProfileRequest) (*pb.GetProfileResponse, error) {
	return &pb.GetProfileResponse{Profile: profilePB(r.GetPlayerId())}, nil
}
func (s *testGRPC) GetCatalog(context.Context, *pb.GetCatalogRequest) (*pb.GetCatalogResponse, error) {
	return &pb.GetCatalogResponse{CatalogVersion: "v1", Items: []*pb.CatalogItem{{ItemId: "board", ItemType: pb.ItemType_ITEM_TYPE_BOARD, Metadata: []*pb.CatalogMetadataEntry{{Key: "k", Value: "v"}}}}, SkinTones: []*pb.AppearanceOption{{OptionId: "skin", Name: "Skin"}}}, nil
}
func mutation(id string) *pb.ProfileMutationResponse {
	return &pb.ProfileMutationResponse{RequestId: id, Outcome: &pb.ProfileMutationResponse_Success{Success: &pb.ProfileMutationSuccess{Replayed: true, Profile: profilePB("p")}}}
}
func (s *testGRPC) BuyItem(_ context.Context, r *pb.BuyItemRequest) (*pb.ProfileMutationResponse, error) {
	return mutation(r.GetRequestId()), nil
}
func (s *testGRPC) CraftItem(_ context.Context, r *pb.CraftItemRequest) (*pb.ProfileMutationResponse, error) {
	return mutation(r.GetRequestId()), nil
}
func (s *testGRPC) ExchangeMaterials(_ context.Context, r *pb.ExchangeMaterialsRequest) (*pb.ProfileMutationResponse, error) {
	return mutation(r.GetRequestId()), nil
}
func (s *testGRPC) EquipItem(_ context.Context, r *pb.EquipItemRequest) (*pb.ProfileMutationResponse, error) {
	return mutation(r.GetRequestId()), nil
}
func (s *testGRPC) SetAppearance(_ context.Context, r *pb.SetAppearanceRequest) (*pb.ProfileMutationResponse, error) {
	return &pb.ProfileMutationResponse{RequestId: r.GetRequestId(), Outcome: &pb.ProfileMutationResponse_Rejection{Rejection: &pb.ProfileMutationRejection{Code: pb.MutationRejectionCode_MUTATION_REJECTION_INVALID_APPEARANCE}}}, nil
}
func (s *testGRPC) SettleRace(_ context.Context, r *pb.SettleRaceRequest) (*pb.SettleRaceResponse, error) {
	s.settlement = r
	if s.reject {
		return &pb.SettleRaceResponse{RaceId: r.GetRaceId(), PlayerId: r.GetPlayerId(), Outcome: &pb.SettleRaceResponse_Rejection{Rejection: &pb.SettlementRejection{Code: pb.SettlementRejectionCode_SETTLEMENT_REJECTION_CONFLICT}}}, nil
	}
	return &pb.SettleRaceResponse{RaceId: r.GetRaceId(), PlayerId: r.GetPlayerId(), Outcome: &pb.SettleRaceResponse_Success{Success: &pb.SettlementSuccess{Replayed: true, Profile: profilePB(r.GetPlayerId())}}}, nil
}
func adapterForTest(t *testing.T, s *testGRPC) *Adapter {
	t.Helper()
	listener := bufconn.Listen(1024 * 1024)
	server := grpc.NewServer()
	pb.RegisterPlayerProfileServiceServer(server, s)
	go server.Serve(listener)
	t.Cleanup(server.Stop)
	conn, err := grpc.DialContext(context.Background(), "bufnet", grpc.WithInsecure(), grpc.WithContextDialer(func(context.Context, string) (net.Conn, error) { return listener.Dial() }))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { conn.Close() })
	return &Adapter{client: pb.NewPlayerProfileServiceClient(conn), conn: conn}
}
func TestGRPCAdapterMapsEveryRPC(t *testing.T) {
	ctx := context.Background()
	server := &testGRPC{}
	a := adapterForTest(t, server)
	profile, err := a.GetProfile(ctx, "p")
	if err != nil || profile.Revision != 7 || profile.Equipment.BoardID != "board" {
		t.Fatalf("profile: %+v %v", profile, err)
	}
	catalog, err := a.GetCatalog(ctx, "")
	if err != nil || catalog.Version != "v1" || catalog.Items[0].Metadata["k"] != "v" || catalog.Items[0].ItemType != "BOARD" {
		t.Fatalf("catalog: %+v %v", catalog, err)
	}
	item := ItemCommand{MutationKey: MutationKey{PlayerID: "p", RequestID: "req", CatalogVersion: "v1"}, ItemID: "board"}
	for _, call := range []func(context.Context, ItemCommand) (MutationResult, error){a.BuyItem, a.CraftItem, a.EquipItem} {
		v, e := call(ctx, item)
		if e != nil || !v.Replayed || v.RequestID != "req" {
			t.Fatalf("mutation: %+v %v", v, e)
		}
	}
	if v, e := a.ExchangeMaterials(ctx, ExchangeCommand{MutationKey: item.MutationKey, Material: "plastic", Amount: 2}); e != nil || !v.Replayed {
		t.Fatalf("exchange: %+v %v", v, e)
	}
	if _, e := a.SetAppearance(ctx, AppearanceCommand{MutationKey: item.MutationKey, SkinID: "bad"}); Kind(e) != Business {
		t.Fatalf("rejection: %v", e)
	}
	cmd := SettlementCommand{RaceID: "race", PlayerID: "p", Outcome: "finished", CreditedPlastic: 2}
	v, err := a.SettleRace(ctx, cmd)
	if err != nil || !v.Replayed || server.settlement.GetRaceId() != "race" || server.settlement.GetCreditedPlastic() != 2 {
		t.Fatalf("settle: %+v %v", v, err)
	}
	server.reject = true
	if _, err = a.SettleRace(ctx, cmd); Kind(err) != Business {
		t.Fatalf("settlement conflict: %v", err)
	}
	if _, err = a.SettleRace(ctx, SettlementCommand{RaceID: "race", PlayerID: "p", Outcome: "dnf", CreditedPlastic: 1}); Kind(err) != Business {
		t.Fatalf("non-finisher credit accepted: %v", err)
	}
}
func TestGRPCUnavailableWithoutRust(t *testing.T) {
	a, err := NewGRPC("127.0.0.1:1")
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	_, err = a.GetProfile(ctx, "p")
	if kind := Kind(err); kind != Unavailable && kind != Deadline {
		t.Fatalf("unavailable endpoint: %v", err)
	}
	canceled, cancelNow := context.WithCancel(context.Background())
	cancelNow()
	_, err = a.GetProfile(canceled, "p")
	if Kind(err) != Canceled {
		t.Fatalf("cancel not propagated: %v", err)
	}
}
