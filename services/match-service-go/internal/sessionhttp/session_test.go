package sessionhttp

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/aepatino5112/compunube-proyecto-1/services/match-service-go/internal/config"
	"github.com/aepatino5112/compunube-proyecto-1/services/match-service-go/internal/identity"
	"github.com/aepatino5112/compunube-proyecto-1/services/match-service-go/internal/server"
)

type createdSession struct {
	PlayerID string `json:"playerId"`
	Token    string `json:"token"`
}

func setup(t *testing.T) (*API, http.Handler, *bytes.Buffer) {
	t.Helper()
	api := New(identity.NewRegistry())
	logs := &bytes.Buffer{}
	logger := slog.New(slog.NewTextHandler(logs, nil))
	s := server.New(config.Config{HTTPAddr: "127.0.0.1:8080", ShutdownTimeout: time.Second}, logger, api.Register)
	return api, s.Handler(), logs
}

func request(handler http.Handler, method, target, body string, token string, cookie *http.Cookie) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, target, strings.NewReader(body))
	if token != "" {
		r.Header.Set("Authorization", "Bearer "+token)
	}
	if cookie != nil {
		r.AddCookie(cookie)
	}
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	return w
}

func createSession(t *testing.T, handler http.Handler) (createdSession, *http.Cookie) {
	t.Helper()
	w := request(handler, http.MethodPost, "/v1/sessions", "", "", nil)
	if w.Code != http.StatusCreated {
		t.Fatalf("create status %d: %s", w.Code, w.Body.String())
	}
	var session createdSession
	if err := json.Unmarshal(w.Body.Bytes(), &session); err != nil {
		t.Fatal(err)
	}
	if session.PlayerID == "" || session.Token == "" || w.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("incomplete session response")
	}
	cookies := w.Result().Cookies()
	if len(cookies) != 1 {
		t.Fatalf("expected one cookie, got %d", len(cookies))
	}
	c := cookies[0]
	if c.Name != cookieName || c.Value != session.Token || c.Path != "/v1" || !c.HttpOnly || !c.Secure || c.SameSite != http.SameSiteStrictMode {
		t.Fatalf("cookie does not satisfy E45: %+v", c)
	}
	return session, c
}

func TestSessionEndpointsAndIdentity(t *testing.T) {
	_, handler, _ := setup(t)
	first, cookie := createSession(t, handler)
	second, secondCookie := createSession(t, handler)
	if first.PlayerID == second.PlayerID || first.Token == second.Token {
		t.Fatal("sessions were not unique")
	}
	for _, tc := range []struct {
		name   string
		token  string
		cookie *http.Cookie
		want   string
	}{
		{"bearer", first.Token, nil, first.PlayerID},
		{"cookie", "", cookie, first.PlayerID},
		{"matching both", first.Token, cookie, first.PlayerID},
		{"other bearer", second.Token, secondCookie, second.PlayerID},
	} {
		t.Run(tc.name, func(t *testing.T) {
			w := request(handler, http.MethodGet, "/v1/sessions/current", "", tc.token, tc.cookie)
			if w.Code != 200 || !strings.Contains(w.Body.String(), `"playerId":"`+tc.want+`"`) || strings.Contains(w.Body.String(), "token") {
				t.Fatalf("current failed: %d %s", w.Code, w.Body.String())
			}
		})
	}
	if w := request(handler, http.MethodPost, "/v1/sessions", `{"playerId":"chosen"}`, "", nil); w.Code != 400 {
		t.Fatalf("client-selected identity accepted: %d", w.Code)
	}
	if w := request(handler, http.MethodPost, "/v1/sessions?playerId=chosen", "", "", nil); w.Code != 400 {
		t.Fatalf("query identity accepted: %d", w.Code)
	}
	chunked := httptest.NewRequest(http.MethodPost, "/v1/sessions", nil)
	chunked.ContentLength = -1
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, chunked)
	if w.Code != 400 {
		t.Fatalf("streaming session body accepted: %d", w.Code)
	}
	if _, ok := identity.NewRegistry().Lookup(context.Background(), first.Token); ok {
		t.Fatal("credential survived process registry replacement")
	}
}

func TestInvalidCredentialsAreSafe(t *testing.T) {
	_, handler, logs := setup(t)
	first, cookie := createSession(t, handler)
	second, _ := createSession(t, handler)
	for _, tc := range []struct {
		name   string
		token  string
		cookie *http.Cookie
		target string
	}{
		{"missing", "", nil, "/v1/sessions/current"},
		{"bad bearer", "secret-invalid-token", nil, "/v1/sessions/current"},
		{"bad cookie", "", &http.Cookie{Name: cookieName, Value: "secret-invalid-token"}, "/v1/sessions/current"},
		{"conflicting identities", first.Token, &http.Cookie{Name: cookieName, Value: second.Token}, "/v1/sessions/current"},
		{"valid cookie with bad bearer", "secret-invalid-token", cookie, "/v1/sessions/current"},
		{"query secret", "", nil, "/v1/sessions/current?token=secret-invalid-token"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			w := request(handler, http.MethodGet, tc.target, "", tc.token, tc.cookie)
			if w.Code != 401 || !strings.Contains(w.Body.String(), `"code":"SESSION_REQUIRED"`) || strings.Contains(w.Body.String(), "secret-invalid-token") {
				t.Fatalf("unsafe auth response: %d %s", w.Code, w.Body.String())
			}
		})
	}
	if strings.Contains(logs.String(), first.Token) || strings.Contains(logs.String(), second.Token) || strings.Contains(logs.String(), "secret-invalid-token") {
		t.Fatal("token appeared in logs")
	}
	duplicate := httptest.NewRequest(http.MethodGet, "/v1/sessions/current", nil)
	duplicate.AddCookie(cookie)
	duplicate.AddCookie(cookie)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, duplicate)
	if w.Code != 401 {
		t.Fatalf("duplicate session cookies accepted: %d", w.Code)
	}
}

func TestCookieOriginAndUpgradeSeam(t *testing.T) {
	api, handler, _ := setup(t)
	first, cookie := createSession(t, handler)
	protected := api.Require(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id, ok := PlayerID(r.Context())
		if !ok || id != first.PlayerID {
			t.Error("middleware lost confirmed identity")
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	for _, tc := range []struct {
		origin string
		want   int
	}{
		{"", 401}, {"https://example.com", 401}, {"http://evil.example", 401}, {"http://example.com", 204},
	} {
		r := httptest.NewRequest(http.MethodPost, "http://example.com/mutate", nil)
		r.AddCookie(cookie)
		if tc.origin != "" {
			r.Header.Set("Origin", tc.origin)
		}
		w := httptest.NewRecorder()
		protected.ServeHTTP(w, r)
		if w.Code != tc.want {
			t.Fatalf("origin %q: got %d, want %d", tc.origin, w.Code, tc.want)
		}
	}
	ws := httptest.NewRequest(http.MethodGet, "http://example.com/v1/realtime", nil)
	ws.AddCookie(cookie)
	if _, ok := api.AuthenticateUpgrade(ws); ok {
		t.Fatal("cookie upgrade without Origin accepted")
	}
	ws.Header.Set("Origin", "http://example.com")
	if id, ok := api.AuthenticateUpgrade(ws); !ok || id != first.PlayerID {
		t.Fatal("same-origin upgrade rejected")
	}
	ws.TLS = &tls.ConnectionState{}
	if _, ok := api.AuthenticateUpgrade(ws); ok {
		t.Fatal("scheme-mismatched upgrade accepted")
	}
	ws.Header.Set("Origin", "https://example.com")
	if id, ok := api.AuthenticateUpgrade(ws); !ok || id != first.PlayerID {
		t.Fatal("TLS same-origin upgrade rejected")
	}
	// A TLS proxy in front of Go (PUBLIC_ORIGINS) is accepted only for its
	// exact configured origin; other origins keep failing.
	proxied := New(api.registry, "https://lab.example:4173")
	behind := httptest.NewRequest(http.MethodGet, "http://go:8080/v1/realtime", nil)
	behind.AddCookie(cookie)
	for origin, want := range map[string]bool{"https://lab.example:4173": true, "https://lab.example:4174": false,
		"http://lab.example:4173": false, "https://evil.example": false} {
		behind.Header.Set("Origin", origin)
		if _, ok := proxied.AuthenticateUpgrade(behind); ok != want {
			t.Fatalf("public origin %q: got %v", origin, ok)
		}
	}
	if _, ok := api.AuthenticateUpgrade(behind); ok {
		t.Fatal("public origin accepted without PUBLIC_ORIGINS")
	}
	// A non-browser bearer client need not send Origin on a state change.
	bearer := httptest.NewRequest(http.MethodPost, "http://example.com/mutate", nil)
	bearer.Header.Set("Authorization", "Bearer "+first.Token)
	w := httptest.NewRecorder()
	protected.ServeHTTP(w, bearer)
	if w.Code != 204 {
		t.Fatalf("bearer state change rejected: %d", w.Code)
	}
	if _, ok := PlayerID(context.Background()); ok {
		t.Fatal("identity leaked into unrelated context")
	}
}
