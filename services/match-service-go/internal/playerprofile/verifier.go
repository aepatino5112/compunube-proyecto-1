package playerprofile

import (
	"context"

	"github.com/aepatino5112/compunube-proyecto-1/services/match-service-go/internal/rooms"
	"github.com/aepatino5112/compunube-proyecto-1/services/match-service-go/internal/workpool"
)

type ProfileVerifier struct {
	Port Port
	Pool *workpool.Pool
}

func (v ProfileVerifier) Verify(ctx context.Context, id string, revision uint64) (rooms.Preparation, error) {
	if v.Port == nil || v.Pool == nil {
		return rooms.Preparation{}, unavailable()
	}
	var p Profile
	done, err := v.Pool.Submit(ctx, func(jobCtx context.Context) error {
		var callErr error
		p, callErr = v.Port.GetProfile(jobCtx, id)
		return callErr
	})
	if err != nil {
		return rooms.Preparation{}, err
	}
	select {
	case err = <-done:
	case <-ctx.Done():
		err = ctx.Err()
	}
	if err != nil {
		return rooms.Preparation{}, err
	}
	if p.PlayerID != id || p.Revision != revision || p.Equipment.BoardID == "" || p.Equipment.OutfitID == "" || p.Equipment.NetID == "" || p.Equipment.HairID == "" || p.Equipment.CharacterID == "" || p.Appearance.SkinID == "" || p.Appearance.HairColorID == "" {
		return rooms.Preparation{}, rooms.ErrReady
	}
	owned := map[string]bool{}
	for _, item := range p.OwnedItemIDs {
		owned[item] = true
	}
	for _, item := range []string{p.Equipment.BoardID, p.Equipment.OutfitID, p.Equipment.NetID, p.Equipment.HairID, p.Equipment.CharacterID} {
		if !owned[item] {
			return rooms.Preparation{}, rooms.ErrReady
		}
	}
	return rooms.Preparation{Revision: p.Revision, DisplayName: id, Equipment: rooms.Equipment{BoardID: p.Equipment.BoardID, OutfitID: p.Equipment.OutfitID, NetID: p.Equipment.NetID, HairID: p.Equipment.HairID, CharacterID: p.Equipment.CharacterID}, Appearance: rooms.Appearance{SkinID: p.Appearance.SkinID, HairColorID: p.Appearance.HairColorID}}, nil
}

var _ rooms.Verifier = ProfileVerifier{}
