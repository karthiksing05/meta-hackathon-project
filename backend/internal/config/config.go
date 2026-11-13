// Package config reads all runtime configuration from environment variables.
// Secrets (Mongo URI, JWT secret) are never baked into images; they arrive via env at run time.
package config

import (
	"encoding/base64"
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
	// Uploads to make games from (POST /v1/media), kept in <GamesRoot>/media: per person, MEDIA_MAX_ITEMS items
	// and MEDIA_MAX_MB megabytes in all.
	MediaMaxItems int
	MediaMaxMB    int64

	// Game generation. The API never talks to Muse: it calls the generator service, which holds the key.
	GeneratorURL       string // empty turns generation off
	GenerateConcurrent int    // jobs running at once, across everyone
	GeneratePerHour    int    // jobs one person may start per hour
	// HarnessContext runs the game-making harness (internal/harness) before each new game and turns on
	// POST /v1/harness/plan. On by default; HARNESS_CONTEXT=0 (or off) is the kill switch.
	HarnessContext bool
	// DebugDelete (DEBUG_DELETE=1) allows deleting a game with no sign-in through the debug viewer. Off by default.
	DebugDelete bool
	// SponsorUsers are the brand accounts (SPONSOR_USERS, comma separated, lowercase) that may mark a game sponsored.
	SponsorUsers map[string]bool

	// APNs (lock-screen notifications). All four are needed; without them the inbox still works and no push is sent.
	// The .p8 key is given as APNS_KEY_P8_B64 (base64 of the PEM, one line) or APNS_KEY_P8 (the PEM itself).
	// viral_match (see internal/api/viral.go): VIRAL_MATCH=0 turns it off; the rest tune it.
	ViralOff        bool
	ViralMinPlayers int
	ViralWindow     time.Duration
	ViralCosine     float64
	ViralMinPages   int
	ViralPerDay     int
	ViralInterval   time.Duration

	APNSKeyPEM []byte
	APNSKeyID  string
	APNSTeamID string
	APNSTopic  string // the app's bundle id

	// Ranking (game-recs.js). RecsRuntimes is how many recommender runtimes run at once (0 turns ranking off).
	// RecsInterleave is "" (off), "baseline", or a variant name such as "noBait": mixes each feed with a control.
	RecsRuntimes   int
	RecsInterleave string
	// FeedExplore (FEED_EXPLORE, 0 to 1, default 0.15) is the share of regular feed slots given to a random
	// eligible game. Set to 0 to turn exploration off (stored as -1, since the API reads 0 as the default).
	FeedExplore float64
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

		MediaMaxItems: int(envInt("MEDIA_MAX_ITEMS", 40)),
		MediaMaxMB:    envInt("MEDIA_MAX_MB", 400),

		GeneratorURL:       strings.TrimRight(os.Getenv("GENERATOR_URL"), "/"),
		GenerateConcurrent: int(envInt("GENERATE_CONCURRENT", 2)),
		GeneratePerHour:    int(envInt("GENERATE_PER_HOUR", 6)),
		HarnessContext:     harnessOn(os.Getenv("HARNESS_CONTEXT")),
		DebugDelete:        flagOn(os.Getenv("DEBUG_DELETE")),
		SponsorUsers:       usernameSet(os.Getenv("SPONSOR_USERS")),
		ViralOff:           offFlag(os.Getenv("VIRAL_MATCH")),
		ViralMinPlayers:    int(envInt("VIRAL_MIN_PLAYERS", 100)),
		ViralWindow:        envDur("VIRAL_WINDOW", 24*time.Hour),
		ViralCosine:        envFloat("VIRAL_COSINE", 0.85),
		ViralMinPages:      int(envInt("VIRAL_MIN_PAGES", 5)),
		ViralPerDay:        int(envInt("VIRAL_PER_DAY", 1)),
		ViralInterval:      envDur("VIRAL_INTERVAL", 10*time.Minute),
		APNSKeyPEM:         apnsKey(os.Getenv("APNS_KEY_P8_B64"), os.Getenv("APNS_KEY_P8")),
		APNSKeyID:          strings.TrimSpace(os.Getenv("APNS_KEY_ID")),
		APNSTeamID:         strings.TrimSpace(os.Getenv("APNS_TEAM_ID")),
		APNSTopic:          strings.TrimSpace(os.Getenv("APNS_TOPIC")),

		RecsRuntimes:   int(envInt("RECS_RUNTIMES", 2)),
		RecsInterleave: os.Getenv("RECS_INTERLEAVE"),
	}
	c.FeedExplore = feedExplore(os.Getenv("FEED_EXPLORE"))
	if os.Getenv("RECS_RUNTIMES") == "0" {
		c.RecsRuntimes = 0
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

// flagOn reads a switch that is off unless it is "1", "true", "on" or "yes".
func flagOn(v string) bool {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "1", "true", "on", "yes":
		return true
	}
	return false
}

// offFlag is true when a switch is set to 0, off, false or no.
func offFlag(v string) bool {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "0", "off", "false", "no":
		return true
	}
	return false
}

func envFloat(k string, def float64) float64 {
	if f, err := strconv.ParseFloat(strings.TrimSpace(os.Getenv(k)), 64); err == nil && f > 0 {
		return f
	}
	return def
}

// apnsKey reads the .p8 key: base64 of the PEM wins, else the PEM as given (with \n written out as a newline).
func apnsKey(b64, pem string) []byte {
	if b64 = strings.TrimSpace(b64); b64 != "" {
		if raw, err := base64.StdEncoding.DecodeString(b64); err == nil {
			return raw
		}
		return nil
	}
	if pem = strings.TrimSpace(pem); pem != "" {
		return []byte(strings.ReplaceAll(pem, `\n`, "\n"))
	}
	return nil
}

// usernameSet reads a comma-separated list of usernames into a lowercase set.
func usernameSet(v string) map[string]bool {
	out := map[string]bool{}
	for _, u := range strings.Split(v, ",") {
		if u = strings.ToLower(strings.TrimSpace(u)); u != "" {
			out[u] = true
		}
	}
	return out
}

// harnessOn reads HARNESS_CONTEXT: unset or "1" is on; "0", "off" or "false" turns the harness off.
func harnessOn(v string) bool {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "0", "off", "false", "no":
		return false
	}
	return true
}

// feedExplore reads FEED_EXPLORE: "" or a bad value gives the default 0.15, 0 turns exploration off (-1).
func feedExplore(v string) float64 {
	f, err := strconv.ParseFloat(strings.TrimSpace(v), 64)
	switch {
	case err != nil || f < 0 || f > 1:
		return 0.15
	case f == 0:
		return -1
	}
	return f
}
