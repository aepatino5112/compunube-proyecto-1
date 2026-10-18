package identity

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"sync"
	"time"
)

var ErrUnknownPlayer = errors.New("unknown player")

// ActivePlayer is a copy of connection state, not room or race authority.
type ActivePlayer struct {
	PlayerID       string
	ConnectionID   string
	Connected      bool
	DisconnectedAt time.Time
	RoomID         string
}

// Registry holds process-lifetime sessions and active-player metadata.
// Only token hashes are retained; a process restart invalidates every session.
type Registry struct {
	mu       sync.RWMutex
	sessions map[[sha256.Size]byte]string
	players  map[string]ActivePlayer
	now      func() time.Time
}

func NewRegistry() *Registry {
	return &Registry{
		sessions: make(map[[sha256.Size]byte]string),
		players:  make(map[string]ActivePlayer),
		now:      time.Now,
	}
}

func (r *Registry) Create(ctx context.Context) (playerID, token string, err error) {
	if err := ctx.Err(); err != nil {
		return "", "", err
	}
	for {
		id, err := randomID("p_", 16)
		if err != nil {
			return "", "", err
		}
		secret, err := randomID("", 32)
		if err != nil {
			return "", "", err
		}
		key := sha256.Sum256([]byte(secret))
		r.mu.Lock()
		if err := ctx.Err(); err != nil {
			r.mu.Unlock()
			return "", "", err
		}
		_, idExists := r.players[id]
		_, tokenExists := r.sessions[key]
		if !idExists && !tokenExists {
			r.players[id] = ActivePlayer{PlayerID: id}
			r.sessions[key] = id
			r.mu.Unlock()
			return id, secret, nil
		}
		r.mu.Unlock()
	}
}

func (r *Registry) Lookup(ctx context.Context, token string) (string, bool) {
	if ctx.Err() != nil || token == "" {
		return "", false
	}
	key := sha256.Sum256([]byte(token))
	r.mu.RLock()
	defer r.mu.RUnlock()
	if ctx.Err() != nil {
		return "", false
	}
	id, ok := r.sessions[key]
	return id, ok
}

// Bind replaces the current connection for the same player. A stale connection
// cannot disconnect a newer one because Disconnect requires its connection ID.
func (r *Registry) Bind(ctx context.Context, playerID string) (ActivePlayer, error) {
	if err := ctx.Err(); err != nil {
		return ActivePlayer{}, err
	}
	connectionID, err := randomID("c_", 16)
	if err != nil {
		return ActivePlayer{}, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return ActivePlayer{}, err
	}
	p, ok := r.players[playerID]
	if !ok {
		return ActivePlayer{}, ErrUnknownPlayer
	}
	p.ConnectionID = connectionID
	p.Connected = true
	p.DisconnectedAt = time.Time{}
	r.players[playerID] = p
	return p, nil
}

func (r *Registry) Disconnect(ctx context.Context, playerID, connectionID string) (bool, error) {
	if err := ctx.Err(); err != nil {
		return false, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return false, err
	}
	p, ok := r.players[playerID]
	if !ok || !p.Connected || p.ConnectionID != connectionID || connectionID == "" {
		return false, nil
	}
	p.Connected = false
	p.DisconnectedAt = r.now()
	r.players[playerID] = p
	return true, nil
}

// SetRoom records only an optional association. F49 owns membership rules.
func (r *Registry) SetRoom(ctx context.Context, playerID, roomID string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return err
	}
	p, ok := r.players[playerID]
	if !ok {
		return ErrUnknownPlayer
	}
	p.RoomID = roomID
	r.players[playerID] = p
	return nil
}

func (r *Registry) Snapshot(ctx context.Context, playerID string) (ActivePlayer, bool) {
	if ctx.Err() != nil {
		return ActivePlayer{}, false
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	if ctx.Err() != nil {
		return ActivePlayer{}, false
	}
	p, ok := r.players[playerID]
	return p, ok
}

func randomID(prefix string, size int) (string, error) {
	b := make([]byte, size)
	if _, err := rand.Read(b); err != nil {
		return "", errors.New("cannot generate identity")
	}
	return prefix + base64.RawURLEncoding.EncodeToString(b), nil
}
