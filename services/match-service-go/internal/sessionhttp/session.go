package sessionhttp

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"strings"

	"github.com/aepatino5112/compunube-proyecto-1/services/match-service-go/internal/identity"
)

const cookieName = "compunube_session"

type contextKey struct{}

type API struct{ registry *identity.Registry }

func New(registry *identity.Registry) *API { return &API{registry: registry} }

func (a *API) Register(mux *http.ServeMux) {
	mux.HandleFunc("POST /v1/sessions", a.create)
	mux.Handle("GET /v1/sessions/current", a.Require(http.HandlerFunc(a.current)))
}

func (a *API) create(w http.ResponseWriter, r *http.Request) {
	// E45 has no request body or query parameters for establishing identity.
	if r.URL.RawQuery != "" || r.ContentLength != 0 {
		writeError(w, http.StatusBadRequest, "INVALID_REQUEST", "Session creation takes no input")
		return
	}
	id, token, err := a.registry.Create(r.Context())
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Session unavailable")
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name: cookieName, Value: token, Path: "/v1",
		HttpOnly: true, Secure: true, SameSite: http.SameSiteStrictMode,
	})
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusCreated, struct {
		PlayerID string `json:"playerId"`
		Token    string `json:"token"`
	}{id, token})
}

func (a *API) current(w http.ResponseWriter, r *http.Request) {
	id, _ := PlayerID(r.Context())
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, struct {
		PlayerID string `json:"playerId"`
	}{id})
}

// Require authenticates once and puts the server-issued player ID in context.
// Future business handlers must use PlayerID rather than a client-supplied ID.
func (a *API) Require(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id, cookieOnly, ok := a.authenticate(r)
		if !ok || (cookieOnly && unsafeMethod(r.Method) && !SameOrigin(r)) {
			writeError(w, http.StatusUnauthorized, "SESSION_REQUIRED", "Valid session required")
			return
		}
		next.ServeHTTP(w, r.WithContext(withPlayerID(r.Context(), id)))
	})
}

// AuthenticateUpgrade is the auth seam for the future E43 WebSocket handler.
// A browser cookie handshake must carry a matching Origin even though it is GET.
func (a *API) AuthenticateUpgrade(r *http.Request) (string, bool) {
	id, cookieOnly, ok := a.authenticate(r)
	if !ok || (cookieOnly && !SameOrigin(r)) {
		return "", false
	}
	return id, true
}

func (a *API) authenticate(r *http.Request) (playerID string, cookieOnly, ok bool) {
	if r.URL.Query().Has("token") || r.URL.Query().Has("access_token") {
		return "", false, false
	}
	headers := r.Header.Values("Authorization")
	if len(headers) > 1 {
		return "", false, false
	}
	var bearer string
	if len(headers) == 1 {
		parts := strings.Fields(headers[0])
		if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
			return "", false, false
		}
		bearer = parts[1]
	}
	var cookie string
	cookieFound := false
	for _, c := range r.Cookies() {
		if c.Name == cookieName {
			if cookieFound {
				return "", false, false
			}
			cookieFound = true
			cookie = c.Value
		}
	}
	if bearer == "" && cookie == "" {
		return "", false, false
	}
	if bearer != "" {
		playerID, ok = a.registry.Lookup(r.Context(), bearer)
		if !ok {
			return "", false, false
		}
	}
	if cookie != "" {
		cookieID, valid := a.registry.Lookup(r.Context(), cookie)
		if !valid || (bearer != "" && cookieID != playerID) {
			return "", false, false
		}
		if bearer == "" {
			return cookieID, true, true
		}
	}
	return playerID, false, true
}

// SameOrigin checks the direct request origin; untrusted forwarded headers are
// intentionally ignored. TLS termination must preserve this invariant upstream.
func SameOrigin(r *http.Request) bool {
	origins := r.Header.Values("Origin")
	if len(origins) != 1 {
		return false
	}
	u, err := url.Parse(origins[0])
	if err != nil || u.User != nil || u.Host == "" || u.Path != "" || u.RawQuery != "" || u.Fragment != "" || !strings.EqualFold(u.Host, r.Host) {
		return false
	}
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	return u.Scheme == scheme
}

func unsafeMethod(method string) bool {
	return method != http.MethodGet && method != http.MethodHead && method != http.MethodOptions
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	}{code, message})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func withPlayerID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, contextKey{}, id)
}

func PlayerID(ctx context.Context) (string, bool) {
	id, ok := ctx.Value(contextKey{}).(string)
	return id, ok && id != ""
}
