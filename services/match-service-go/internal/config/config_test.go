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
	if cfg.HTTPAddr != "0.0.0.0:8080" || cfg.PlayerProfileGRPCAddr != "envoy:50051" || cfg.DatabaseURL != "" || cfg.LogLevel != slog.LevelInfo || cfg.ShutdownTimeout != 10*time.Second || cfg.RoomCommandQueueCapacity != 32 {
		t.Fatalf("unexpected defaults: %+v", cfg)
	}
	if cfg.MaxActiveRooms != 5 || cfg.MaxConnections != 20 || cfg.RoomMaxCommandsPerTick != 16 || cfg.RoomInputSlots != 4 || cfg.RoomJumpEdgesPerPlayer != 4 || cfg.ConnectionInputRate != 20 || cfg.ConnectionInputBurst != 4 || cfg.ConnectionSnapshotSlots != 1 || cfg.ConnectionCriticalQueue != 16 || cfg.ConnectionEventQueue != 16 || cfg.ProfileConcurrency != 8 || cfg.ProfileQueueCapacity != 32 || cfg.SettlementConcurrency != 4 || cfg.SettlementQueueCapacity != 64 || cfg.ProfileJobTimeout != 750*time.Millisecond || cfg.SettlementJobTimeout != 2*time.Second {
		t.Fatalf("E39 defaults: %+v", cfg)
	}
	cfg, err = Parse(from(map[string]string{
		"HTTP_ADDR": "127.0.0.1:9090", "PLAYER_PROFILE_GRPC_ADDR": "proxy:50051",
		"DATABASE_URL": "postgres://user:secret@db:5432/match", "LOG_LEVEL": "debug", "SHUTDOWN_TIMEOUT": "250ms", "ROOM_COMMAND_QUEUE_CAPACITY": "8",
	}))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.HTTPAddr != "127.0.0.1:9090" || cfg.PlayerProfileGRPCAddr != "proxy:50051" || cfg.LogLevel != slog.LevelDebug || cfg.ShutdownTimeout != 250*time.Millisecond || cfg.RoomCommandQueueCapacity != 8 {
		t.Fatalf("unexpected overrides: %+v", cfg)
	}
	if cfg.RoomResultsLobbyDelay != 10*time.Second {
		t.Fatalf("RF-035 default: %v", cfg.RoomResultsLobbyDelay)
	}
	cfg, err = Parse(from(map[string]string{"MAX_ACTIVE_ROOMS": "7", "MAX_CONNECTIONS": "30", "PROFILE_CONCURRENCY": "2", "SETTLEMENT_QUEUE_CAPACITY": "3", "PROFILE_JOB_TIMEOUT": "400ms", "ROOM_RESULTS_LOBBY_DELAY": "3s"}))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.MaxActiveRooms != 7 || cfg.MaxConnections != 30 || cfg.ProfileConcurrency != 2 || cfg.SettlementQueueCapacity != 3 || cfg.ProfileJobTimeout != 400*time.Millisecond || cfg.RoomResultsLobbyDelay != 3*time.Second {
		t.Fatalf("E39 overrides: %+v", cfg)
	}
}

func TestParsePublicOrigins(t *testing.T) {
	cfg, err := Parse(from(map[string]string{"PUBLIC_ORIGINS": "https://10.0.0.5:4173, https://lab.local"}))
	if err != nil || len(cfg.PublicOrigins) != 2 || cfg.PublicOrigins[0] != "https://10.0.0.5:4173" || cfg.PublicOrigins[1] != "https://lab.local" {
		t.Fatalf("public origins: %v %v", cfg.PublicOrigins, err)
	}
	for _, bad := range []string{"http://10.0.0.5:4173", "https://10.0.0.5:4173/", "https://user@lab", "lab:4173", "https://LAB.local"} {
		if _, err := Parse(from(map[string]string{"PUBLIC_ORIGINS": bad})); err == nil {
			t.Fatalf("accepted %q", bad)
		}
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
		{"room queue", map[string]string{"ROOM_COMMAND_QUEUE_CAPACITY": "0"}},
		{"room limit", map[string]string{"MAX_ACTIVE_ROOMS": "0"}},
		{"snapshot slots", map[string]string{"CONNECTION_SNAPSHOT_SLOTS": "2"}},
		{"profile deadline", map[string]string{"PROFILE_JOB_TIMEOUT": "invalid"}},
		{"cb threshold", map[string]string{"PLAYER_PROFILE_CB_FAILURE_THRESHOLD": "0"}},
		{"cb probes", map[string]string{"PLAYER_PROFILE_CB_HALF_OPEN_PROBES": "2"}},
		{"read retries", map[string]string{"PLAYER_PROFILE_READ_MAX_RETRIES": "-1"}},
		{"retry cap", map[string]string{"PLAYER_PROFILE_RETRY_CAP": "1ms"}},
		{"results lobby delay", map[string]string{"ROOM_RESULTS_LOBBY_DELAY": "0s"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := Parse(from(tc.values))
			if err == nil || strings.Contains(err.Error(), "secret") {
				t.Fatalf("expected safe validation error, got %v", err)
			}
		})
	}
}
