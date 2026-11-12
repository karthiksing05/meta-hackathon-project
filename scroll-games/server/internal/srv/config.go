package srv

import (
	"bufio"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// Config holds all runtime settings; tests override timeouts and URLs.
type Config struct {
	Addr              string
	DataDir           string
	PlayerDir         string
	MediaDir          string // generated demo photos served at /media/
	SpecDir           string
	SgtoolPath        string
	MuseBaseURL       string
	MuseKey           string
	CapUSD            float64
	BriefTimeout      time.Duration
	PlanTimeout       time.Duration
	ContentTimeout    time.Duration
	RepairTimeout     time.Duration
	ModerationTimeout time.Duration
	BriefModel        string // model for POST /api/briefs
	PlanReasoning     string // reasoning_effort for the Wonder plan call
	PlanMaxTokens     int
	Speculate         bool // start generation as soon as a brief is returned
}

// DefaultConfig returns the contract defaults (paths relative to scroll-games/server).
func DefaultConfig() Config {
	capUSD := 15.0
	if v, err := strconv.ParseFloat(os.Getenv("SG_SPEND_CAP_USD"), 64); err == nil && v >= 0 {
		capUSD = v
	}
	return Config{
		Addr:              ":8787",
		DataDir:           "data",
		PlayerDir:         "../player",
		MediaDir:          "static/media",
		SpecDir:           "../spec",
		SgtoolPath:        "../runtime/target/release/sgtool",
		MuseBaseURL:       "https://api.meta.ai/v1",
		CapUSD:            capUSD,
		BriefTimeout:      12 * time.Second,
		PlanTimeout:       60 * time.Second,
		ContentTimeout:    60 * time.Second,
		RepairTimeout:     60 * time.Second,
		ModerationTimeout: 20 * time.Second,
		BriefModel:        briefModelFromEnv(),
		PlanReasoning:     envOr("SG_PLAN_REASONING", "minimal"),
		PlanMaxTokens:     2000,
		Speculate:         os.Getenv("SG_SPECULATE") != "0",
	}
}

// LoadDotenvKey finds MUSE_API_KEY in the environment or the nearest .env
// above the working directory (or at the explicit path). The value is never logged.
func LoadDotenvKey(explicit string) string {
	if v := os.Getenv("MUSE_API_KEY"); v != "" {
		return v
	}
	var candidates []string
	if explicit != "" {
		candidates = append(candidates, explicit)
	} else if wd, err := os.Getwd(); err == nil {
		dir := wd
		for i := 0; i < 6; i++ {
			candidates = append(candidates, filepath.Join(dir, ".env"))
			dir = filepath.Dir(dir)
		}
	}
	for _, p := range candidates {
		if v := parseDotenv(p, "MUSE_API_KEY"); v != "" {
			return v
		}
	}
	return ""
}

func parseDotenv(path, key string) string {
	f, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		line = strings.TrimPrefix(line, "export ")
		k, v, ok := strings.Cut(line, "=")
		if !ok || strings.TrimSpace(k) != key {
			continue
		}
		return strings.Trim(strings.TrimSpace(v), `"'`)
	}
	return ""
}

func envOr(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}

func briefModelFromEnv() string {
	if os.Getenv("SG_BRIEF_MODEL") == "wonder" {
		return ModelWonder
	}
	return ModelEmber
}
