// Package correlation carries a safe diagnostic ID across HTTP and gRPC.
// It is unrelated to business idempotency keys.
package correlation

import (
	"bufio"
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"
)

const Header = "X-Request-ID"
const MetadataKey = "x-correlation-id"

type contextKey struct{}

func Valid(id string) bool {
	if len(id) == 0 || len(id) > 64 {
		return false
	}
	for i := 0; i < len(id); i++ {
		c := id[i]
		if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '-' || c == '_') {
			return false
		}
	}
	return true
}

func NewID() (string, error) {
	var raw [16]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(raw[:]), nil
}

func WithID(ctx context.Context, id string) context.Context {
	if !Valid(id) {
		return ctx
	}
	return context.WithValue(ctx, contextKey{}, id)
}

func FromContext(ctx context.Context) string {
	id, _ := ctx.Value(contextKey{}).(string)
	if Valid(id) {
		return id
	}
	return ""
}

type writer struct {
	http.ResponseWriter
	status int
}

func (w *writer) WriteHeader(code int) {
	if w.status == 0 {
		w.status = code
	}
	w.ResponseWriter.WriteHeader(code)
}
func (w *writer) Write(p []byte) (int, error) {
	if w.status == 0 {
		w.status = http.StatusOK
	}
	return w.ResponseWriter.Write(p)
}
func (w *writer) Flush() {
	if f, ok := w.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}
func (w *writer) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	h, ok := w.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, errors.New("hijack unsupported")
	}
	conn, rw, err := h.Hijack()
	if err == nil {
		w.status = http.StatusSwitchingProtocols
	}
	return conn, rw, err
}

// HTTP logs bounded fields only; it never records paths, query strings,
// headers, bodies, player IDs or request IDs used by business operations.
func HTTP(logger *slog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.Header.Get(Header)
		if !Valid(id) || len(r.Header.Values(Header)) != 1 {
			var err error
			id, err = NewID()
			if err != nil {
				http.Error(w, "SERVICE_UNAVAILABLE", http.StatusServiceUnavailable)
				return
			}
		}
		w.Header().Set(Header, id)
		started := time.Now()
		logger.Info("http request started", "correlation_id", id, "method", r.Method)
		tracked := &writer{ResponseWriter: w}
		next.ServeHTTP(tracked, r.WithContext(WithID(r.Context(), id)))
		status := tracked.status
		if status == 0 {
			status = http.StatusOK
		}
		logger.Info("http request completed", "correlation_id", id, "method", r.Method, "status", status, "latency_ms", time.Since(started).Milliseconds())
	})
}

// UnaryClientInterceptor attaches the correlation ID to every Player/Profile
// RPC. Background operations without an HTTP request receive a fresh ID.
func UnaryClientInterceptor(ctx context.Context, method string, req, reply any, cc *grpc.ClientConn, invoke grpc.UnaryInvoker, opts ...grpc.CallOption) error {
	id := FromContext(ctx)
	if id == "" {
		var err error
		id, err = NewID()
		if err != nil {
			return err
		}
	}
	md, _ := metadata.FromOutgoingContext(ctx)
	md = md.Copy()
	md.Set(MetadataKey, id)
	ctx = metadata.NewOutgoingContext(ctx, md)
	return invoke(ctx, method, req, reply, cc, opts...)
}
