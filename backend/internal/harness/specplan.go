package harness

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"time"
)

// Filling the game spec: the parts' schemas for the prompt, the default score from the catalog type,
// the chained mode, and one repair round for parts that fail their check.

// specStages are the parts in fill order, grouped for the chained mode.
var specStages = [][]string{
	{"theme", "goal", "loop", "pieces"},
	{"constraints", "progression", "end"},
	{"score", "social", "feel"},
}

// partSchemas are each part's JSON shape and guidance, as the prompt states them.
var partSchemas = map[string]string{
	"theme": `"theme": {"world": string, "named": [string], "tone": string, "look": string, "terms": [string], "sponsor": {"name": string, "products": [string], "tone": string} | null}
   named: the franchise, characters and places the person named, verbatim (real names are fine when asked). terms: 3-8 words players must see.
   sponsor: only when a brand sponsors or presents the game (see Understood); its real name, 2-5 real products the game uses as pieces, and the tone. Real names, colors and logos are fine.`,
	"goal": `"goal": {"text": string, "target": string, "measure": string}
   target is MEASURABLE, in THIS game's own words: a number ("<verb> <N> <things>") or a clear end ("survive to <end>", "<verb> every <thing>", "reach <ending>"). measure names the quantity that tracks it ("<things> <verbed>", "seconds alive"). The <...> patterns are placeholders, not content: never copy them or any example from another game.`,
	"loop": `"loop": {"verb": string, "sees": string, "input": "tap"|"drag"|"swipe"|"hold"|"type"|"tilt"|"draw"|"voice"|"multi_touch", "feedback": string, "cycle_seconds": number}
   one cycle of play: what the player sees, does and gets back, and how long it takes (0.3-60 s).`,
	"pieces": `"pieces": {"items": [{"name": string, "role": string, "count": string, "content": string}]}
   every entity and content source a rule will name; content says where it comes from (answer bank, word list, levels) and is big enough for the length.`,
	"constraints": `"constraints": {"items": [{"kind": "time"|"lives"|"moves"|"accuracy"|"rate"|"space"|"other", "value": string, "enforced_by": string, "hud": string}]}
   the pressure: each one is enforced by a rule (enforced_by) and shown in the HUD (hud). A calm game may have none.`,
	"progression": `"progression": {"steps": [{"at": string, "change": string}], "levers": [string]}
   EXACTLY 3 steps of the difficulty arc (what ramps and when); levers are the knobs (speed, timer, prompt breadth).`,
	"end": `"end": {"win": string, "lose": string, "ends_when": ["time_out"|"lives_gone"|"target_reached"|"all_prompts_done"|"board_full"|"story_end"|"player_stops"], "session_seconds": [min, max]}
   every run ends within session_seconds (5-600). lose is "" when there is no losing.`,
	"score": `"score": {"kind": KIND, "measures": string, "unit": string, "direction": "higher"|"lower", "counts_when": "finished"|"any", "aggregate": "best"|"latest"|"sum_week", "tie_break": "less time"|"earlier", "format": string, "events": [string], "reason": string}
   the score measures the goal under the constraints: measures uses the goal's measure words. Every score is an INTEGER.
   Kinds (direction, counts when, unit): points (higher, any, points); time_to_complete (lower, finished only, whole ms);
   count_in_time (higher, any, a count); survival_time (higher, any, whole ms); accuracy (higher, finished only, whole percent);
   distance (higher, any, whole metres or tiles); tiered_points (higher, any: rarity-tier points); streak (higher, any, a count).
   events: the game events that change the score. format: how it is shown: "m:ss.t" for the ms kinds, "{n}%" for accuracy,
   otherwise "{n} <unit>". Leave out bounds. A goal that caps something ("in N <things> or less") never scores each <thing> used:
   score what is left under the cap, or the ending reached. A stacking game lost when the stack tops out never scores the
   stack's height (it is highest when the player loses): score rows cleared, pieces placed or time alive. A game with no right answer (ratings, tier lists, taste) sets
   "ranked": false and compares agreement in social.`,
	"social": `"social": {"mode": "same_seed_async"|"series"|"group_round"|"weekly_board"|"opinion_compare", "round_seconds": number,
   "result": {"kind": "score"|"ending"|"picks"|"creation", "compare": "score"|"ending"|"agreement"|"none", "display": string, "endings": [string], "state": [string]},
   "share_line": string, "best_of": 3|5, "board": string, "same_seed": true, "reason": string}
   Group play: no live multiplayer. Each person plays this single-player run on the SAME seed, whenever they like, in a chat
   or a Group; results are compared after. mode is what sending it starts: same_seed_async (head-to-head in a thread),
   series (best_of 3 or 5), group_round (everyone in the chat or Group ranked), opinion_compare (no right answer).
   round_seconds: one turn, 30-90 s, inside end.session_seconds. result: what a run leaves and how two runs compare:
   score (the score ranks), ending (story games: endings named best first in endings; then fewer choices or the score),
   picks + agreement (ratings, ranks, tier lists, this-or-that: % of picks that match a friend's or the group's; score.ranked false),
   creation + none (something made, shown side by side). display is the result line ("{score}", "{ending} in {choices} choices",
   "{agreement}% in sync"). state names the game state that holds the result at the end. share_line is one spoiler-free
   line posted back to the thread with {name} and {result} (never an answer or an ending's name). board says how the
   Group board reads.`,
	"feel": `"feel": {"juice": [string], "sounds": string, "look": string}
   2-4 juice moments (what flashes, pops or buzzes and when), the sound set and the look in a few words.`,
}

// specSchema is the prompt section for the given parts, with the default score.
func specSchema(parts []string, def Score, social Social) string {
	var sb strings.Builder
	sb.WriteString(`SPEC is {"spec": "game-spec/1", PARTS}, where PARTS are, filled in this order (each part must agree with the ones before it):` + "\n")
	for _, p := range parts {
		sb.WriteString(" " + partSchemas[p] + "\n")
	}
	if oneOf("score", parts) {
		fmt.Fprintf(&sb, "Default score for this game's type: kind %q (direction %s, counts when %s). Use it unless the goal needs another kind; then say why in score.reason.\n", def.Kind, def.Direction, def.CountsWhen)
	}
	if oneOf("social", parts) && social.Mode != "" {
		fmt.Fprintf(&sb, "Default social for this game: mode %q, result {kind %q, compare %q}. Use it unless the game needs another; then say why in social.reason.\n", social.Mode, social.Result.Kind, social.Result.Compare)
	}
	return strings.TrimRight(sb.String(), "\n")
}

// defaultScoreFor is the default score of a retrieved type card.
func defaultScoreFor(t ContextType) Score {
	return DefaultScore(DefaultScoreKind(GameType{ID: t.ID, Name: t.Name, Family: t.Family, Summary: t.Summary, Scoring: t.Scoring}))
}

const stageSystem = `You are Muse Studio's game planner, continuing a game spec. The earlier parts are settled; fill only the parts
asked for, so they agree with the earlier parts and the request. Reply with one JSON object holding just those parts.

SPECSCHEMA`

const repairSystem = `You are Muse Studio's game planner. Some parts of a game spec failed their checks. Rewrite only those parts
so they pass, keeping them consistent with the other parts. Reply with one JSON object holding just the rewritten parts.

SPECSCHEMA`

// finishSpec decodes the spec from the plan reply, fills the remaining stages in chained mode, applies the
// score default rule, validates every part, and runs one repair round on the parts that fail.
func (p *Planner) finishSpec(ctx context.Context, plan *Plan, raw json.RawMessage, in PlanInput, def Score, sdef Social) error {
	var r struct {
		Spec json.RawMessage `json:"spec"`
	}
	_ = json.Unmarshal(raw, &r)
	parts := map[string]json.RawMessage{}
	if len(r.Spec) > 0 {
		_ = json.Unmarshal(r.Spec, &parts)
	}
	if p.Chain {
		for _, stage := range specStages[1:] {
			t := time.Now()
			got, err := p.Muse.JSON(ctx, strings.Replace(stageSystem, "SPECSCHEMA", specSchema(stage, def, sdef), 1), stageUser(in, parts, stage))
			plan.Calls = append(plan.Calls, CallTiming{Step: strings.Join(stage, "+"), Ms: ms(time.Since(t))})
			if err != nil {
				return err
			}
			mergeParts(parts, got)
		}
	}
	spec, decodeProblems := decodeSpec(parts)
	applyScoreDefault(spec, def, plan)
	applySocialDefault(spec, sdef, plan)
	problems, fixed := spec.Validate()
	problems = append(append(decodeProblems, problems...), requestChecks(spec, in)...)
	problems = append(problems, requirementChecks(spec, in)...)
	plan.Notes = append(plan.Notes, fixed...)
	if len(problems) > 0 {
		failing := failingParts(problems)
		t := time.Now()
		got, err := p.Muse.JSON(ctx, strings.Replace(repairSystem, "SPECSCHEMA", specSchema(failing, def, sdef), 1), repairUser(in, parts, problems, failing))
		plan.Calls = append(plan.Calls, CallTiming{Step: "repair:" + strings.Join(failing, "+"), Ms: ms(time.Since(t))})
		if err == nil {
			mergeParts(parts, got)
			s2, dp := decodeSpec(parts)
			applyScoreDefault(s2, def, plan)
			applySocialDefault(s2, sdef, plan)
			problems, fixed = s2.Validate()
			problems = append(append(dp, problems...), requestChecks(s2, in)...)
			problems = append(problems, requirementChecks(s2, in)...)
			plan.Notes = append(plan.Notes, fixed...)
			spec = s2
		} else {
			plan.Notes = append(plan.Notes, "spec repair failed: "+err.Error())
		}
	}
	if spec.Theme.Sponsor == nil && in.Context.Understanding.Sponsor != nil {
		sp := *in.Context.Understanding.Sponsor
		spec.Theme.Sponsor = &sp
		plan.Notes = append(plan.Notes, "theme: sponsor "+sp.Name+" copied from the understanding")
	}
	applyLookPreference(spec, plan, in)
	plan.Spec = spec
	finishArt(plan, in)
	plan.Issues = uniq(problems)
	return nil
}

// decodeSpec decodes each part on its own, so one malformed part becomes a problem for the repair round
// instead of losing the whole spec.
func decodeSpec(parts map[string]json.RawMessage) (*Spec, []string) {
	s := &Spec{Spec: SpecVersion}
	targets := map[string]any{"theme": &s.Theme, "goal": &s.Goal, "loop": &s.Loop, "pieces": &s.Pieces,
		"constraints": &s.Constraints, "progression": &s.Progression, "end": &s.End, "score": &s.Score,
		"social": &s.Social, "feel": &s.Feel}
	var problems []string
	for _, k := range SpecParts {
		raw, ok := parts[k]
		if !ok {
			problems = append(problems, k+": missing")
			continue
		}
		if err := json.Unmarshal(raw, targets[k]); err != nil {
			problems = append(problems, fmt.Sprintf("%s: doesn't match its schema (%v)", k, err))
		}
	}
	return s, problems
}

// mergeParts copies the spec parts in a reply (bare, or under "spec") into parts.
func mergeParts(parts map[string]json.RawMessage, reply json.RawMessage) {
	var got map[string]json.RawMessage
	if json.Unmarshal(reply, &got) != nil {
		return
	}
	if inner, ok := got["spec"]; ok {
		var m map[string]json.RawMessage
		if json.Unmarshal(inner, &m) == nil {
			got = m
		}
	}
	for _, k := range SpecParts {
		if v, ok := got[k]; ok {
			parts[k] = v
		}
	}
}

// applyScoreDefault keeps the type's default score kind unless Muse gave a reason to change it, and fills
// the table's defaults for anything Muse left empty.
func applyScoreDefault(s *Spec, def Score, plan *Plan) {
	sc := &s.Score
	switch {
	case sc.Kind == "":
		*sc = mergeScore(def, *sc)
		plan.Notes = append(plan.Notes, fmt.Sprintf("score: no kind given; using the type's default %s", def.Kind))
	case sc.Kind != def.Kind && strings.TrimSpace(sc.Reason) == "":
		plan.Notes = append(plan.Notes, fmt.Sprintf("score: kind %s changed back to the type's default %s (no reason given)", sc.Kind, def.Kind))
		sc.Kind = def.Kind
	}
	if _, ok := scoreKind(sc.Kind); ok {
		k, _ := scoreKind(sc.Kind)
		if sc.Format == "" {
			sc.Format = k.Format
		}
		if sc.Aggregate == "" {
			sc.Aggregate = "best"
		}
	}
}

func mergeScore(def, got Score) Score {
	out := def
	if got.Measures != "" {
		out.Measures = got.Measures
	}
	if got.Unit != "" {
		out.Unit = got.Unit
	}
	if len(got.Events) > 0 {
		out.Events = got.Events
	}
	if got.Format != "" {
		out.Format = got.Format
	}
	return out
}

// failingParts are the parts named by the problems, plus goal when the score doesn't measure it.
func failingParts(problems []string) []string {
	seen := map[string]bool{}
	for _, pr := range problems {
		part, _, _ := strings.Cut(pr, ":")
		seen[part] = true
	}
	var out []string
	for _, p := range SpecParts {
		if seen[p] {
			out = append(out, p)
		}
	}
	return out
}

func stageUser(in PlanInput, parts map[string]json.RawMessage, stage []string) string {
	var sb strings.Builder
	fmt.Fprintf(&sb, "Request: %q\n\n", in.Request)
	if len(in.Context.Types) > 0 {
		t := in.Context.Types[0]
		fmt.Fprintf(&sb, "Main game type: %s (%s): %s Loop: %s Win: %s Scoring: %s\n\n", t.ID, t.Family, t.Summary, t.CoreLoop, t.Win, t.Scoring)
	}
	earlier, _ := json.Marshal(parts)
	fmt.Fprintf(&sb, "Spec parts so far:\n%s\n\nFill: %s", earlier, strings.Join(stage, ", "))
	return sb.String()
}

func repairUser(in PlanInput, parts map[string]json.RawMessage, problems, failing []string) string {
	var sb strings.Builder
	fmt.Fprintf(&sb, "Request: %q\n\n", in.Request)
	whole, _ := json.Marshal(parts)
	fmt.Fprintf(&sb, "The spec:\n%s\n\nProblems:\n- %s\n\nRewrite: %s", whole, strings.Join(problems, "\n- "), strings.Join(failing, ", "))
	return sb.String()
}

// reStyleWords are words that name an art style (variants.mjs STYLE_WORDS): a request with one keeps its own look.
var reStyleWords = regexp.MustCompile(`(?i)\b(pixel|8[- ]?bit|16[- ]?bit|retro|neon|synthwave|vaporwave|watercolou?r|cartoon|anime|manga|chibi|kawaii|cute|minimal(ist)?|flat|low[- ]?poly|3d|clay|claymation|noir|sketch|hand[- ]?drawn|doodle|crayon|paper|cut[- ]?out|comic|pastel|ukiyo|art deco|cyberpunk|steampunk|gothic|realistic|photo|monochrome|black and white|lego|isometric|storybook|riso|halftone|glitch|y2k|cozy|spooky|art style|drawn like|looks like|aesthetic|vibe)\b`)

func namesStyle(request string) bool { return reStyleWords.MatchString(request) }

// lookSlot reports a checklist slot about the art style.
func lookSlot(id string) bool {
	return id == "look" || id == "picture_style" || id == "art_style" || id == "visual_style" || id == "style"
}

// applyLookPreference: when the person picked a look before and this request names no style, the pick is
// the look (spec.theme.look), and the art style slot it settles is theirs (guessed false), not a question.
func applyLookPreference(spec *Spec, plan *Plan, in PlanInput) {
	p := lookPreference(in.Context.Preferences)
	if p == nil || namesStyle(in.Request) {
		return
	}
	look := strings.TrimSpace(p.Chosen.Value)
	if look == "" {
		look = strings.TrimSpace(p.Chosen.Label)
	}
	if spec != nil && spec.Theme.Look != look {
		spec.Theme.Look = look
		plan.Notes = append(plan.Notes, fmt.Sprintf("theme: look %q from the person's earlier pick", clip(look, 80)))
	}
	for i := range plan.Clarify {
		if lookSlot(plan.Clarify[i].Slot) {
			plan.Clarify[i].Value = look
			plan.Clarify[i].Guessed = false
			plan.Clarify[i].Question = ""
			plan.Clarify[i].Choices = nil
		}
	}
}

var reContradictPath = regexp.MustCompile(`\(/([a-z_]+)/`)

// requirementChecks sets spec.requirements and returns each plan contradiction as a problem on the part
// that says the wrong number ("pieces: requirements r2: the plan says ..."), so the repair round fixes it
// and what's left goes to spec_issues.
func requirementChecks(spec *Spec, in PlanInput) []string {
	if spec == nil || len(in.Requirements) == 0 {
		return nil
	}
	spec.Requirements = in.Requirements
	var out []string
	for _, c := range planContradictions(in.Requirements, spec) {
		part := "constraints"
		if m := reContradictPath.FindStringSubmatch(c.Message); m != nil && oneOf(m[1], SpecParts) {
			part = m[1]
		}
		out = append(out, fmt.Sprintf("%s: requirements %s: %s", part, c.Requirement, c.Message))
	}
	return out
}
