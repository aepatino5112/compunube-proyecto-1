package config

import (
	"fmt"
	"log/slog"
	"net"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	HTTPAddr                        string
	PlayerProfileGRPCAddr           string
	DatabaseURL                     string
	LogLevel                        slog.Level
	ShutdownTimeout                 time.Duration
	RoomCommandQueueCapacity        int
	MaxActiveRooms                  int
	MaxConnections                  int
	RoomMaxCommandsPerTick          int
	RoomInputSlots                  int
	RoomJumpEdgesPerPlayer          int
	ConnectionInputRate             int
	ConnectionInputBurst            int
	ConnectionSnapshotSlots         int
	ConnectionCriticalQueue         int
	ConnectionEventQueue            int
	ProfileConcurrency              int
	ProfileQueueCapacity            int
	SettlementConcurrency           int
	SettlementQueueCapacity         int
	ProfileJobTimeout               time.Duration
	SettlementJobTimeout            time.Duration
	PlayerProfileCBFailureThreshold int
	PlayerProfileCBOpenDuration     time.Duration
	PlayerProfileCBHalfOpenProbes   int
	PlayerProfileReadMaxRetries     int
	PlayerProfileRetryBase          time.Duration
	PlayerProfileRetryCap           time.Duration
	PublicOrigins                   []string
}

func Load() (Config, error) { return Parse(os.Getenv) }

// Parse accepts an environment lookup so defaults and invalid values can be tested.
func Parse(getenv func(string) string) (Config, error) {
	c := Config{
		HTTPAddr:                 valueOr(getenv("HTTP_ADDR"), "0.0.0.0:8080"),
		PlayerProfileGRPCAddr:    valueOr(getenv("PLAYER_PROFILE_GRPC_ADDR"), "envoy:50051"),
		DatabaseURL:              getenv("DATABASE_URL"),
		LogLevel:                 slog.LevelInfo,
		ShutdownTimeout:          10 * time.Second,
		RoomCommandQueueCapacity: 32,
		MaxActiveRooms:           5, MaxConnections: 20, RoomMaxCommandsPerTick: 16, RoomInputSlots: 4, RoomJumpEdgesPerPlayer: 4,
		ConnectionInputRate: 20, ConnectionInputBurst: 4, ConnectionSnapshotSlots: 1,
		ConnectionCriticalQueue: 16, ConnectionEventQueue: 16,
		ProfileConcurrency: 8, ProfileQueueCapacity: 32, SettlementConcurrency: 4, SettlementQueueCapacity: 64,
		ProfileJobTimeout: 750 * time.Millisecond, SettlementJobTimeout: 2 * time.Second,
		PlayerProfileCBFailureThreshold: 5, PlayerProfileCBOpenDuration: 10 * time.Second, PlayerProfileCBHalfOpenProbes: 1,
		PlayerProfileReadMaxRetries: 1, PlayerProfileRetryBase: 50 * time.Millisecond, PlayerProfileRetryCap: 200 * time.Millisecond,
	}
	if err := validateAddress("HTTP_ADDR", c.HTTPAddr); err != nil {
		return Config{}, err
	}
	if err := validateAddress("PLAYER_PROFILE_GRPC_ADDR", c.PlayerProfileGRPCAddr); err != nil {
		return Config{}, err
	}
	if c.DatabaseURL != "" {
		u, err := url.Parse(c.DatabaseURL)
		if err != nil || u == nil || (u.Scheme != "postgres" && u.Scheme != "postgresql") || u.Hostname() == "" || strings.Trim(u.Path, "/") == "" {
			return Config{}, fmt.Errorf("DATABASE_URL must be a PostgreSQL URL with host and database")
		}
		if u.Port() != "" {
			if err := validatePort(u.Port()); err != nil {
				return Config{}, fmt.Errorf("DATABASE_URL has an invalid port")
			}
		}
	}
	if v := getenv("LOG_LEVEL"); v != "" {
		switch strings.ToUpper(v) {
		case "DEBUG":
			c.LogLevel = slog.LevelDebug
		case "INFO":
			c.LogLevel = slog.LevelInfo
		case "WARN":
			c.LogLevel = slog.LevelWarn
		case "ERROR":
			c.LogLevel = slog.LevelError
		default:
			return Config{}, fmt.Errorf("LOG_LEVEL must be DEBUG, INFO, WARN or ERROR")
		}
	}
	if v := getenv("SHUTDOWN_TIMEOUT"); v != "" {
		d, err := time.ParseDuration(v)
		if err != nil || d <= 0 {
			return Config{}, fmt.Errorf("SHUTDOWN_TIMEOUT must be a positive duration")
		}
		c.ShutdownTimeout = d
	}
	if v := getenv("ROOM_COMMAND_QUEUE_CAPACITY"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 {
			return Config{}, fmt.Errorf("ROOM_COMMAND_QUEUE_CAPACITY must be a positive integer")
		}
		c.RoomCommandQueueCapacity = n
	}
	integers := []struct {
		name   string
		target *int
	}{
		{"MAX_ACTIVE_ROOMS", &c.MaxActiveRooms}, {"MAX_CONNECTIONS", &c.MaxConnections}, {"ROOM_MAX_COMMANDS_PER_TICK", &c.RoomMaxCommandsPerTick},
		{"ROOM_INPUT_SLOTS", &c.RoomInputSlots}, {"ROOM_JUMP_EDGES_PER_PLAYER", &c.RoomJumpEdgesPerPlayer},
		{"CONNECTION_INPUT_RATE", &c.ConnectionInputRate}, {"CONNECTION_INPUT_BURST", &c.ConnectionInputBurst}, {"CONNECTION_SNAPSHOT_SLOTS", &c.ConnectionSnapshotSlots},
		{"CONNECTION_CRITICAL_QUEUE", &c.ConnectionCriticalQueue}, {"CONNECTION_EVENT_QUEUE", &c.ConnectionEventQueue},
		{"PROFILE_CONCURRENCY", &c.ProfileConcurrency}, {"PROFILE_QUEUE_CAPACITY", &c.ProfileQueueCapacity},
		{"SETTLEMENT_CONCURRENCY", &c.SettlementConcurrency}, {"SETTLEMENT_QUEUE_CAPACITY", &c.SettlementQueueCapacity},
		{"PLAYER_PROFILE_CB_FAILURE_THRESHOLD", &c.PlayerProfileCBFailureThreshold}, {"PLAYER_PROFILE_CB_HALF_OPEN_PROBES", &c.PlayerProfileCBHalfOpenProbes},
	}
	for _, item := range integers {
		if v := getenv(item.name); v != "" {
			n, err := strconv.Atoi(v)
			if err != nil || n < 1 {
				return Config{}, fmt.Errorf("%s must be a positive integer", item.name)
			}
			*item.target = n
		}
	}
	for _, item := range []struct {
		name   string
		target *time.Duration
	}{{"PROFILE_JOB_TIMEOUT", &c.ProfileJobTimeout}, {"SETTLEMENT_JOB_TIMEOUT", &c.SettlementJobTimeout},
		{"PLAYER_PROFILE_CB_OPEN_DURATION", &c.PlayerProfileCBOpenDuration}, {"PLAYER_PROFILE_RETRY_BASE", &c.PlayerProfileRetryBase}, {"PLAYER_PROFILE_RETRY_CAP", &c.PlayerProfileRetryCap}} {
		if v := getenv(item.name); v != "" {
			d, err := time.ParseDuration(v)
			if err != nil || d <= 0 {
				return Config{}, fmt.Errorf("%s must be a positive duration", item.name)
			}
			*item.target = d
		}
	}
	if v := getenv("PUBLIC_ORIGINS"); v != "" {
		for _, origin := range strings.Split(v, ",") {
			u, err := url.Parse(strings.TrimSpace(origin))
			if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.Path != "" || u.RawQuery != "" || u.Fragment != "" || u.Host != strings.ToLower(u.Host) {
				return Config{}, fmt.Errorf("PUBLIC_ORIGINS must be comma-separated https origins such as https://10.0.0.5:4173")
			}
			c.PublicOrigins = append(c.PublicOrigins, u.Scheme+"://"+u.Host)
		}
	}
	if c.ConnectionSnapshotSlots != 1 {
		return Config{}, fmt.Errorf("CONNECTION_SNAPSHOT_SLOTS must be 1 for latest-only delivery")
	}
	if v := getenv("PLAYER_PROFILE_READ_MAX_RETRIES"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 0 || n > 1 {
			return Config{}, fmt.Errorf("PLAYER_PROFILE_READ_MAX_RETRIES must be 0 or 1")
		}
		c.PlayerProfileReadMaxRetries = n
	}
	if c.PlayerProfileCBHalfOpenProbes != 1 {
		return Config{}, fmt.Errorf("PLAYER_PROFILE_CB_HALF_OPEN_PROBES must be 1")
	}
	if c.PlayerProfileRetryCap < c.PlayerProfileRetryBase {
		return Config{}, fmt.Errorf("PLAYER_PROFILE_RETRY_CAP must be >= PLAYER_PROFILE_RETRY_BASE")
	}
	return c, nil
}

func valueOr(v, fallback string) string {
	if v == "" {
		return fallback
	}
	return v
}

func validateAddress(key, address string) error {
	_, port, err := net.SplitHostPort(address)
	if err != nil || validatePort(port) != nil {
		return fmt.Errorf("%s must be a host:port address", key)
	}
	return nil
}

func validatePort(port string) error {
	n, err := strconv.Atoi(port)
	if err != nil || n < 1 || n > 65535 {
		return fmt.Errorf("invalid port")
	}
	return nil
}
