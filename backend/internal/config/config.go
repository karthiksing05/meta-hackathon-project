// Package config reads all runtime configuration from environment variables.
// Secrets (Mongo URI, JWT secret) are never baked into images; they arrive via env at run time.
package config

import (
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Addr         string // API listen address
	Store        string // "mongo" or "memory" (memory is for local dev and tests only)
	MongoURI     string
	MongoDB      string
	JWTSecret    []byte
	AccessTTL    time.Duration
	RefreshTTL   time.Duration
	GamesRoot    string // holds tmp/, published/ and private/
	GamesBaseURL string // public origin of the static server, no trailing slash
	CORSOrigins  []string
	MaxUploadMB  int64
	MaxUnpackMB  int64

	// Game generation. The API never talks to Muse: it calls the generator service, which holds the key.
	GeneratorURL       string // empty turns generation off
	GenerateConcurrent int    // jobs running at once, across everyone
	GeneratePerHour    int    // jobs one person may start per hour
}

func Load() (*Config, error) {
	c := &Config{
		Addr:         env("API_ADDR", ":8080"),
		Store:        env("STORE", "mongo"),
		MongoURI:     os.Getenv("MONGO_URI"),
		MongoDB:      env("MONGO_DB", "bubbles"),
		JWTSecret:    []byte(os.Getenv("JWT_SECRET")),
		AccessTTL:    envDur("ACCESS_TTL", 15*time.Minute),
		RefreshTTL:   envDur("REFRESH_TTL", 30*24*time.Hour),
		GamesRoot:    env("GAMES_ROOT", "./data/games"),
		GamesBaseURL: strings.TrimRight(env("GAMES_BASE_URL", "http://localhost:8081"), "/"),
		MaxUploadMB:  envInt("MAX_UPLOAD_MB", 50),
		MaxUnpackMB:  envInt("MAX_UNPACKED_MB", 200),

		GeneratorURL:       strings.TrimRight(os.Getenv("GENERATOR_URL"), "/"),
		GenerateConcurrent: int(envInt("GENERATE_CONCURRENT", 2)),
		GeneratePerHour:    int(envInt("GENERATE_PER_HOUR", 6)),
	}
	for _, o := range strings.Split(os.Getenv("CORS_ORIGINS"), ",") {
		if o = strings.TrimSpace(o); o != "" {
			c.CORSOrigins = append(c.CORSOrigins, o)
		}
	}
	if len(c.JWTSecret) < 32 {
		return nil, errors.New("JWT_SECRET must be set and at least 32 bytes")
	}
	switch c.Store {
	case "mongo":
		if c.MongoURI == "" {
			return nil, errors.New("MONGO_URI is required when STORE=mongo")
		}
	case "memory":
	default:
		return nil, fmt.Errorf("unknown STORE %q", c.Store)
	}
	return c, nil
}

func env(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}
func envInt(k string, d int64) int64 {
	if v, err := strconv.ParseInt(os.Getenv(k), 10, 64); err == nil && v > 0 {
		return v
	}
	return d
}
func envDur(k string, d time.Duration) time.Duration {
	if v, err := time.ParseDuration(os.Getenv(k)); err == nil && v > 0 {
		return v
	}
	return d
}
