package identity

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"log/slog"
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

// SessionStore keeps issued sessions (SHA-256 token hash -> playerId) beyond
// the process lifetime, in the match schema owned by Go (ADR 0005).
type SessionStore interface {
	SaveSession(ctx context.Context, tokenHash []byte, playerID string) error
	LoadSession(ctx context.Context, tokenHash []byte) (playerID string, found bool, err error)
}

// Registry holds sessions and active-player metadata. Only token hashes are
// retained. Without a store a process restart invalidates every session; with
// one, a token unknown to this process is resolved from the store once.
type Registry struct {
	mu           sync.RWMutex
	sessions     map[[sha256.Size]byte]string
	players      map[string]ActivePlayer
	now          func() time.Time
	store        SessionStore
	storeTimeout time.Duration
	logger       *slog.Logger
}

func NewRegistry() *Registry {
	return &Registry{
		sessions: make(map[[sha256.Size]byte]string),
		players:  make(map[string]ActivePlayer),
		now:      time.Now,
	}
}

// UseStore enables persistent sessions; call it before serving requests.
func (r *Registry) UseStore(store SessionStore, timeout time.Duration, logger *slog.Logger) {
	r.store, r.storeTimeout, r.logger = store, timeout, logger
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
			r.persist(ctx, key, id)
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
	id, ok := r.sessions[key]
	r.mu.RUnlock()
	if ctx.Err() != nil {
		return "", false
	}
	if ok || r.store == nil {
		return id, ok
	}
	return r.restore(ctx, key)
}

// persist stores a new session. A store failure keeps the session usable in
// this process (it only would not survive a restart) and is logged.
func (r *Registry) persist(ctx context.Context, key [sha256.Size]byte, playerID string) {
	if r.store == nil {
		return
	}
	ctx, cancel := context.WithTimeout(ctx, r.storeTimeout)
	defer cancel()
	if err := r.store.SaveSession(ctx, key[:], playerID); err != nil && r.logger != nil {
		r.logger.Warn("session not persisted; it will not survive a Go restart", "event", "session_persist_failed", "error", err.Error())
	}
}

// restore resolves a session issued before this process started. An
// unavailable store answers like an unknown token, as E45 defines no other
// outcome for session lookups.
func (r *Registry) restore(ctx context.Context, key [sha256.Size]byte) (string, bool) {
	lookupCtx, cancel := context.WithTimeout(ctx, r.storeTimeout)
	defer cancel()
	id, found, err := r.store.LoadSession(lookupCtx, key[:])
	if err != nil {
		if r.logger != nil {
			r.logger.Warn("session store unavailable", "event", "session_restore_failed", "error", err.Error())
		}
		return "", false
	}
	if !found || id == "" {
		return "", false
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.sessions[key] = id
	if _, ok := r.players[id]; !ok {
		r.players[id] = ActivePlayer{PlayerID: id}
	}
	return id, true
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
