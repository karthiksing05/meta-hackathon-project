package srv

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"sync"
	"time"
)

// App wires config, storage, Muse, the sgtool wrapper and caches.
type App struct {
	cfg         Config
	store       *Store
	cache       *Cache
	budget      *Budget
	muse        *Muse
	tool        *Tool
	concepts    []concept
	briefSchema map[string]any

	now func() time.Time // injectable clock for the daily game

	jobsMu sync.Mutex
	jobs   map[string]*genJob
	recent map[string]recentGen // finished runs that were not cached (fallbacks), joinable for a short while
}

// recentGen is a finished generation kept briefly so a Generate that follows the speculative run reuses it.
type recentGen struct {
	out genOut
	at  time.Time
}

// recentTTL is how long an uncached finished run stays joinable.
const recentTTL = 2 * time.Minute

func NewApp(cfg Config) *App {
	_ = os.MkdirAll(cfg.DataDir, 0o755)
	a := &App{cfg: cfg, jobs: map[string]*genJob{}, recent: map[string]recentGen{}, now: time.Now}
	a.budget = NewBudget(cfg.DataDir+"/usage.json", cfg.CapUSD)
	a.muse = NewMuse(cfg, a.budget)
	a.tool = &Tool{Path: cfg.SgtoolPath}
	a.cache = OpenCache(cfg.DataDir)
	a.concepts = loadConcepts(cfg.SpecDir)
	a.briefSchema = LoadBriefSchema(cfg.SpecDir)
	mediaDir = cfg.MediaDir
	st, fresh := OpenStore(cfg.DataDir)
	a.store = st
	if fresh {
		a.seedStore()
	} else if st.migrateLocalMedia() {
		st.mu.Lock()
		st.saveLocked()
		st.mu.Unlock()
	}
	return a
}

func hashKey(parts ...string) string {
	h := sha256.Sum256([]byte(strings.Join(parts, "|")))
	return hex.EncodeToString(h[:])
}

func (a *App) mediaByIDs(ids []string) []Media {
	a.store.mu.RLock()
	defer a.store.mu.RUnlock()
	byID := map[string]Media{}
	for _, m := range a.store.d.Media {
		byID[m.ID] = m
	}
	out := []Media{}
	for _, id := range ids {
		if m, ok := byID[id]; ok {
			out = append(out, m)
		}
	}
	return out
}

// runAcc accumulates cost across the Muse calls of one generation.
type runAcc struct {
	mu         sync.Mutex
	cost       float64
	prompt     int
	completion int
	notes      []string
}

func (r *runAcc) add(res *ChatResult, err error, label string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if res != nil {
		r.cost += res.CostUSD
		r.prompt += res.PromptTokens
		r.completion += res.CompletionTokens
	}
	if err != nil {
		r.notes = append(r.notes, label+": "+err.Error())
	}
}

func (r *runAcc) note(s string) {
	r.mu.Lock()
	r.notes = append(r.notes, s)
	r.mu.Unlock()
}

// ---- Brief ----------------------------------------------------------------

type BriefReq struct {
	Prompt   string   `json:"prompt"`
	MediaIDs []string `json:"media_ids"`
	Level    string   `json:"level"`
	OptIn    bool     `json:"opt_in_personal_media"`
}

type BriefResp struct {
	Brief  Brief  `json:"brief"`
	MS     int64  `json:"ms"`
	Cached bool   `json:"cached"`
	Source string `json:"source"`
}

func (a *App) MakeBrief(ctx context.Context, req BriefReq) BriefResp {
	t0 := time.Now()
	media := a.mediaByIDs(req.MediaIDs)
	ids := make([]string, len(media))
	for i, m := range media {
		ids[i] = m.ID
	}
	level := oneOf(req.Level, []string{"remix", "compose", "free"}, "remix")
	key := "brief2:" + hashKey(req.Prompt, strings.Join(ids, ","), level)
	if raw, ok := a.cache.Get(key); ok {
		var b Brief
		if json.Unmarshal(raw, &b) == nil {
			a.speculate(b, media)
			return BriefResp{Brief: b, MS: time.Since(t0).Milliseconds(), Cached: true, Source: "muse"}
		}
	}
	source := "fallback"
	brief := TemplateBrief(req.Prompt, level, media)

	var user strings.Builder
	fmt.Fprintf(&user, "Idea: %s\nLevel: %s\n", req.Prompt, level)
	for _, m := range media {
		fmt.Fprintf(&user, "Photo %s: %s\n", m.ID, m.Caption)
	}
	bctx, cancel := context.WithTimeout(ctx, a.cfg.BriefTimeout)
	defer cancel()
	res, err := a.muse.Chat(bctx, ChatReq{Model: a.cfg.BriefModel, Purpose: "brief", System: briefSystem, User: user.String(),
		MaxTokens: 700, SchemaName: "brief", Schema: a.briefSchema, Reasoning: "minimal"})
	if err == nil {
		var parsed Brief
		if obj, jerr := ExtractJSONObject(res.Content); jerr == nil && json.Unmarshal(obj, &parsed) == nil && strings.TrimSpace(parsed.TitleIdea) != "" {
			parsed.Normalize(level, media)
			brief, source = parsed, "muse"
			a.cache.Put(key, brief)
			a.speculate(brief, media)
		}
	} else if errors.Is(err, ErrBudget) {
		source = "fallback-budget"
	}
	return BriefResp{Brief: brief, MS: time.Since(t0).Milliseconds(), Source: source}
}

func fallbackSource(err error) string {
	if errors.Is(err, ErrBudget) {
		return "fallback-budget"
	}
	return "fallback"
}

// PrewarmMuse opens a pooled connection to Muse in the background.
func (a *App) PrewarmMuse() {
	if !a.muse.Configured() {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	a.muse.Prewarm(ctx)
}
