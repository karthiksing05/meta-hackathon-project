package srv

import (
	"context"
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
	b.Template = pickGenre(*b)
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

// templateManifest customizes the pre-baked manifest of the brief's genre with the brief.
func (a *App) templateManifest(b Brief) json.RawMessage {
	if g := b.Genre(); g != "quiz" {
		if raw, ok := a.genreManifest(b, g); ok {
			return raw
		}
	}
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
	if g := b.Genre(); g != "quiz" {
		if raw, ok := a.genreContent(b, g, media); ok {
			return raw
		}
	}
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

// loadConcepts reads spec/concepts.json; nil when unreadable.
func loadConcepts(specDir string) []concept {
	var cs []concept
	if raw, err := os.ReadFile(filepath.Join(specDir, "concepts.json")); err == nil {
		_ = json.Unmarshal(raw, &cs)
	}
	return cs
}

func conceptLine(c concept, wiring bool) string {
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
	if wiring {
		if len(c.Requires) > 0 {
			line += " REQUIRES " + strings.Join(c.Requires, ",")
		}
		line += " CONSUMES " + strings.Join(c.Consumes, ",") + " EMITS " + strings.Join(c.Emits, ",")
	}
	return line
}

// catalogDigest lists the implemented concepts in `only` (all implemented ones when nil) with params, ranges,
// requires and event wiring. Stubs are left out: they are inert and would break event wiring.
func catalogDigest(cs []concept, only map[string]bool) string {
	var lines []string
	omitted := 0
	for _, c := range cs {
		if c.Status != "implemented" || (only != nil && !only[c.ID]) {
			omitted++
			continue
		}
		lines = append(lines, conceptLine(c, true))
	}
	if len(lines) == 0 {
		return ""
	}
	return strings.Join(lines, "\n") + fmt.Sprintf("\n(%d other catalog ids are omitted; use only the ids listed above.)", omitted)
}

// BuildCatalogDigest returns the compact catalog of every concept some template uses.
func BuildCatalogDigest(specDir string) string {
	used := templateConcepts(specDir)
	if len(used) == 0 {
		used = nil
	}
	return catalogDigest(loadConcepts(specDir), used)
}

// manifestConceptIDs is the set of concept ids a manifest lists.
func manifestConceptIDs(manifest []byte) map[string]bool {
	var m struct {
		Concepts []struct {
			ID string `json:"id"`
		} `json:"concepts"`
	}
	ids := map[string]bool{}
	if json.Unmarshal(manifest, &m) == nil {
		for _, c := range m.Concepts {
			ids[c.ID] = true
		}
	}
	return ids
}

// ---- Genres ----------------------------------------------------------------
//
// Every genre is a pair of files in spec/templates: <genre>.manifest.json and <genre>.content.json
// (the quiz is quiz.manifest.json + trip-trivia.content.json). The brief's `template` picks one.

// Genre describes one playable template: how the planner chooses it and what content shape it needs.
type Genre struct {
	Name     string
	Blurb    string   // shown to the brief writer
	Keywords []string // lowercase substrings of the brief text that select this genre
	Content  string   // content item kind Ember must write; "" means the template content is used as is
	Shape    string   // what Ember writes for Content
	Tokens   int      // max_tokens for the Ember call (reasoning included); 0 means the default
}

var genres = []Genre{
	{Name: "quiz", Blurb: "photo or fact questions with four answers"},
	{Name: "memory_match", Blurb: "flip cards and find the matching pairs", Keywords: []string{"memory", "match pairs", "matching", "flip card", "concentration"}, Content: "card",
		Shape: `6 different cards: {"prompt": one emoji or one short word, "media_id": a photo id from the list or ""}.`, Tokens: 700},
	{Name: "word_guess", Blurb: "guess the hidden five letter word in six tries", Keywords: []string{"wordle", "word guess", "guess the word", "five letter", "5 letter", "word game", "anagram", "vocabulary"}, Content: "word",
		Shape: `8 different common words of exactly 5 letters in capitals that fit the theme, e.g. BEACH, TRAMS: {"prompt": the word, "clue": a hint of at most 6 words}.`, Tokens: 1000},
	{Name: "daily_word", Blurb: "one shared five letter word puzzle per day", Keywords: []string{"word of the day", "daily word", "daily puzzle"}, Content: "word",
		Shape: `8 different common words of exactly 5 letters in capitals that fit the theme, e.g. BEACH, TRAMS: {"prompt": the word, "clue": a hint of at most 6 words}.`, Tokens: 1000},
	{Name: "timeline_sort", Blurb: "drag moments into chronological order", Keywords: []string{"timeline", "chronolog", "put in order", "sort the", "order of events", "what happened first"}, Content: "event",
		Shape: `5 moments from the story: {"prompt": at most 5 words, "order": chronological position 1 to 5, all different}.`, Tokens: 700},
	{Name: "map_pins", Blurb: "drag pins to where places belong on a map", Keywords: []string{"map", "pin the", "where is", "geography", "locations"}, Content: "place",
		Shape: `4 places: {"prompt": place name of at most 4 words, "x": 5 to 95 (percent from the left of the map), "y": 5 to 95 (percent from the top)}. Spread them out.`, Tokens: 700},
	{Name: "lane_runner", Blurb: "swipe between lanes to grab coins and dodge rocks", Keywords: []string{"runner", "run ", "dash", "dodge", "endless run", "lane", "obstacle", "subway"}},
	{Name: "rhythm_tap", Blurb: "tap lanes in time with falling notes", Keywords: []string{"rhythm", "beat", "music", "tempo", "drum", "tap in time"}},
	{Name: "paddle_rally", Blurb: "keep a bouncing ball alive with a paddle", Keywords: []string{"paddle", "pong", "ball", "bounce", "rally", "breakout"}},
	{Name: "star_catcher", Blurb: "drag a basket to catch falling stars and avoid bombs", Keywords: []string{"catch", "falling", "collect", "basket", "stars"}},
	{Name: "star_shooter", Blurb: "fly a ship and shoot waves of invaders", Keywords: []string{"shoot", "invader", "space", "shooter", "blast", "alien", "enemy", "enemies"}},
	{Name: "match3", Blurb: "swipe tiles to match three in a row", Keywords: []string{"match 3", "match-3", "match three", "candy", "swap", "bejeweled", "puzzle tiles"}},
	{Name: "swipe_merge", Blurb: "swipe to slide and merge equal numbers", Keywords: []string{"2048", "merge", "numbers", "sliding"}},
	{Name: "photo_hunt", Blurb: "find hidden things in a photo", Keywords: []string{"hidden object", "photo hunt", "find the", "spot the", "seek", "i spy"}},
	{Name: "whack_mole", Blurb: "tap critters that pop up, avoid decoys", Keywords: []string{"whack", "mole", "reaction", "reflex", "pop up", "tap the"}},
	{Name: "simon_says", Blurb: "repeat a growing pattern of lights", Keywords: []string{"simon", "pattern", "repeat the", "sequence", "echo"}},
	{Name: "trace_draw", Blurb: "trace a shape by drawing with a finger", Keywords: []string{"draw", "trace", "doodle", "sketch", "tracing"}},
}

func genreByName(name string) (Genre, bool) {
	for _, g := range genres {
		if g.Name == name {
			return g, true
		}
	}
	return Genre{}, false
}

// GenreNames lists every genre id, quiz first.
func GenreNames() []string {
	out := make([]string, len(genres))
	for i, g := range genres {
		out[i] = g.Name
	}
	return out
}

// inferGenre picks a genre from free text; quiz when nothing matches or the text asks for a quiz.
func inferGenre(text string) string {
	low := strings.ToLower(text)
	if strings.Contains(low, "quiz") || strings.Contains(low, "trivia") || strings.Contains(low, "question") {
		return "quiz"
	}
	for _, g := range genres[1:] { // a genre named outright ("rhythm tap game") beats keyword matches
		if strings.Contains(low, strings.ReplaceAll(g.Name, "_", " ")) {
			return g.Name
		}
	}
	for _, g := range genres {
		for _, k := range g.Keywords {
			if strings.Contains(low, k) {
				return g.Name
			}
		}
	}
	return "quiz"
}

// pickGenre honours a valid brief.template and otherwise infers the genre from the brief text.
func pickGenre(b Brief) string {
	if _, ok := genreByName(strings.ToLower(strings.TrimSpace(b.Template))); ok {
		return strings.ToLower(strings.TrimSpace(b.Template))
	}
	return inferGenre(b.Intent + " " + b.TitleIdea)
}

// Genre is the normalized template of the brief ("quiz" when unset).
func (b Brief) Genre() string {
	if _, ok := genreByName(b.Template); ok {
		return b.Template
	}
	return "quiz"
}

func genreFiles(g string) (manifest, content string) {
	if g == "quiz" {
		return "templates/quiz.manifest.json", "templates/trip-trivia.content.json"
	}
	return "templates/" + g + ".manifest.json", "templates/" + g + ".content.json"
}

// templateConcepts is the set of concept ids used by any template manifest; the planner digest lists only those.
func templateConcepts(specDir string) map[string]bool {
	used := map[string]bool{}
	files, _ := filepath.Glob(filepath.Join(specDir, "templates", "*.manifest.json"))
	for _, f := range files {
		raw, err := os.ReadFile(f)
		if err != nil {
			continue
		}
		var m struct {
			Concepts []struct {
				ID string `json:"id"`
			} `json:"concepts"`
		}
		if json.Unmarshal(raw, &m) == nil {
			for _, c := range m.Concepts {
				used[c.ID] = true
			}
		}
	}
	return used
}

// genreExample is the manifest the planner starts from for this brief.
func (a *App) genreExample(b Brief) []byte {
	if g := b.Genre(); g != "quiz" {
		rel, _ := genreFiles(g)
		if raw, err := os.ReadFile(filepath.Join(a.cfg.SpecDir, rel)); err == nil && json.Valid(raw) {
			return raw
		}
	}
	return a.quizManifestTemplate()
}

// genreManifest customizes a genre template manifest with the brief.
func (a *App) genreManifest(b Brief, g string) (json.RawMessage, bool) {
	rel, _ := genreFiles(g)
	raw, err := os.ReadFile(filepath.Join(a.cfg.SpecDir, rel))
	if err != nil {
		return nil, false
	}
	var m map[string]any
	if json.Unmarshal(raw, &m) != nil {
		return nil, false
	}
	m["title"] = b.TitleIdea
	m["description"] = truncate(b.Intent, 90)
	m["level"] = b.Level
	m["template"] = g
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
		case "feel.theme":
			params["palette"], params["mood"], params["emoji"] = theme["palette"], theme["mood"], theme["emoji"]
		case "share.score_card":
			params["headline"] = truncate(b.TitleIdea, 40)
		case "rule.lives":
			switch b.Difficulty {
			case "easy":
				params["lives"] = 5
			case "hard":
				params["lives"] = 2
			}
		case "entity.card":
			params["pairs"] = clampInt(b.Limits.Rounds, 3, 8, 6)
		}
	}
	out, _ := json.Marshal(m)
	return out, true
}

// genreContent returns the genre's template content, personalized with the group's photos where the shape allows.
func (a *App) genreContent(b Brief, g string, media []Media) (json.RawMessage, bool) {
	_, rel := genreFiles(g)
	raw, err := os.ReadFile(filepath.Join(a.cfg.SpecDir, rel))
	if err != nil || !json.Valid(raw) {
		return nil, false
	}
	var c map[string]any
	if json.Unmarshal(raw, &c) != nil {
		return nil, false
	}
	switch g {
	case "memory_match":
		if len(media) >= 4 {
			items := []map[string]any{}
			for i, m := range media {
				if i >= 8 {
					break
				}
				items = append(items, map[string]any{"id": fmt.Sprintf("c%d", i+1), "kind": "card", "prompt": truncate(m.Caption, 14), "media_id": m.ID, "media_url": m.URL})
			}
			c["items"] = items
		}
	case "timeline_sort":
		if len(media) >= 3 {
			sorted := append([]Media(nil), media...)
			sort.SliceStable(sorted, func(i, j int) bool { return sorted[i].TakenAt.Before(sorted[j].TakenAt) })
			if len(sorted) > 5 {
				sorted = sorted[:5]
			}
			items := []map[string]any{}
			for i, m := range sorted {
				items = append(items, map[string]any{"id": fmt.Sprintf("e%d", i+1), "kind": "event", "prompt": truncate(m.Caption, 40), "answer": i + 1, "media_url": m.URL})
			}
			c["items"] = items
		}
	}
	if cp, ok := c["copy"].(map[string]any); ok && b.Intent != "" {
		cp["intro"] = truncate(b.Intent, 120)
	}
	out, _ := json.Marshal(c)
	return out, true
}

// genreContentSchema is the loose structured-output schema for authored genre content.
func genreContentSchema() map[string]any {
	str := map[string]any{"type": "string"}
	num := map[string]any{"type": "integer"}
	return map[string]any{"type": "object", "properties": map[string]any{
		"items": map[string]any{"type": "array", "items": map[string]any{"type": "object", "properties": map[string]any{
			"prompt": str, "media_id": str, "clue": str, "order": num, "x": num, "y": num}, "required": []string{"prompt"}}},
		"copy": map[string]any{"type": "object", "properties": map[string]any{"intro": str, "win": str, "lose": str}},
	}, "required": []string{"items", "copy"}}
}

func genreContentSystem(g Genre) string {
	return "Write content for a mini-game (" + g.Blurb + "). Output ONE JSON object: " +
		`{"items":[...],"copy":{"intro","win","lose"}}. items: ` + g.Shape +
		" copy: three short friendly lines (max 10 words each)."
}

// genreContentUser is the compact brief; photos are listed only for genres whose items point at them.
func genreContentUser(g Genre, b Brief, media []Media) string {
	var user strings.Builder
	fmt.Fprintf(&user, "Theme: %s. Title: %s. Tone: %s.", b.Intent, b.TitleIdea, b.Tone)
	if g.Content == "card" {
		user.WriteString("\nPhotos:")
		for _, m := range media {
			fmt.Fprintf(&user, "\n%s: %s", m.ID, m.Caption)
		}
	}
	return user.String()
}

// planGenreContent authors content for a non-quiz genre. handled=false means the quiz path applies.
func (a *App) planGenreContent(ctx context.Context, acc *runAcc, b Brief, media []Media) (json.RawMessage, bool, error) {
	name := b.Genre()
	if name == "quiz" {
		return nil, false, nil
	}
	g, _ := genreByName(name)
	if g.Content == "" {
		return a.templateContent(b, media), true, nil
	}
	tokens := g.Tokens
	if tokens == 0 {
		tokens = 800
	}
	res, err := a.muse.Chat(ctx, ChatReq{Model: ModelEmber, Purpose: "content", System: genreContentSystem(g), User: genreContentUser(g, b, media),
		MaxTokens: tokens, SchemaName: "content", Schema: genreContentSchema(), Reasoning: "minimal"})
	acc.add(res, err, "content")
	if err != nil {
		return nil, true, err
	}
	obj, err := ExtractJSONObject(res.Content)
	if err != nil {
		acc.add(nil, err, "content")
		return nil, true, err
	}
	out, err := normalizeGenreContent(g, obj, media)
	if err != nil {
		acc.add(nil, err, "content")
	}
	return out, true, err
}

// normalizeGenreContent turns Ember output into sg.content/1 items of the genre's kind, dropping invalid ones.
func normalizeGenreContent(g Genre, raw json.RawMessage, media []Media) (json.RawMessage, error) {
	var in struct {
		Items []struct {
			Prompt  string `json:"prompt"`
			MediaID string `json:"media_id"`
			Clue    string `json:"clue"`
			Order   int    `json:"order"`
			X       int    `json:"x"`
			Y       int    `json:"y"`
		} `json:"items"`
		Copy map[string]string `json:"copy"`
	}
	if err := json.Unmarshal(raw, &in); err != nil {
		return nil, err
	}
	urls := map[string]string{}
	for _, m := range media {
		urls[m.ID] = m.URL
	}
	seen := map[string]bool{}
	orders := map[int]bool{}
	items := []map[string]any{}
	for _, it := range in.Items {
		p := strings.TrimSpace(it.Prompt)
		if p == "" || len(items) >= 14 {
			continue
		}
		id := fmt.Sprintf("%c%d", g.Content[0], len(items)+1)
		item := map[string]any{"id": id, "kind": g.Content, "prompt": truncate(p, 60)}
		switch g.Content {
		case "word":
			p = strings.ToUpper(p)
			ok := len([]rune(p)) == 5
			for _, r := range p {
				if r < 'A' || r > 'Z' {
					ok = false
				}
			}
			if !ok || seen[strings.ToLower(p)] {
				continue
			}
			item["prompt"] = p
			if it.Clue != "" {
				item["clue"] = truncate(it.Clue, 80)
			}
		case "card":
			if seen[strings.ToLower(p)] || len(items) >= 8 {
				continue
			}
			item["prompt"] = truncate(p, 14)
			if u, ok := urls[it.MediaID]; ok {
				item["media_id"], item["media_url"] = it.MediaID, u
			}
		case "event":
			if it.Order < 1 || it.Order > 10 || orders[it.Order] || len(items) >= 6 {
				continue
			}
			orders[it.Order] = true
			item["answer"] = it.Order
		case "place":
			if len(items) >= 5 {
				continue
			}
			clamp := func(v int) int { return clampInt(v, 5, 95, 50) }
			item["choices"] = []string{fmt.Sprint(clamp(it.X)), fmt.Sprint(clamp(it.Y))}
		}
		seen[strings.ToLower(p)] = true
		items = append(items, item)
	}
	min := map[string]int{"word": 6, "card": 4, "event": 3, "place": 3}[g.Content]
	if len(items) < min {
		return nil, fmt.Errorf("only %d valid %s items", len(items), g.Content)
	}
	cp := map[string]string{"intro": "Ready?", "win": "Nailed it!", "lose": "Good try, go again!"}
	for k, v := range in.Copy {
		if strings.TrimSpace(v) != "" {
			cp[k] = v
		}
	}
	return json.Marshal(map[string]any{"schema": "sg.content/1", "items": items, "copy": cp})
}
