package harness

import (
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
)

// The game spec (docs/HARNESS_V2.md, "The game spec"): a fixed set of parts, each with its own schema and
// check, filled in order (theme, goal, loop, pieces; then constraints, progression, end; score last, because it
// measures the goal under the constraints; then social and feel). Compose builds from the spec.

// SpecVersion is the spec format.
const SpecVersion = "game-spec/1"

// SpecParts are the parts in the order they are filled.
var SpecParts = []string{"theme", "goal", "loop", "pieces", "constraints", "progression", "end", "score", "social", "feel"}

// Spec is a game-spec/1.
type Spec struct {
	Spec        string      `json:"spec"`
	Theme       Theme       `json:"theme"`
	Goal        Goal        `json:"goal"`
	Loop        Loop        `json:"loop"`
	Pieces      Pieces      `json:"pieces"`
	Constraints Constraints `json:"constraints"`
	Progression Progression `json:"progression"`
	End         End         `json:"end"`
	Score       Score       `json:"score"`
	Social      Social      `json:"social"`
	Feel        Feel        `json:"feel"`
}

// Theme is the world, its named things (real franchise names when asked), the tone and the look family.
type Theme struct {
	World string   `json:"world"`
	Named strList  `json:"named"`
	Tone  string   `json:"tone"`
	Look  string   `json:"look"`
	Terms []string `json:"terms,omitempty"` // words the players must see (checked by quality.mjs)
}

// Goal is what the player tries to do and the measurable target.
type Goal struct {
	Text    string `json:"text"`
	Target  string `json:"target"`  // "clear 20 orders", "survive", "find the rarest answer"
	Measure string `json:"measure"` // the quantity that shows progress: "orders completed", "seconds alive"
}

// Loop is the core action loop.
type Loop struct {
	Verb         string  `json:"verb"`
	Sees         string  `json:"sees"`
	Input        string  `json:"input"` // one of Inputs
	Feedback     string  `json:"feedback"`
	CycleSeconds float64 `json:"cycle_seconds"`
}

// Pieces are the entities and content.
type Pieces struct {
	Items []Piece `json:"items"`
}

// Piece is one entity or content source.
type Piece struct {
	Name    string     `json:"name"`
	Role    string     `json:"role"`
	Count   flexString `json:"count"`             // "1", "20", "3 per round"
	Content string     `json:"content,omitempty"` // where its content comes from: answer bank, word list, levels
}

// Constraints are the limits and pressure.
type Constraints struct {
	Items []Constraint `json:"items"`
}

// Constraint is one limit, how a rule enforces it, and where the HUD shows it.
type Constraint struct {
	Kind       string     `json:"kind"` // ConstraintKinds
	Value      flexString `json:"value"`
	EnforcedBy string     `json:"enforced_by"`
	HUD        string     `json:"hud"`
}

// ConstraintKinds are the constraint kinds.
var ConstraintKinds = []string{"time", "lives", "moves", "accuracy", "rate", "space", "other"}

// Progression is the difficulty arc: three steps and the levers.
type Progression struct {
	Steps  []Step   `json:"steps"`
	Levers []string `json:"levers"`
}

// Step is one stage of the ramp.
type Step struct {
	At     string `json:"at"` // "0-20 s", "round 2"
	Change string `json:"change"`
}

// End is how a run is won, lost and ended.
type End struct {
	Win            string   `json:"win"`
	Lose           string   `json:"lose"` // "" when there is no losing
	EndsWhen       []string `json:"ends_when"`
	SessionSeconds []int    `json:"session_seconds"`
}

// EndReasons are the ways a run ends.
var EndReasons = []string{"time_out", "lives_gone", "target_reached", "all_prompts_done", "board_full", "story_end", "player_stops"}

// Score is the score model (docs/HARNESS_V2.md, "Scores you can rank").
type Score struct {
	Kind       string       `json:"kind"`
	Measures   string       `json:"measures"`
	Unit       string       `json:"unit"`
	Direction  string       `json:"direction"`
	CountsWhen string       `json:"counts_when"`
	Aggregate  string       `json:"aggregate"`
	TieBreak   string       `json:"tie_break"`
	Format     string       `json:"format"`
	Bounds     *ScoreBounds `json:"bounds,omitempty"` // set from the bots by the gate, never by Muse
	Events     []string     `json:"events"`
	Reason     string       `json:"reason,omitempty"` // why Muse chose a kind other than the type's default
	// Ranked false: no fair ranking (an opinion game compares agreement instead; docs/harness-gaps/group-play.md).
	Ranked *bool `json:"ranked,omitempty"`
}

// ScoreBounds are the reachable range, recorded from bot runs.
type ScoreBounds struct {
	Min         float64 `json:"min"`
	Max         float64 `json:"max"`
	MaxRatePerS float64 `json:"max_rate_per_s,omitempty"`
}

// ScoreKind is one row of the score table.
type ScoreKind struct {
	Kind, Direction, CountsWhen, Format string
}

// ScoreKinds is the doc's table: what ranks, the direction and when a run counts.
var ScoreKinds = []ScoreKind{
	{"points", "higher", "any", "{n} points"},
	{"time_to_complete", "lower", "finished", "m:ss.t"},
	{"count_in_time", "higher", "any", "{n}"},
	{"survival_time", "higher", "any", "m:ss.t"},
	{"accuracy", "higher", "finished", "{n}%"},
	{"distance", "higher", "any", "{n} m"},
	{"tiered_points", "higher", "any", "{n} points"},
	{"streak", "higher", "any", "{n} in a row"},
}

var (
	Aggregates = []string{"best", "latest", "sum_week"}
	TieBreaks  = []string{"less time", "earlier"}
)

// Every score is an integer (agreed with Max): time_to_complete and survival_time are whole milliseconds
// (shown as m:ss.t), accuracy is a whole percent, and the other kinds are counts or points.

// msKinds are the kinds measured in whole milliseconds.
var msKinds = []string{"time_to_complete", "survival_time"}

// ScoreUnit is the fixed unit of a kind ("ms", "%"), or "" when the game names it (orders, points, metres).
func ScoreUnit(kind string) string {
	switch {
	case oneOf(kind, msKinds):
		return "ms"
	case kind == "accuracy":
		return "%"
	}
	return ""
}

func scoreKind(k string) (ScoreKind, bool) {
	for _, s := range ScoreKinds {
		if s.Kind == k {
			return s, true
		}
	}
	return ScoreKind{}, false
}

// Feel is the juice, sound and look.
type Feel struct {
	Juice  []string `json:"juice"`
	Sounds string   `json:"sounds"`
	Look   string   `json:"look"`
}

// ---- default score by catalog type ----

// familyScore is the default score kind per family when the type's own scoring text says nothing clearer.
var familyScore = map[string]string{
	"word": "points", "trivia": "points", "knowledge_quiz": "accuracy", "logic_puzzle": "time_to_complete",
	"number_math": "count_in_time", "spatial_puzzle": "time_to_complete", "tile_matching": "points",
	"deduction": "time_to_complete", "memory": "streak", "reaction": "points", "rhythm_music": "accuracy",
	"runner": "distance", "platformer": "time_to_complete", "arcade_shooter": "points", "dodge_survive": "survival_time",
	"sports": "points", "racing": "time_to_complete", "physics_toy": "points", "stack_balance": "points",
	"aim_throw": "points", "catch_collect": "count_in_time", "idle_incremental": "points", "management_sim": "count_in_time",
	"cooking_crafting": "count_in_time", "nurture_pet": "streak", "card": "points", "board": "points", "dice_luck": "points",
	"story_choice": "points", "mystery_narrative": "points", "adventure_rpg": "points", "strategy_tactics": "points",
	"tower_defense": "survival_time", "duel_battle": "points", "party_social": "points", "guess_your_friends": "accuracy",
	"drawing_creative": "points", "music_making": "points", "daily_puzzle": "time_to_complete", "learning": "accuracy",
	"calm_cozy": "points", "horror_tension": "survival_time",
}

// scoringHints read a type's own scoring text, which is more specific than its family. First match wins.
var scoringHints = []struct {
	re   *regexp.Regexp
	kind string
}{
	{regexp.MustCompile(`(?i)\b(tier|tiers|rarity|rarer|rarest|obscur)`), "tiered_points"},
	{regexp.MustCompile(`(?i)\b(fastest|time to (finish|complete|clear)|lowest time|least time|stopwatch|time trial|as fast as)`), "time_to_complete"},
	{regexp.MustCompile(`(?i)\b(how many .* (in|within|before)|per minute|in \d+ ?s(ec)?\b|before the timer)`), "count_in_time"},
	{regexp.MustCompile(`(?i)\b(seconds? (alive|survived)|survival time|how long you (last|survive)|time survived)`), "survival_time"},
	{regexp.MustCompile(`(?i)\b(percent|accuracy|% correct|correct out of)`), "accuracy"},
	{regexp.MustCompile(`(?i)\b(distance|metres|meters|how far)`), "distance"},
	{regexp.MustCompile(`(?i)\b(streak|in a row|longest run)`), "streak"},
}

// DefaultScoreKind is the score kind a type implies: its scoring text first, then its family.
func DefaultScoreKind(t GameType) string {
	for _, h := range scoringHints {
		if h.re.MatchString(t.Scoring) {
			return h.kind
		}
	}
	for _, h := range scoringHints[:2] { // rarity and time trials also show in the name and summary
		if h.re.MatchString(t.Name + " " + t.Summary) {
			return h.kind
		}
	}
	if k, ok := familyScore[t.Family]; ok {
		return k
	}
	return "points"
}

// DefaultScore is the full score model for a kind, with the table's direction, counts_when and format.
func DefaultScore(kind string) Score {
	k, ok := scoreKind(kind)
	if !ok {
		k, _ = scoreKind("points")
	}
	tie := "less time"
	if k.Kind == "time_to_complete" {
		tie = "earlier"
	}
	return Score{Kind: k.Kind, Direction: k.Direction, CountsWhen: k.CountsWhen, Aggregate: "best", TieBreak: tie, Format: k.Format, Unit: ScoreUnit(k.Kind)}
}

// ---- validation ----

var reNumber = regexp.MustCompile(`\d`)

// measurableWords say a target can be measured without a number ("survive", "the rarest answer").
var measurableWords = regexp.MustCompile(`(?i)\b(survive|surviv|fastest|fast as|before|most|least|rarest|highest|lowest|all|every|longest|farthest|furthest|first|clear|finish|complete|reach|without)`)

// Validate checks every part, in order, and fixes what it safely can: the score's direction and counts_when
// follow its kind, bounds are cleared (the gate sets them from bots), and enum fields fall back to the table.
// It returns the problems it could not fix (an empty slice means the spec is usable) and notes on what it fixed.
func (s *Spec) Validate() (problems, fixed []string) {
	bad := func(part, f string, a ...any) { problems = append(problems, part+": "+fmt.Sprintf(f, a...)) }
	fix := func(part, f string, a ...any) { fixed = append(fixed, part+": "+fmt.Sprintf(f, a...)) }
	empty := func(x string) bool { return strings.TrimSpace(x) == "" }

	if s.Spec != SpecVersion {
		fix("spec", "version set to %s", SpecVersion)
		s.Spec = SpecVersion
	}
	// theme
	if empty(s.Theme.World) {
		bad("theme", "world is empty")
	}
	if empty(s.Theme.Tone) {
		bad("theme", "tone is empty")
	}
	if s.Theme.Named == nil {
		s.Theme.Named = strList{}
	}
	// goal: measurable
	if empty(s.Goal.Text) {
		bad("goal", "text is empty")
	}
	if empty(s.Goal.Target) || empty(s.Goal.Measure) {
		bad("goal", "needs a target and the measure that tracks it")
	} else if !reNumber.MatchString(s.Goal.Target) && !measurableWords.MatchString(s.Goal.Target) {
		bad("goal", "target %q is not measurable (give a number or a clear end: survive, clear all, the rarest)", s.Goal.Target)
	}
	// loop
	if empty(s.Loop.Verb) || empty(s.Loop.Feedback) {
		bad("loop", "needs a verb and feedback")
	}
	if !oneOf(s.Loop.Input, Inputs) {
		bad("loop", "input %q is not one of %v", s.Loop.Input, Inputs)
	}
	if s.Loop.CycleSeconds <= 0 || s.Loop.CycleSeconds > 120 {
		bad("loop", "cycle_seconds %.1f is not 0-120", s.Loop.CycleSeconds)
	}
	// pieces
	if len(s.Pieces.Items) == 0 {
		bad("pieces", "no pieces")
	}
	for _, p := range s.Pieces.Items {
		if empty(p.Name) || empty(p.Role) {
			bad("pieces", "a piece needs a name and a role")
		}
	}
	// constraints (a calm game may have none)
	for i := range s.Constraints.Items {
		c := &s.Constraints.Items[i]
		if !oneOf(c.Kind, ConstraintKinds) {
			fix("constraints", "kind %q read as other", c.Kind)
			c.Kind = "other"
		}
		if empty(c.EnforcedBy) {
			bad("constraints", "%s %q has no enforcing rule", c.Kind, c.Value)
		}
	}
	// progression: three steps
	if len(s.Progression.Steps) != 3 {
		bad("progression", "needs 3 steps, has %d", len(s.Progression.Steps))
	}
	// end
	if empty(s.End.Win) {
		bad("end", "win is empty")
	}
	if len(s.End.EndsWhen) == 0 {
		bad("end", "ends_when is empty")
	}
	for _, e := range s.End.EndsWhen {
		if !oneOf(e, EndReasons) {
			bad("end", "ends_when %q is not one of %v", e, EndReasons)
		}
	}
	if ss := s.End.SessionSeconds; len(ss) != 2 || ss[0] < 5 || ss[0] > ss[1] || ss[1] > 600 {
		bad("end", "session_seconds must be [min, max] within 5-600")
	}
	// score
	sc := &s.Score
	k, ok := scoreKind(sc.Kind)
	if !ok {
		bad("score", "kind %q is not one of the score kinds", sc.Kind)
	} else {
		if sc.Direction != k.Direction {
			fix("score", "direction %q set to %q for %s", sc.Direction, k.Direction, k.Kind)
			sc.Direction = k.Direction
		}
		if k.CountsWhen == "finished" && sc.CountsWhen != "finished" {
			fix("score", "counts_when set to finished for %s", k.Kind)
			sc.CountsWhen = "finished"
		}
		if empty(sc.Format) {
			sc.Format = k.Format
		}
		if u := ScoreUnit(k.Kind); u != "" && sc.Unit != u {
			fix("score", "unit %q set to %q: %s is a whole number of %s", sc.Unit, u, k.Kind, u)
			sc.Unit = u
		}
		if oneOf(k.Kind, msKinds) && sc.Format != "m:ss.t" {
			fix("score", "format %q set to m:ss.t for milliseconds", sc.Format)
			sc.Format = "m:ss.t"
		}
	}
	if !oneOf(sc.CountsWhen, []string{"finished", "any"}) {
		fix("score", "counts_when %q set to any", sc.CountsWhen)
		sc.CountsWhen = "any"
	}
	if !oneOf(sc.Aggregate, Aggregates) {
		fix("score", "aggregate %q set to best", sc.Aggregate)
		sc.Aggregate = "best"
	}
	if !oneOf(sc.TieBreak, TieBreaks) {
		fix("score", "tie_break %q set to less time", sc.TieBreak)
		sc.TieBreak = "less time"
	}
	if sc.Bounds != nil {
		fix("score", "bounds cleared: the gate sets them from the bots")
		sc.Bounds = nil
	}
	if len(sc.Events) == 0 {
		bad("score", "no score events")
	}
	if empty(sc.Measures) {
		bad("score", "measures is empty")
	} else if !shareWord(sc.Measures+" "+sc.Unit, s.Goal.Measure+" "+s.Goal.Target+" "+s.Goal.Text) {
		bad("score", "measures %q doesn't measure the goal (%q)", sc.Measures, s.Goal.Measure)
	}
	if sc.Kind == "time_to_complete" && !oneOf("target_reached", s.End.EndsWhen) && !oneOf("all_prompts_done", s.End.EndsWhen) && !oneOf("board_full", s.End.EndsWhen) {
		bad("score", "a time to complete needs a run that can finish (end.ends_when target_reached or all_prompts_done)")
	}
	// social (group play) and feel
	s.validateSocial(bad, fix)
	if len(s.Feel.Juice) == 0 {
		bad("feel", "no juice moments")
	}
	return problems, fixed
}

// shareWord reports whether two texts share a content word (stemmed), so "orders completed" measures
// "clear 20 orders".
func shareWord(a, b string) bool {
	in := map[string]bool{}
	for _, t := range Tokens(b) {
		in[t] = true
	}
	for _, t := range Tokens(a) {
		if in[t] && !genericScoreWord[t] {
			return true
		}
	}
	return false
}

var genericScoreWord = map[string]bool{"point": true, "score": true, "total": true, "number": true}

// ErrSpecInvalid wraps the problems of a spec that can't be used.
var ErrSpecInvalid = errors.New("harness: the game spec has problems")

// flexString reads a JSON string, number or boolean as text (Muse writes "count": 20 as often as "20").
type flexString string

func (f *flexString) UnmarshalJSON(b []byte) error {
	var s string
	if json.Unmarshal(b, &s) == nil {
		*f = flexString(s)
		return nil
	}
	var v any
	if err := json.Unmarshal(b, &v); err != nil {
		return err
	}
	switch v.(type) {
	case float64, bool, nil:
		*f = flexString(strings.TrimSpace(string(b)))
		return nil
	}
	return fmt.Errorf("expected text, got %s", b)
}
