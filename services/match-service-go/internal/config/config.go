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
	HTTPAddr                 string
	PlayerProfileGRPCAddr    string
	DatabaseURL              string
	LogLevel                 slog.Level
	ShutdownTimeout          time.Duration
	RoomCommandQueueCapacity int
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
