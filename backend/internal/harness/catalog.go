// Package harness is steps 1–3 of the open-ended game-making harness (docs/HARNESS_V2.md): understand a
// request, retrieve the game types and game tools that fit it from the catalog, and look a game up on the
// web when the catalog doesn't know it.
//
// The catalog is JSON in the repository (authoring/catalog/types/*.json and tools/*.json), loaded through
// a Source so a database can back it later. Retrieval is in-process and needs no model: BM25F over weighted
// fields, character trigrams on names and aliases for typos, and exact overlap with the understood verbs,
// inputs and families, fused by reciprocal-rank fusion. Muse is only the understanding and lookup step, and
// it is reached through the MuseJSON interface so the transport can change.
package harness

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"github.com/karthiksing05/meta-hackathon-project/backend/internal/repo"
)

// GameType is one entry of the game_types catalog: a mechanic, with the well-known games that use it as
// aliases for matching. The field names are the catalog schema's (authoring/catalog/schema/game_type.schema.json).
type GameType struct {
	ID               string   `json:"id"`
	Name             string   `json:"name"`
	Aliases          []string `json:"aliases,omitempty"`
	Family           string   `json:"family"`
	Subfamily        string   `json:"subfamily,omitempty"`
	Summary          string   `json:"summary"`
	CoreLoop         string   `json:"core_loop"`
	Verbs            []string `json:"verbs,omitempty"`
	Inputs           []string `json:"inputs,omitempty"`
	Pieces           []string `json:"pieces,omitempty"`
	Rules            []string `json:"rules,omitempty"`
	Win              string   `json:"win,omitempty"`
	Lose             string   `json:"lose,omitempty"`
	Scoring          string   `json:"scoring,omitempty"`
	SessionSeconds   []int    `json:"session_seconds,omitempty"`
	Players          []string `json:"players,omitempty"`
	SocialHooks      []string `json:"social_hooks,omitempty"`
	ContentNeeds     []string `json:"content_needs,omitempty"`
	DifficultyLevers []string `json:"difficulty_levers,omitempty"`
	Tools            []string `json:"tools,omitempty"`
	EngineGaps       []string `json:"engine_gaps,omitempty"`
	GateProfile      string   `json:"gate_profile,omitempty"`
	ExamplePrompts   []string `json:"example_prompts,omitempty"`
	Status           string   `json:"status,omitempty"`
	Source           string   `json:"source,omitempty"`
	Refs             []string `json:"refs,omitempty"`
	VariantOf        string   `json:"variant_of,omitempty"`
	Notes            string   `json:"notes,omitempty"`
}

// GameTool is one entry of the game_tools catalog: a building block the composer can use.
type GameTool struct {
	ID           string            `json:"id"`
	Kind         string            `json:"kind"`
	Name         string            `json:"name,omitempty"`
	Aliases      []string          `json:"aliases,omitempty"`
	Summary      string            `json:"summary"`
	WhenToUse    string            `json:"when_to_use"`
	API          string            `json:"api,omitempty"`
	Events       []string          `json:"events,omitempty"`
	Params       map[string]string `json:"params,omitempty"`
	Status       string            `json:"status"`
	GapsItCloses []string          `json:"gaps_it_closes,omitempty"`
	ExampleTypes []string          `json:"example_types,omitempty"`
	Path         string            `json:"path,omitempty"`
	Refs         []string          `json:"refs,omitempty"`
	Notes        string            `json:"notes,omitempty"`
}

// Catalog is everything a Source loads.
type Catalog struct {
	Types []GameType `json:"types"`
	Tools []GameTool `json:"tools"`
}

// Source loads the catalog. DirSource reads the repository's JSON; a database-backed Source can replace it.
type Source interface {
	Load(ctx context.Context) (*Catalog, error)
}

// The schema's closed sets (authoring/catalog/schema/*.json).
var (
	Families = []string{
		"word", "trivia", "knowledge_quiz", "logic_puzzle", "number_math", "spatial_puzzle", "tile_matching",
		"deduction", "memory", "reaction", "rhythm_music", "runner", "platformer", "arcade_shooter",
		"dodge_survive", "sports", "racing", "physics_toy", "stack_balance", "aim_throw", "catch_collect",
		"idle_incremental", "management_sim", "cooking_crafting", "nurture_pet", "card", "board", "dice_luck",
		"story_choice", "mystery_narrative", "adventure_rpg", "strategy_tactics", "tower_defense", "duel_battle",
		"party_social", "guess_your_friends", "drawing_creative", "music_making", "daily_puzzle", "learning",
		"calm_cozy", "horror_tension",
	}
	Inputs        = []string{"tap", "drag", "swipe", "hold", "type", "tilt", "draw", "voice", "multi_touch"}
	PlayerModes   = []string{"solo", "pass_and_play", "async_friends", "group_daily", "live"}
	TypeStatuses  = []string{"seed", "reviewed", "learned"}
	ToolKinds     = []string{"fragment", "builtin", "runtime_tool", "content_tool", "look", "server_tool"}
	ToolStatuses  = []string{"shipped", "building", "planned", "gap"}
	GateProfiles  = []string{"arcade", "puzzle", "calm", "trivia", "runner"}
	idPattern     = regexp.MustCompile(`^[a-z][a-z0-9]*(_[a-z0-9]+)*$`)
	verbPattern   = regexp.MustCompile(`^[a-z][a-z_ ]*$`)
	catalogDirRel = "authoring/catalog"
)

func oneOf(v string, set []string) bool {
	for _, s := range set {
		if v == s {
			return true
		}
	}
	return false
}

// Validate checks a game type against the schema's rules (game_type.schema.json). It returns every
// problem, joined.
func (t *GameType) Validate() error {
	var errs []error
	bad := func(f string, a ...any) { errs = append(errs, fmt.Errorf(f, a...)) }
	if !idPattern.MatchString(t.ID) || len(t.ID) > 64 {
		bad("id %q is not snake_case", t.ID)
	}
	if n := len(strings.TrimSpace(t.Name)); n < 2 || n > 80 {
		bad("%s: name must be 2-80 characters", t.ID)
	}
	if !oneOf(t.Family, Families) {
		bad("%s: family %q is not a catalog family", t.ID, t.Family)
	}
	if n := len(t.Summary); n < 20 || n > 400 {
		bad("%s: summary must be 20-400 characters", t.ID)
	}
	if n := len(t.CoreLoop); n < 10 || n > 400 {
		bad("%s: core_loop must be 10-400 characters", t.ID)
	}
	if len(t.Verbs) == 0 {
		bad("%s: verbs is empty", t.ID)
	}
	for _, v := range t.Verbs {
		if !verbPattern.MatchString(v) {
			bad("%s: verb %q is not lowercase words", t.ID, v)
		}
	}
	if len(t.Inputs) == 0 {
		bad("%s: inputs is empty", t.ID)
	}
	for _, in := range t.Inputs {
		if !oneOf(in, Inputs) {
			bad("%s: input %q is not one of %v", t.ID, in, Inputs)
		}
	}
	if len(t.Rules) == 0 {
		bad("%s: rules is empty", t.ID)
	}
	if len(strings.TrimSpace(t.Win)) < 2 {
		bad("%s: win is empty", t.ID)
	}
	if len(strings.TrimSpace(t.Scoring)) < 2 {
		bad("%s: scoring is empty", t.ID)
	}
	if len(t.Players) == 0 {
		bad("%s: players is empty", t.ID)
	}
	for _, p := range t.Players {
		if !oneOf(p, PlayerModes) {
			bad("%s: players %q is not one of %v", t.ID, p, PlayerModes)
		}
	}
	if len(t.Tools) == 0 {
		bad("%s: tools is empty", t.ID)
	}
	for _, id := range append(append([]string{}, t.Tools...), t.EngineGaps...) {
		if !idPattern.MatchString(id) {
			bad("%s: tool id %q is not snake_case", t.ID, id)
		}
	}
	if !oneOf(t.GateProfile, GateProfiles) {
		bad("%s: gate_profile %q is not one of %v", t.ID, t.GateProfile, GateProfiles)
	}
	if len(t.ExamplePrompts) < 3 {
		bad("%s: needs at least 3 example_prompts", t.ID)
	}
	if !oneOf(t.Status, TypeStatuses) {
		bad("%s: status %q is not one of %v", t.ID, t.Status, TypeStatuses)
	}
	if n := len(t.Source); n < 2 || n > 80 {
		bad("%s: source must be 2-80 characters", t.ID)
	}
	if len(t.SessionSeconds) != 0 && (len(t.SessionSeconds) != 2 || t.SessionSeconds[0] > t.SessionSeconds[1] || t.SessionSeconds[0] < 5 || t.SessionSeconds[1] > 3600) {
		bad("%s: session_seconds must be [min, max] within 5..3600", t.ID)
	}
	if t.VariantOf != "" && !idPattern.MatchString(t.VariantOf) {
		bad("%s: variant_of %q is not snake_case", t.ID, t.VariantOf)
	}
	return errors.Join(errs...)
}

// Validate checks a game tool against the schema's rules.
func (t *GameTool) Validate() error {
	var errs []error
	if !idPattern.MatchString(t.ID) {
		errs = append(errs, fmt.Errorf("tool id %q is not snake_case", t.ID))
	}
	if !oneOf(t.Kind, ToolKinds) {
		errs = append(errs, fmt.Errorf("%s: kind %q is not one of %v", t.ID, t.Kind, ToolKinds))
	}
	if !oneOf(t.Status, ToolStatuses) {
		errs = append(errs, fmt.Errorf("%s: status %q is not one of %v", t.ID, t.Status, ToolStatuses))
	}
	if len(t.Summary) < 10 {
		errs = append(errs, fmt.Errorf("%s: summary must be at least 10 characters", t.ID))
	}
	if len(t.WhenToUse) < 5 {
		errs = append(errs, fmt.Errorf("%s: when_to_use must be at least 5 characters", t.ID))
	}
	return errors.Join(errs...)
}

// DirSource reads a catalog directory: types/*.json and tools/*.json, each file a JSON array of entries. Dir "" finds authoring/catalog in the repository (or $HARNESS_CATALOG).
type DirSource struct {
	Dir string
	// Strict makes Load fail on an entry that doesn't validate; otherwise such entries are skipped and
	// reported in Skipped.
	Strict  bool
	Skipped []string
}

// FindCatalogDir returns the catalog directory: $HARNESS_CATALOG, the image's /app/catalog, then the
// repository's authoring/catalog.
func FindCatalogDir() (string, bool) {
	for _, p := range []string{os.Getenv("HARNESS_CATALOG"), "/app/catalog"} {
		if p == "" {
			continue
		}
		if st, err := os.Stat(p); err == nil && st.IsDir() {
			return p, true
		}
	}
	return repo.Find(catalogDirRel)
}

// Load implements Source.
func (d *DirSource) Load(ctx context.Context) (*Catalog, error) {
	dir := d.Dir
	if dir == "" {
		var ok bool
		if dir, ok = FindCatalogDir(); !ok {
			return nil, fmt.Errorf("harness: catalog not found (set HARNESS_CATALOG, or run inside the repository: %s)", catalogDirRel)
		}
	}
	d.Skipped = nil
	cat := &Catalog{}
	typeSeen := map[string]string{}
	err := readEntries(filepath.Join(dir, "types"), func(file string, raw json.RawMessage) error {
		var t GameType
		if err := json.Unmarshal(raw, &t); err != nil {
			return fmt.Errorf("%s: %w", file, err)
		}
		if err := t.Validate(); err != nil {
			return d.skip(file, err)
		}
		if prev, dup := typeSeen[t.ID]; dup {
			return d.skip(file, fmt.Errorf("type %q is also in %s", t.ID, prev))
		}
		typeSeen[t.ID] = file
		cat.Types = append(cat.Types, t)
		return nil
	})
	if err != nil {
		return nil, err
	}
	toolSeen := map[string]string{}
	err = readEntries(filepath.Join(dir, "tools"), func(file string, raw json.RawMessage) error {
		var t GameTool
		if err := json.Unmarshal(raw, &t); err != nil {
			return fmt.Errorf("%s: %w", file, err)
		}
		if err := t.Validate(); err != nil {
			return d.skip(file, err)
		}
		if prev, dup := toolSeen[t.ID]; dup {
			return d.skip(file, fmt.Errorf("tool %q is also in %s", t.ID, prev))
		}
		toolSeen[t.ID] = file
		cat.Tools = append(cat.Tools, t)
		return nil
	})
	if err != nil {
		return nil, err
	}
	return cat, ctx.Err()
}

func (d *DirSource) skip(file string, err error) error {
	if d.Strict {
		return fmt.Errorf("%s: %w", file, err)
	}
	d.Skipped = append(d.Skipped, fmt.Sprintf("%s: %v", filepath.Base(file), err))
	return nil
}

// readEntries calls fn for every entry of every *.json file in dir, in file-name order. A missing
// directory has no entries.
func readEntries(dir string, fn func(file string, raw json.RawMessage) error) error {
	files, err := filepath.Glob(filepath.Join(dir, "*.json"))
	if err != nil {
		return err
	}
	sort.Strings(files)
	for _, f := range files {
		b, err := os.ReadFile(f)
		if err != nil {
			return err
		}
		b = []byte(strings.TrimSpace(string(b)))
		var entries []json.RawMessage
		switch {
		case len(b) == 0:
			continue
		case b[0] == '[':
			if err := json.Unmarshal(b, &entries); err != nil {
				return fmt.Errorf("%s: %w", f, err)
			}
		default:
			// a single entry, or an object holding the array under "types" / "tools" / "entries"
			var wrap map[string]json.RawMessage
			if err := json.Unmarshal(b, &wrap); err != nil {
				return fmt.Errorf("%s: %w", f, err)
			}
			found := false
			for _, k := range []string{"types", "tools", "entries", "items"} {
				if v, ok := wrap[k]; ok {
					if err := json.Unmarshal(v, &entries); err != nil {
						return fmt.Errorf("%s: %s: %w", f, k, err)
					}
					found = true
					break
				}
			}
			if !found {
				entries = []json.RawMessage{b}
			}
		}
		for _, e := range entries {
			if err := fn(f, e); err != nil {
				return err
			}
		}
	}
	return nil
}

// MemorySource serves a fixed catalog (tests, or a catalog already loaded elsewhere).
type MemorySource struct{ Catalog Catalog }

// Load implements Source.
func (m MemorySource) Load(context.Context) (*Catalog, error) {
	c := m.Catalog
	return &c, nil
}

// Vocab is the catalog's controlled vocabulary: every family, verb and input the loaded types use.
// The understanding step is told to answer in these words, which is what lets exact facet overlap work.
type Vocab struct {
	Families []string `json:"families"`
	Verbs    []string `json:"verbs"`
	Inputs   []string `json:"inputs"`
}

// VocabOf collects the vocabulary of a set of types, sorted. Families and inputs also include the schema's
// full lists, so the understanding step can name a family no entry uses yet.
func VocabOf(types []GameType) Vocab {
	f, v, in := map[string]bool{}, map[string]bool{}, map[string]bool{}
	for _, x := range Families {
		f[x] = true
	}
	for _, x := range Inputs {
		in[x] = true
	}
	for _, t := range types {
		if t.Family != "" {
			f[t.Family] = true
		}
		for _, x := range t.Verbs {
			v[x] = true
		}
		for _, x := range t.Inputs {
			in[x] = true
		}
	}
	return Vocab{Families: sortedKeys(f), Verbs: sortedKeys(v), Inputs: sortedKeys(in)}
}

func sortedKeys(m map[string]bool) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}
