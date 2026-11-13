package harness

import (
	"context"
	"encoding/json"
	"fmt"
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
	"theme": `"theme": {"world": string, "named": [string], "tone": string, "look": string, "terms": [string]}
   named: the franchise, characters and places the person named, verbatim (real names are fine when asked). terms: 3-8 words players must see.`,
	"goal": `"goal": {"text": string, "target": string, "measure": string}
   target is MEASURABLE: a number ("clear 20 orders", "50 points") or a clear end ("survive", "find the rarest answer", "clear every tile"). measure names the quantity that tracks it ("orders completed", "seconds alive").`,
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
	"score": `"score": {"kind": KIND, "measures": string, "unit": string, "direction": "higher"|"lower", "counts_when": "finished"|"any", "aggregate": "best"|"latest"|"sum_week", "tie_break": "less time"|"fewer mistakes"|"earlier", "format": string, "events": [string], "reason": string}
   the score measures the goal under the constraints: measures uses the goal's measure words. Kinds (direction, counts when):
   points (higher, any); time_to_complete (lower, finished only); count_in_time (higher, any); survival_time (higher, any);
   accuracy (higher, finished only); distance (higher, any); tiered_points (higher, any: rarity tiers); streak (higher, any).
   events: the game events that change the score. format: how it is shown ("{n} orders", "m:ss.t", "{n}%"). Leave out bounds.`,
	"social": `"social": {"share": string, "challenge": string, "same_seed": boolean, "board": string}
   share is spoiler-free score text; a challenge replays the same seed; board says how the Group board reads.`,
	"feel": `"feel": {"juice": [string], "sounds": string, "look": string}
   2-4 juice moments (what flashes, pops or buzzes and when), the sound set and the look in a few words.`,
}

// specSchema is the prompt section for the given parts, with the default score.
func specSchema(parts []string, def Score) string {
	var sb strings.Builder
	sb.WriteString(`SPEC is {"spec": "game-spec/1", PARTS}, where PARTS are, filled in this order (each part must agree with the ones before it):` + "\n")
	for _, p := range parts {
		sb.WriteString(" " + partSchemas[p] + "\n")
	}
	if oneOf("score", parts) {
		fmt.Fprintf(&sb, "Default score for this game's type: kind %q (direction %s, counts when %s). Use it unless the goal needs another kind; then say why in score.reason.\n", def.Kind, def.Direction, def.CountsWhen)
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
func (p *Planner) finishSpec(ctx context.Context, plan *Plan, raw json.RawMessage, in PlanInput, def Score) error {
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
			got, err := p.Muse.JSON(ctx, strings.Replace(stageSystem, "SPECSCHEMA", specSchema(stage, def), 1), stageUser(in, parts, stage))
			plan.Calls = append(plan.Calls, CallTiming{Step: strings.Join(stage, "+"), Ms: ms(time.Since(t))})
			if err != nil {
				return err
			}
			mergeParts(parts, got)
		}
	}
	spec, decodeProblems := decodeSpec(parts)
	applyScoreDefault(spec, def, plan)
	problems, fixed := spec.Validate()
	problems = append(decodeProblems, problems...)
	plan.Notes = append(plan.Notes, fixed...)
	if len(problems) > 0 {
		failing := failingParts(problems)
		t := time.Now()
		got, err := p.Muse.JSON(ctx, strings.Replace(repairSystem, "SPECSCHEMA", specSchema(failing, def), 1), repairUser(in, parts, problems, failing))
		plan.Calls = append(plan.Calls, CallTiming{Step: "repair:" + strings.Join(failing, "+"), Ms: ms(time.Since(t))})
		if err == nil {
			mergeParts(parts, got)
			s2, dp := decodeSpec(parts)
			applyScoreDefault(s2, def, plan)
			problems, fixed = s2.Validate()
			problems = append(dp, problems...)
			plan.Notes = append(plan.Notes, fixed...)
			spec = s2
		} else {
			plan.Notes = append(plan.Notes, "spec repair failed: "+err.Error())
		}
	}
	plan.Spec = spec
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
