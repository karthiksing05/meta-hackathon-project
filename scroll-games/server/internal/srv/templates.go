package srv

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"unicode"
)

var genericDistractors = []string{"A rooftop view at night", "A crowded market stall", "A quiet beach at dawn", "A street musician playing"}

// Theme enums of feel.theme (spec/concepts.json).
var (
	themePalettes = []string{"sunset", "ocean", "forest", "midnight", "candy", "mono"}
	themeMoods    = []string{"playful", "calm", "intense", "cozy", "mysterious"}
	moodAliases   = map[string]string{"chill": "calm", "relaxed": "calm", "spooky": "mysterious", "mystery": "mysterious",
		"energetic": "intense", "hype": "intense", "funny": "playful", "fun": "playful", "warm": "cozy"}
	moodPalettes = map[string]string{"playful": "sunset", "calm": "ocean", "intense": "midnight", "cozy": "candy", "mysterious": "midnight"}
)

// Brief is the creator-facing, editable plan for a game (spec/brief.schema.json; the
// last four fields are optional extensions the schema also declares).
type Brief struct {
	Intent        string        `json:"intent"`
	Audience      string        `json:"audience"`
	Mood          string        `json:"mood"`
	Energy        int           `json:"energy"`
	Competition   string        `json:"competition"`
	ContentSource ContentSource `json:"content_source"`
	Limits        BriefLimits   `json:"limits"`
	TitleIdea     string        `json:"title_idea"`
	Template      string        `json:"template"`
	Level         string        `json:"level"`
	GlueIdeas     []string      `json:"glue_ideas"`
	Tone          string        `json:"tone,omitempty"`
	Difficulty    string        `json:"difficulty,omitempty"`
	Palette       string        `json:"palette,omitempty"`
	Emoji         string        `json:"emoji,omitempty"`
}

type ContentSource struct {
	MediaIDs []string `json:"media_ids"`
	GroupID  *string  `json:"group_id"`
}

type BriefLimits struct {
	DurationS int `json:"duration_s"`
	Rounds    int `json:"rounds"`
}

// DecodeBrief parses a client-edited brief, tolerating numbers sent as strings and unusable numeric text
// (dropped so Normalize applies the default).
func DecodeBrief(raw json.RawMessage) (Brief, error) {
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		return Brief{}, err
	}
	coerce := func(obj map[string]any, key string) {
		v, ok := obj[key]
		if !ok {
			return
		}
		switch n := v.(type) {
		case float64:
		case string:
			if f, err := strconv.ParseFloat(strings.TrimSpace(n), 64); err == nil {
				obj[key] = f
			} else {
				delete(obj, key)
			}
		default:
			delete(obj, key)
		}
	}
	coerce(m, "energy")
	if lim, ok := m["limits"].(map[string]any); ok {
		coerce(lim, "rounds")
		coerce(lim, "duration_s")
	} else if ok := m["limits"] != nil; ok {
		delete(m, "limits")
	}
	fixed, _ := json.Marshal(m)
	var b Brief
	err := json.Unmarshal(fixed, &b)
	return b, err
}

func clampInt(v, lo, hi, def int) int {
	if v == 0 {
		return def
	}
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func oneOf(v string, allowed []string, def string) string {
	for _, a := range allowed {
		if v == a {
			return v
		}
	}
	return def
}

// Normalize fills defaults and clamps values; server-known media wins over model output.
func (b *Brief) Normalize(level string, media []Media) {
	b.Template = "quiz"
	b.Level = oneOf(level, []string{"remix", "compose", "free"}, "remix")
	b.TitleIdea = truncate(strings.TrimSpace(b.TitleIdea), 60)
	if b.TitleIdea == "" {
		b.TitleIdea = "Scroll Quiz"
	}
	b.Intent = truncate(strings.TrimSpace(b.Intent), 240)
	if b.Intent == "" {
		b.Intent = "A quick quiz"
	}
	if strings.TrimSpace(b.Audience) == "" {
		b.Audience = "friends"
	}
	b.Mood = strings.ToLower(truncate(strings.TrimSpace(b.Mood), 30))
	if b.Mood == "" {
		b.Mood = "playful"
	}
	b.Energy = clampInt(b.Energy, 1, 5, 3)
	b.Competition = oneOf(b.Competition, []string{"solo", "versus", "daily"}, "versus")
	b.Limits.Rounds = clampInt(b.Limits.Rounds, 3, 10, 6)
	b.Limits.DurationS = clampInt(b.Limits.DurationS, 10, 600, b.Limits.Rounds*10)
	b.Difficulty = oneOf(b.Difficulty, []string{"easy", "medium", "hard"}, "medium")
	if strings.TrimSpace(b.Tone) == "" {
		b.Tone = "friendly"
	}
	b.Palette = oneOf(b.Palette, themePalettes, "")
	if b.Emoji == "" {
		b.Emoji = "🎮"
	}
	ids := make([]string, 0, len(media))
	for _, m := range media {
		ids = append(ids, m.ID)
	}
	b.ContentSource.MediaIDs = ids
	b.ContentSource.GroupID = nil
	if len(media) > 0 && media[0].GroupID != "" {
		g := media[0].GroupID
		b.ContentSource.GroupID = &g
	}
	var ideas []string
	for _, g := range b.GlueIdeas {
		if g = truncate(strings.TrimSpace(g), 200); g != "" && len(ideas) < 3 {
			ideas = append(ideas, g)
		}
	}
	if ideas == nil {
		ideas = []string{}
	}
	b.GlueIdeas = ideas
}

func (b Brief) SeedScope() string {
	if b.Competition == "daily" {
		return "daily"
	}
	return "per_challenge"
}

// RoundMS is the per-round time implied by the duration and round limits.
func (b Brief) RoundMS() int {
	return clampInt(b.Limits.DurationS*1000/b.Limits.Rounds, 2000, 60000, 10000)
}

// ThemeMood maps the free-form brief mood onto the feel.theme enum.
func (b Brief) ThemeMood() string {
	if a, ok := moodAliases[b.Mood]; ok {
		return a
	}
	return oneOf(b.Mood, themeMoods, "playful")
}

func (b Brief) ThemePalette() string {
	if b.Palette != "" {
		return b.Palette
	}
	return moodPalettes[b.ThemeMood()]
}

func titleCase(s string) string {
	words := strings.Fields(s)
	for i, w := range words {
		r := []rune(w)
		r[0] = unicode.ToUpper(r[0])
		words[i] = string(r)
	}
	return strings.Join(words, " ")
}

// TemplateBrief builds a deterministic brief from the prompt alone.
func TemplateBrief(prompt, level string, media []Media) Brief {
	p := strings.TrimSpace(prompt)
	low := strings.ToLower(p)
	if i := strings.Index(low, " about "); i >= 0 {
		p = strings.TrimSpace(p[i+len(" about "):])
		low = strings.ToLower(p)
	}
	p = strings.TrimRight(p, ".!? ")
	words := strings.Fields(p)
	if len(words) > 6 {
		words = words[:6]
	}
	title := titleCase(strings.Join(words, " "))
	if title == "" {
		title = "Mystery"
	}
	if !strings.Contains(low, "quiz") && !strings.Contains(low, "trivia") {
		title += " Trivia"
	}
	b := Brief{
		Intent:      strings.TrimSpace(prompt),
		TitleIdea:   title,
		Tone:        "friendly",
		Competition: "versus",
		GlueIdeas:   []string{"The final round is worth double points."},
	}
	if len(media) > 0 {
		b.Emoji = "📸"
		b.Limits.Rounds = len(media)
	}
	b.Normalize(level, media)
	return b
}

// readSpecFile returns the contents of a spec file, or the fallback when it is unreadable or not JSON.
func (a *App) readSpecFile(rel, fallback string) []byte {
	raw, err := os.ReadFile(filepath.Join(a.cfg.SpecDir, rel))
	if err != nil || !json.Valid(raw) {
		return []byte(fallback)
	}
	return raw
}

func (a *App) quizManifestTemplate() []byte {
	return a.readSpecFile("templates/quiz.manifest.json", embeddedQuizManifest)
}

// templateManifest customizes the pre-baked quiz manifest with the brief.
func (a *App) templateManifest(b Brief) json.RawMessage {
	var m map[string]any
	_ = json.Unmarshal(a.quizManifestTemplate(), &m)
	m["title"] = b.TitleIdea
	m["description"] = truncate(b.Intent, 90)
	m["level"] = b.Level
	m["template"] = "quiz"
	m["seed_scope"] = b.SeedScope()
	theme := map[string]any{"palette": b.ThemePalette(), "mood": b.ThemeMood(), "emoji": b.Emoji}
	m["theme"] = theme
	concepts, _ := m["concepts"].([]any)
	for _, c := range concepts {
		cm, _ := c.(map[string]any)
		params, _ := cm["params"].(map[string]any)
		if params == nil {
			params = map[string]any{}
			cm["params"] = params
		}
		switch cm["id"] {
		case "flow.rounds":
			params["rounds"] = b.Limits.Rounds
		case "rule.round_timer":
			params["round_ms"] = b.RoundMS()
		case "feel.theme":
			params["palette"], params["mood"], params["emoji"] = theme["palette"], theme["mood"], theme["emoji"]
		case "share.score_card":
			params["headline"] = truncate(b.TitleIdea, 40)
		}
	}
	out, _ := json.Marshal(m)
	return out
}

// templateContent builds deterministic photo-caption questions when media is available, else the template content.
func (a *App) templateContent(b Brief, media []Media) json.RawMessage {
	if len(media) >= 3 {
		return captionContent(media, b.Limits.Rounds)
	}
	return a.readSpecFile("templates/trip-trivia.content.json", embeddedQuizContent)
}

func captionContent(media []Media, rounds int) json.RawMessage {
	pool := make([]string, 0, len(media)+len(genericDistractors))
	for _, m := range media {
		pool = append(pool, m.Caption)
	}
	pool = append(pool, genericDistractors...)
	n := len(media)
	if rounds > 0 && rounds < n {
		n = rounds
	}
	items := make([]map[string]any, 0, n)
	for i := 0; i < n; i++ {
		m := media[i]
		wrong := []string{}
		for j := 1; len(wrong) < 3 && j < len(pool)+1; j++ {
			c := pool[(i+j)%len(pool)]
			if c != m.Caption {
				wrong = append(wrong, c)
			}
		}
		ans := i % 4
		choices := make([]string, 0, 4)
		wi := 0
		for k := 0; k < 4; k++ {
			if k == ans {
				choices = append(choices, m.Caption)
			} else {
				choices = append(choices, wrong[wi])
				wi++
			}
		}
		items = append(items, map[string]any{
			"id": fmt.Sprintf("q%d", i+1), "kind": "question", "prompt": "Which caption matches this photo?",
			"media_id": m.ID, "media_url": m.URL, "choices": choices, "answer": ans, "clue": "Look at the details.",
		})
	}
	out, _ := json.Marshal(map[string]any{
		"schema": "sg.content/1", "items": items,
		"copy": map[string]string{"intro": "How well do you remember?", "win": "Nailed it!", "lose": "Good try, go again!"},
	})
	return out
}

// Catalog digest ---------------------------------------------------------

type concept struct {
	ID       string                    `json:"id"`
	Summary  string                    `json:"summary"`
	Status   string                    `json:"status"`
	Params   map[string]map[string]any `json:"params"`
	Consumes []string                  `json:"consumes"`
	Emits    []string                  `json:"emits"`
	Requires []string                  `json:"requires"`
}

func paramDigest(name string, p map[string]any) string {
	typ, _ := p["type"].(string)
	var s string
	if vals, ok := p["values"].([]any); ok {
		parts := make([]string, len(vals))
		for i, v := range vals {
			parts[i] = fmt.Sprint(v)
		}
		s = name + "=" + strings.Join(parts, "|") + " (default " + fmt.Sprint(p["default"]) + ")"
	} else {
		s = fmt.Sprintf("%s:%s default %v", name, typ, p["default"])
		if lo, ok := p["min"]; ok {
			s += fmt.Sprintf(" range %v..%v", lo, p["max"])
		}
	}
	return s
}

// BuildCatalogDigest returns the compact catalog the planner sees: only implemented concepts
// (stubs are inert and would break event wiring), with params, ranges, requires and event wiring.
func BuildCatalogDigest(specDir string) string {
	var cs []concept
	if raw, err := os.ReadFile(filepath.Join(specDir, "concepts.json")); err == nil {
		_ = json.Unmarshal(raw, &cs)
	}
	var lines []string
	stubs := 0
	for _, c := range cs {
		if c.Status != "implemented" {
			stubs++
			continue
		}
		line := c.ID + ": " + c.Summary
		if len(c.Params) > 0 {
			names := make([]string, 0, len(c.Params))
			for k := range c.Params {
				names = append(names, k)
			}
			sort.Strings(names)
			ps := make([]string, len(names))
			for i, n := range names {
				ps[i] = paramDigest(n, c.Params[n])
			}
			line += " PARAMS " + strings.Join(ps, "; ")
		}
		if len(c.Requires) > 0 {
			line += " REQUIRES " + strings.Join(c.Requires, ",")
		}
		line += " CONSUMES " + strings.Join(c.Consumes, ",") + " EMITS " + strings.Join(c.Emits, ",")
		lines = append(lines, line)
	}
	if len(lines) == 0 {
		return ""
	}
	return strings.Join(lines, "\n") + fmt.Sprintf("\n(%d other catalog ids are inert stubs; never use them.)", stubs)
}
