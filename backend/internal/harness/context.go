package harness

import (
	"encoding/json"
	"fmt"
	"path"
	"strings"
)

// The `context` the generator receives on a job (docs/HARNESS_V2.md, "The `context` the generator
// receives"): version harness-context/1, at most 6 types, 24 tools and 48 KB of JSON.

const (
	ContextVersion  = "harness-context/1"
	ContextMaxTypes = 6
	ContextMaxTools = 24
	ContextMaxBytes = 48 * 1024
)

// GenContext is the job's `context`.
type GenContext struct {
	Version       string          `json:"version"`
	Understanding ContextUnder    `json:"understanding"`
	Types         []ContextType   `json:"types"`
	Tools         []ContextTool   `json:"tools"`
	Plan          json.RawMessage `json:"plan,omitempty"` // empty until the planner (step 4) exists
	GoldIDs       []string        `json:"gold_ids"`
	GateProfile   string          `json:"gate_profile,omitempty"`
	Learned       []ContextType   `json:"learned"`
	Notes         []string        `json:"notes"`
	Preferences   []Preference    `json:"preferences,omitempty"`
}

// Preference is one earlier pick between versions of a game (variants.mjs applyPick): on one axis (look,
// twist, arc, type), the version the person kept and the ones they passed over.
type Preference struct {
	Axis     string           `json:"axis"`
	Chosen   PreferenceSide   `json:"chosen"`
	Rejected []PreferenceSide `json:"rejected,omitempty"`
	At       string           `json:"at,omitempty"`
}

// PreferenceSide is one version in a pick.
type PreferenceSide struct {
	ID     string `json:"id,omitempty"`
	GameID string `json:"game_id,omitempty"`
	Label  string `json:"label"`
	Value  string `json:"value,omitempty"`
}

// lookPreference is the latest look pick with a value, or nil.
func lookPreference(prefs []Preference) *Preference {
	for i := len(prefs) - 1; i >= 0; i-- {
		if prefs[i].Axis == "look" && strings.TrimSpace(prefs[i].Chosen.Value+prefs[i].Chosen.Label) != "" {
			return &prefs[i]
		}
	}
	return nil
}

// ContextUnder is the understanding as the generator sees it.
type ContextUnder struct {
	NamedRefs []string `json:"named_refs"`
	Verbs     []string `json:"verbs"`
	Inputs    []string `json:"inputs"`
	Families  []string `json:"families"`
	Theme     []string `json:"theme"`
	Keywords  []string `json:"keywords"`
	Players   string   `json:"players"`
	By        string   `json:"by,omitempty"` // which understander ran: muse, keywords (and why), given
	Sponsor   *Sponsor `json:"sponsor,omitempty"`
}

// ContextType is a type card: the fields the composer needs, plus why it matched.
type ContextType struct {
	ID               string       `json:"id"`
	Name             string       `json:"name"`
	Family           string       `json:"family"`
	Summary          string       `json:"summary"`
	CoreLoop         string       `json:"core_loop"`
	Rules            []string     `json:"rules"`
	Win              string       `json:"win"`
	Lose             string       `json:"lose"`
	Scoring          string       `json:"scoring"`
	Pieces           []string     `json:"pieces"`
	ContentNeeds     []string     `json:"content_needs"`
	DifficultyLevers []string     `json:"difficulty_levers"`
	Tools            []string     `json:"tools"`
	GateProfile      string       `json:"gate_profile"`
	Status           string       `json:"status"`
	Source           string       `json:"source"`
	Refs             []string     `json:"refs"`
	SocialHooks      []string     `json:"social_hooks,omitempty"`
	Match            ContextMatch `json:"match"`
}

// ContextMatch says how well a type matched.
type ContextMatch struct {
	Score   float64  `json:"score"`
	Reasons []string `json:"reasons"`
}

// ContextTool is a tool card.
type ContextTool struct {
	ID        string            `json:"id"`
	Kind      string            `json:"kind"`
	Status    string            `json:"status"`
	Summary   string            `json:"summary"`
	WhenToUse string            `json:"when_to_use"`
	API       string            `json:"api"`
	Params    map[string]string `json:"params"`
	Events    []string          `json:"events"`
}

// fieldCaps are the trimming levels: each pass clips text harder until the JSON fits.
type fieldCaps struct {
	text, list, item, reasons, api int
}

var trimLevels = []fieldCaps{
	{text: 400, list: 8, item: 200, reasons: 4, api: 600},
	{text: 240, list: 5, item: 140, reasons: 2, api: 300},
	{text: 140, list: 3, item: 90, reasons: 1, api: 160},
}

// BuildContext turns a context pack into the generator's `context`, within the limits. Types come in pack
// order (learned first); tools are the retrieved types' tools in order, then the direct matches; tools the
// catalog doesn't define are left out and named in notes.
func BuildContext(p ContextPack) (GenContext, error) {
	u := p.Understanding
	u.ensureSlices()
	c := GenContext{
		Version: ContextVersion,
		Understanding: ContextUnder{NamedRefs: u.NamedRefs, Verbs: u.Verbs, Inputs: u.Inputs, Families: u.Families,
			Theme: u.Theme, Keywords: u.Keywords, Players: u.Players, Sponsor: u.Sponsor},
		GoldIDs: []string{},
		Learned: []ContextType{},
		Notes:   append([]string{}, p.Notes...),
	}
	if p.Understood != "" {
		c.Understanding.By = p.Understood
		c.Notes = append(c.Notes, "understood by "+p.Understood)
	}
	for _, l := range p.Lookups {
		switch {
		case l.Cached:
			c.Notes = append(c.Notes, fmt.Sprintf("lookup %q: recalled a learned type", l.Ref))
		case l.Learned != nil:
			c.Notes = append(c.Notes, fmt.Sprintf("lookup %q: learned %s from %d source(s)", l.Ref, l.Learned.ID, len(l.Sources)))
		case l.Error != "":
			c.Notes = append(c.Notes, fmt.Sprintf("lookup %q failed (%s); using catalog matches only", l.Ref, l.Error))
		}
	}
	if len(p.Lookups) == 0 {
		for _, r := range p.Refs {
			if r.Hit {
				c.Notes = append(c.Notes, fmt.Sprintf("lookup skipped: catalog alias hit for %q", r.Ref))
			}
		}
	}

	var missing []string
	for level := 0; level < len(trimLevels); level++ {
		caps := trimLevels[level]
		c.Types = c.Types[:0]
		for i, th := range p.Types {
			if i >= ContextMaxTypes {
				break
			}
			c.Types = append(c.Types, typeCard(th.Type, th.Score, th.Reasons, caps))
		}
		c.Learned = c.Learned[:0]
		for _, l := range p.Learned {
			c.Learned = append(c.Learned, typeCard(l, 1, []string{"learned from the web"}, caps))
		}
		c.Tools = c.Tools[:0]
		missing = missing[:0]
		for _, th := range p.Tools {
			if th.Tool == nil {
				missing = append(missing, th.ID)
				continue
			}
			if len(c.Tools) < ContextMaxTools {
				c.Tools = append(c.Tools, toolCard(*th.Tool, caps))
			}
		}
		if len(c.Types) > 0 {
			c.GateProfile = c.Types[0].GateProfile
		}
		c.GoldIDs = goldIDs(c.Types)
		if size(c) <= ContextMaxBytes {
			break
		}
	}
	if len(missing) > 0 {
		c.Notes = append(c.Notes, "tools not in the catalog yet: "+strings.Join(uniq(missing), ", "))
	}
	// still too big at the tightest level: drop direct-only tools, then tools, then types, from the end
	for size(c) > ContextMaxBytes && len(c.Tools) > 0 {
		c.Tools = c.Tools[:len(c.Tools)-1]
	}
	for size(c) > ContextMaxBytes && len(c.Types) > 1 {
		c.Types = c.Types[:len(c.Types)-1]
	}
	if size(c) > ContextMaxBytes {
		return c, fmt.Errorf("harness: context is %d bytes even trimmed (limit %d)", size(c), ContextMaxBytes)
	}
	return c, nil
}

func size(c GenContext) int {
	b, _ := json.Marshal(c)
	return len(b)
}

func typeCard(t GameType, score float64, reasons []string, k fieldCaps) ContextType {
	return ContextType{
		ID: t.ID, Name: t.Name, Family: t.Family,
		Summary: clip(t.Summary, k.text), CoreLoop: clip(t.CoreLoop, k.text),
		Rules: clipList(t.Rules, k.list, k.item), Win: clip(t.Win, k.item), Lose: clip(t.Lose, k.item),
		Scoring: clip(t.Scoring, k.item), Pieces: clipList(t.Pieces, k.list, k.item),
		ContentNeeds: clipList(t.ContentNeeds, k.list, k.item), DifficultyLevers: clipList(t.DifficultyLevers, k.list, k.item),
		Tools: nonNil(t.Tools), GateProfile: t.GateProfile, Status: t.Status, Source: t.Source, Refs: nonNil(t.Refs),
		SocialHooks: clipList(t.SocialHooks, k.reasons, k.item),
		Match:       ContextMatch{Score: score, Reasons: clipList(reasons, k.reasons, k.item)},
	}
}

func toolCard(t GameTool, k fieldCaps) ContextTool {
	params := map[string]string{}
	for key, v := range t.Params {
		params[key] = clip(v, k.item)
	}
	return ContextTool{ID: t.ID, Kind: t.Kind, Status: t.Status, Summary: clip(t.Summary, k.text),
		WhenToUse: clip(t.WhenToUse, k.text), API: clip(t.API, k.api), Params: params, Events: nonNil(t.Events)}
}

func clipList(xs []string, n, each int) []string {
	out := []string{}
	for i, x := range xs {
		if i >= n {
			break
		}
		out = append(out, clip(x, each))
	}
	return out
}

func nonNil(xs []string) []string {
	if xs == nil {
		return []string{}
	}
	return xs
}

// goldIDs are the gold games behind the retrieved types: a gold-seeded type cites its game's authoring
// file (authoring/games/gold_x.authoring.json) in refs.
func goldIDs(types []ContextType) []string {
	var out []string
	for _, t := range types {
		for _, r := range t.Refs {
			base := path.Base(r)
			if strings.HasPrefix(base, "gold_") && strings.HasSuffix(base, ".authoring.json") {
				out = append(out, strings.TrimSuffix(base, ".authoring.json"))
			}
		}
	}
	return nonNil(uniq(out))
}
