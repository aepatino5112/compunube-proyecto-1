package config

import (
	"log/slog"
	"strings"
	"testing"
	"time"
)

func from(values map[string]string) func(string) string {
	return func(key string) string { return values[key] }
}

func TestParseDefaultsAndOverrides(t *testing.T) {
	cfg, err := Parse(from(nil))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.HTTPAddr != "0.0.0.0:8080" || cfg.PlayerProfileGRPCAddr != "envoy:50051" || cfg.DatabaseURL != "" || cfg.LogLevel != slog.LevelInfo || cfg.ShutdownTimeout != 10*time.Second {
		t.Fatalf("unexpected defaults: %+v", cfg)
	}
	cfg, err = Parse(from(map[string]string{
		"HTTP_ADDR": "127.0.0.1:9090", "PLAYER_PROFILE_GRPC_ADDR": "proxy:50051",
		"DATABASE_URL": "postgres://user:secret@db:5432/match", "LOG_LEVEL": "debug", "SHUTDOWN_TIMEOUT": "250ms",
	}))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.HTTPAddr != "127.0.0.1:9090" || cfg.PlayerProfileGRPCAddr != "proxy:50051" || cfg.LogLevel != slog.LevelDebug || cfg.ShutdownTimeout != 250*time.Millisecond {
		t.Fatalf("unexpected overrides: %+v", cfg)
	}
}

func TestParseRejectsInvalidWithoutLeakingSecrets(t *testing.T) {
	for _, tc := range []struct {
		name   string
		values map[string]string
	}{
		{"http", map[string]string{"HTTP_ADDR": "broken"}},
		{"grpc", map[string]string{"PLAYER_PROFILE_GRPC_ADDR": "rust-host"}},
		{"database", map[string]string{"DATABASE_URL": "postgres://user:secret@/db"}},
		{"database port", map[string]string{"DATABASE_URL": "postgres://user:secret@db:abc/match"}},
		{"log", map[string]string{"LOG_LEVEL": "TRACE"}},
		{"timeout", map[string]string{"SHUTDOWN_TIMEOUT": "-2s"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := Parse(from(tc.values))
			if err == nil || strings.Contains(err.Error(), "secret") {
				t.Fatalf("expected safe validation error, got %v", err)
			}
		})
	}
}
