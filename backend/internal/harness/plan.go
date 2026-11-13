package harness

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"
)

// Step 4: plan (docs/HARNESS_V2.md). Muse Wonder reads the request, the retrieved type and tool cards and the
// clarification checklists, and writes the game's anatomy (game-anatomy/0.1, docs/BUBBLES.md 7.13), the
// design block, which types and tools it uses, the gaps it plans around, and what it settled for each
// checklist slot. Go then checks every id against the context and fills whatever Muse left out, so the
// plan the generator gets is always consistent.

// AnatomyVersion is the anatomy format the planner writes (the generator's anatomy.mjs).
const AnatomyVersion = "game-anatomy/0.1"

// MaxQuestions is the most clarifying questions one plan may ask.
const MaxQuestions = 2

// Plan is the `plan` in the generator's context.
type Plan struct {
	Anatomy json.RawMessage `json:"anatomy"`
	Design  Design          `json:"design"`
	TypeIDs []string        `json:"type_ids"`
	Blend   string          `json:"blend,omitempty"` // how the types combine ("rare-answer scoring from …, the timer from …")
	ToolIDs []string        `json:"tool_ids"`
	Gaps    []Gap           `json:"gaps"`
	Clarify []Clarify       `json:"clarify"`
	Spec    *Spec           `json:"spec"`                  // game-spec/1
	Issues  []string        `json:"spec_issues,omitempty"` // spec problems left after the repair round
	Notes   []string        `json:"notes,omitempty"`       // what Go corrected
	// Art is "image" when muse-image draws the pictures (an art-heavy plan: a story, or 3+ drawn pieces).
	Art   string       `json:"art,omitempty"`
	Calls []CallTiming `json:"calls,omitempty"` // each Muse call the plan took
}

// CallTiming is one Muse call of the planner.
type CallTiming struct {
	Step string `json:"step"`
	Ms   int64  `json:"ms"`
}

// Design is the design block the gold games carry.
type Design struct {
	Pitch string  `json:"pitch"`
	Theme strList `json:"theme"`
	Verb  string  `json:"verb"`
	Twist string  `json:"twist"`
	Arc   strList `json:"arc"`
}

// Gap is a tool the idea needs that isn't built yet, and what the game does instead.
type Gap struct {
	Tool          string `json:"tool"`
	Status        string `json:"status"` // the tool's catalog status: planned or gap
	Approximation string `json:"approximation"`
	Familiarity   string `json:"familiarity"` // known, approximate or unfamiliar
}

// Clarify is one checklist slot as settled.
type Clarify struct {
	Slot     string   `json:"slot"`
	Value    string   `json:"value"`
	Guessed  bool     `json:"guessed"`            // false only when the request said it
	Question string   `json:"question,omitempty"` // set on at most MaxQuestions slots
	Choices  []string `json:"choices,omitempty"`
}

// strList reads a JSON string or array of strings.
type strList []string

func (s *strList) UnmarshalJSON(b []byte) error {
	var one string
	if json.Unmarshal(b, &one) == nil {
		if one = strings.TrimSpace(one); one != "" {
			*s = strList{one}
		} else {
			*s = strList{}
		}
		return nil
	}
	var many []string
	if err := json.Unmarshal(b, &many); err != nil {
		return err
	}
	*s = strList(many)
	return nil
}

// Planner writes plans.
type Planner struct {
	Muse       MuseJSON   // PlanMuse in production: muse-wonder-1.0, 12000 tokens, 90 s
	Checklists Checklists // may be empty
	// Chain fills the spec in three calls (theme–pieces with the plan; constraints, progression and end;
	// then score, social and feel), each seeing the parts before it. Off: one call writes everything.
	Chain bool
	// Visual runs the art-direction stage after the spec (visual.go). A failure there only adds a note.
	Visual bool
	// Requirements turns on the Muse requirements extraction (requirements.go; HARNESS_REQUIREMENTS, on by
	// default in the server and harness-query). Off, the code pass alone runs, with no Muse call.
	Requirements bool
	// ReqMuse is the extraction's transport (muse-spark-1.3); nil uses Muse.
	ReqMuse MuseJSON
}

// PlanInput is everything the planner reads.
type PlanInput struct {
	Request   string
	Pack      ContextPack
	Context   GenContext // the cards the generator will get (BuildContext)
	Fragments []GameTool // the engine's fragments, for the anatomy's familiarity
	// Unbuilt are the catalog's planned and gap tools. A request whose words hit one's name or aliases gets a
	// gap entry even when retrieval didn't send that tool, so a need is never dropped silently.
	Unbuilt []GameTool
	// Requirements are the person's stated requirements (the planner's first stage fills them).
	Requirements []Requirement
}

const planSystem = `You are Muse Studio's game planner. A person asked for a tiny phone game. A search of our game catalog found
the game types (mechanics) and tools (building blocks) below. Plan the game from them: pick the type or types that
fit, say how they blend, and take the idea apart into its working parts so the build follows the person's mechanics,
not just their style.

Reply with one JSON object only:
{"anatomy": ANATOMY, "spec": SPEC, "design": {"pitch": string, "theme": [string], "verb": string, "twist": string, "arc": [string]},
 "type_ids": [string], "blend": string, "tool_ids": [string],
 "gaps": [{"tool": string, "approximation": string, "familiarity": "known"|"approximate"|"unfamiliar"}],
 "clarify": [{"slot": string, "value": string, "guessed": boolean, "question": string|null, "choices": [string]}]}

ANATOMY is {"anatomy": "game-anatomy/0.1", "title": string, "genre": "word"|"puzzle"|"action"|"story"|"party",
 "parts": {
  "core_loop":  {"text": string, META},
  "verbs":      {"items": [string], META},
  "pieces":     {"items": [{"name": string, "has": [string]}], META},
  "state":      {"items": [{"name": string, "type": string}], META},
  "rules":      [{"n": number, "text": string, "check": string, META}],
  "end":        {"win": string|null, "lose": string|null, "score": string|null, META},
  "structure":  {"turns": string, "timing": string, "length_s": [number, number], META},
  "randomness": {"seed": string, META},
  "share":      {"grid": string, META},
  "theme":      {"text": string, META}
 }}
META is: "source": "you"|"guess", "familiarity": "known"|"approximate"|"unfamiliar",
 "plan": "fragment:<id>"|"custom:<builtin>, <builtin> - <what they do>"|"gate:<playtest check>"|"engine-gap:<name>",
 "question": string|null, "options": [string]

SPECSCHEMA

Rules
- type_ids and tool_ids: only ids from the cards below. Prefer the first types; blend two only when the request needs both.
- gaps: every tool you rely on whose status is "planned" or "gap", each with the approximation the game uses instead
  (built from shipped tools or plain rules) and its familiarity. When the REQUEST asks for something only an unbuilt
  tool does (a map, a sound to hear, a photo, typed questions, comparing with everyone), list that tool in gaps with an
  honest approximation. Never drop a request's feature silently, and never promise content nothing can supply.
- Anatomy familiarity is mechanical: "known" = plan "fragment:<id>" with an id from the fragment list; "approximate" =
  custom rules from engine builtins; "unfamiliar" = needs an engine gap ("engine-gap:<name>"). Use "gate:<check>" for a
  rule a playtest must confirm. rules are numbered, one testable sentence each, with a "check".
- source: "you" when the person's words say it, "guess" when you chose it. Vague requests get concrete picks marked
  "guess" ("6 tries, picked by Muse").
- Clarification: ask only when the answer changes the rules or the content in a way a wrong guess would spoil. Never
  ask who plays (the person picks the chat or Group when they send it) and never ask for a theme when the game's
  content isn't themed (numbers, shapes, reflexes). A named game with a clear mechanic usually needs no question.
  Work through every checklist slot below. Fill each from the request (extrapolate_from says where to
  look): guessed=false. A slot nothing speaks to takes its default (or a better guess): guessed=true. Ask only when a
  "required" slot's ask_when holds, using the slot's ask and choices, and AT MOST 2 questions in total; when you ask,
  still give your best guess as value. Put the same questions on the matching anatomy parts.
- spec.requirements lists the person's own words. Every part you write must agree with each quote: the exact counts,
  seconds, lives, names and controls. Never write a different number. (Go fills spec.requirements; don't write it.)
- art_style (when listed): the request's own style words win (guessed false). When the game is art-heavy (a story
  with characters, or 3 or more drawn things) and nothing names a style, you may ask it (it counts toward the 2) with
  3-4 styles that fit this theme as choices; the app adds Other. Otherwise guess one that fits and say it in the
  anatomy ("I'm drawing it as bold cartoon art"). The value goes to spec.theme.art_style.
- theme: when the person names a theme, franchise or brand, keep those words verbatim (source "you"). Honor it in
  names, art and words; the mechanics stay original, and never copy a specific existing game's levels, layouts or art.
- Played by touch on a phone: taps, drags, swipes and an on-screen keyboard. Plain words, sentence case, short texts.
- length_s is 10 to 180 seconds.
- Names: real brands, creators, franchises, characters and real people the person names keep their real names, as
  written (no made-up stand-ins). Real people are drawn only as cartoons or caricatures, never photorealistic, and no
  recorded song or audio is copied.
- Group play: every game is a single-player run that friends play on the same seed, each on their own turn, in a chat or
  a Group, and compare after. So it must be fair on a shared seed (every random draw from the seed, nothing from the
  device or the clock), a round fits a chat (30-90 s), and the run ends on one clear result line. A game with no right
  answer (rating, ranking taste, tier lists, this-or-that) compares agreement, not a score.`

// Plan asks Muse for a plan and validates it against the input. An error means no usable plan.
func (p *Planner) Plan(ctx context.Context, in PlanInput) (*Plan, error) {
	if p.Muse == nil {
		return nil, errors.New("harness: no Muse client for the planner")
	}
	if len(in.Context.Types) == 0 {
		return nil, errors.New("harness: nothing retrieved to plan from")
	}
	lists := p.Checklists.withArtStyle(p.checklistsFor(in.Context.Types), in.Context.Types)
	parts := SpecParts
	if p.Chain {
		parts = specStages[0]
	}
	def := defaultScoreFor(in.Context.Types[0])
	sdef := DefaultSocial(in.Context.Types[0], in.Request)
	system := strings.Replace(planSystem, "SPECSCHEMA", specSchema(parts, def, sdef), 1)
	// First stage: the person's requirements (code pass, plus one Muse call when on).
	pre := &Plan{}
	if ex := p.extractRequirements(ctx, in.Request, pre); ex != nil {
		in.Requirements = ex.Requirements
		for _, is := range ex.Issues {
			pre.Notes = append(pre.Notes, "requirements: "+is.Code+" "+is.Message)
		}
		pre.Notes = append(pre.Notes, fmt.Sprintf("requirements: %d by %s", len(ex.Requirements), ex.By))
	}
	t := time.Now()
	raw, err := p.Muse.JSON(ctx, system, planUser(in, lists))
	if err != nil {
		return nil, err
	}
	calls := append(pre.Calls, CallTiming{Step: "plan", Ms: ms(time.Since(t))})
	plan, err := ValidatePlan(raw, in, lists)
	if err != nil {
		return nil, err
	}
	plan.Calls = calls
	plan.Notes = append(pre.Notes, plan.Notes...)
	if err := p.finishSpec(ctx, plan, raw, in, def, sdef); err != nil {
		return nil, err
	}
	if p.Visual {
		p.planVisual(ctx, plan, in)
	}
	return plan, nil
}

// checklistFor is a checklist with the type ids it was chosen for.
type checklistFor struct {
	Family string    `json:"family"`
	For    []string  `json:"for_types"`
	List   Checklist `json:"-"`
	Slots  []Slot    `json:"slots"`
}

// checklistsFor picks the checklist of each of the first three retrieved types, once each.
func (p *Planner) checklistsFor(types []ContextType) []checklistFor {
	var out []checklistFor
	idx := map[*Checklist]int{}
	for i, t := range types {
		if i >= 3 {
			break
		}
		cl := p.Checklists.For(GameType{ID: t.ID, Family: t.Family})
		if cl == nil {
			continue
		}
		if j, ok := idx[cl]; ok {
			out[j].For = append(out[j].For, t.ID)
			continue
		}
		idx[cl] = len(out)
		out = append(out, checklistFor{Family: t.Family, For: []string{t.ID}, List: *cl, Slots: cl.Slots})
	}
	return out
}

func planUser(in PlanInput, lists []checklistFor) string {
	var sb strings.Builder
	fmt.Fprintf(&sb, "Request: %q\n\n", in.Request)
	u := in.Context.Understanding
	fmt.Fprintf(&sb, "Understood: named %v, theme %v, verbs %v, inputs %v, families %v, players %s\n",
		u.NamedRefs, u.Theme, u.Verbs, u.Inputs, u.Families, u.Players)
	if u.Sponsor != nil {
		sp, _ := json.Marshal(u.Sponsor)
		fmt.Fprintf(&sb, "Sponsor: %s (put it in spec.theme.sponsor)\n", sp)
	}
	if len(in.Context.Preferences) > 0 {
		sb.WriteString("The person's earlier picks between versions (lean that way):\n")
		for _, p := range in.Context.Preferences {
			var not []string
			for _, r := range p.Rejected {
				not = append(not, strconv.Quote(r.Label))
			}
			fmt.Fprintf(&sb, "- %s: chose %q%s over %s\n", p.Axis, p.Chosen.Label, map[bool]string{true: " (" + clip(p.Chosen.Value, 160) + ")", false: ""}[p.Chosen.Value != ""], strings.Join(not, ", "))
		}
		if lookPreference(in.Context.Preferences) != nil && !namesStyle(in.Request) {
			sb.WriteString("The request names no art style, so the look pick fills spec.theme.look and settles any art style slot (guessed false).\n")
		}
	}
	if rl := requirementsLines(in.Requirements); rl != "" {
		sb.WriteString(rl)
	}
	sb.WriteString("\n")
	types, _ := json.Marshal(in.Context.Types)
	fmt.Fprintf(&sb, "Game types found (best first):\n%s\n\n", types)
	type toolLine struct {
		ID      string `json:"id"`
		Kind    string `json:"kind"`
		Status  string `json:"status"`
		Summary string `json:"summary"`
		API     string `json:"api,omitempty"`
	}
	var tl []toolLine
	for _, t := range in.Context.Tools {
		tl = append(tl, toolLine{t.ID, t.Kind, t.Status, clip(t.Summary, 200), clip(t.API, 160)})
	}
	tools, _ := json.Marshal(tl)
	fmt.Fprintf(&sb, "Tools:\n%s\n\n", tools)
	if len(lists) > 0 {
		cl, _ := json.Marshal(lists)
		fmt.Fprintf(&sb, "Clarification checklists:\n%s\n\n", cl)
	} else {
		sb.WriteString("Clarification checklists: none for these families; return clarify as [].\n\n")
	}
	sb.WriteString("Fragment list (what the engine already knows):\n")
	for _, f := range in.Fragments {
		fmt.Fprintf(&sb, "- %s: %s\n", f.ID, clip(firstSentence(f.Summary), 120))
	}
	return sb.String()
}

func firstSentence(s string) string {
	if i := strings.Index(s, ". "); i > 0 {
		return s[:i]
	}
	return s
}

// ValidatePlan decodes Muse's reply and makes it consistent with the input: ids that aren't in the context
// are dropped, gaps get the tools' real status, at most MaxQuestions questions survive, every checklist slot
// is settled (defaults for the ones Muse skipped), and the anatomy's familiarity follows its plans. Every
// correction is noted.
func ValidatePlan(raw json.RawMessage, in PlanInput, lists []checklistFor) (*Plan, error) {
	var r struct {
		Anatomy json.RawMessage `json:"anatomy"`
		Design  Design          `json:"design"`
		TypeIDs []string        `json:"type_ids"`
		Blend   string          `json:"blend"`
		ToolIDs []string        `json:"tool_ids"`
		Gaps    []Gap           `json:"gaps"`
		Clarify []struct {
			Slot     string   `json:"slot"`
			Value    any      `json:"value"`
			Guessed  *bool    `json:"guessed"`
			Question *string  `json:"question"`
			Choices  []string `json:"choices"`
		} `json:"clarify"`
	}
	if err := json.Unmarshal(raw, &r); err != nil {
		return nil, fmt.Errorf("harness: plan reply: %w", err)
	}
	p := &Plan{Design: r.Design, Blend: strings.TrimSpace(r.Blend)}
	note := func(f string, a ...any) { p.Notes = append(p.Notes, fmt.Sprintf(f, a...)) }

	// anatomy
	fragments := map[string]bool{}
	for _, f := range in.Fragments {
		fragments[f.ID] = true
	}
	anat, err := checkAnatomy(r.Anatomy, fragments, note)
	if err != nil {
		return nil, err
	}
	p.Anatomy = anat

	// types
	typeOK := map[string]bool{}
	for _, t := range in.Context.Types {
		typeOK[t.ID] = true
	}
	for _, t := range in.Context.Learned {
		typeOK[t.ID] = true
	}
	for _, id := range uniq(r.TypeIDs) {
		if typeOK[id] {
			p.TypeIDs = append(p.TypeIDs, id)
		} else {
			note("dropped type %q: not in the context", id)
		}
	}
	if len(p.TypeIDs) == 0 {
		p.TypeIDs = []string{in.Context.Types[0].ID}
		note("no valid type_ids; using the top type %s", p.TypeIDs[0])
	}

	// tools
	toolStatus := map[string]string{}
	for _, t := range in.Context.Tools {
		toolStatus[t.ID] = t.Status
	}
	unbuilt := map[string]string{}
	for _, t := range in.Unbuilt {
		unbuilt[t.ID] = t.Status
	}
	p.ToolIDs = []string{}
	for _, id := range uniq(r.ToolIDs) {
		if _, ok := toolStatus[id]; ok {
			p.ToolIDs = append(p.ToolIDs, id)
		} else {
			note("dropped tool %q: not in the context", id)
		}
	}

	// gaps: only unbuilt tools from the context, with their real status; every unbuilt tool used has one
	p.Gaps = []Gap{}
	gapSeen := map[string]bool{}
	for _, g := range r.Gaps {
		st, ok := toolStatus[g.Tool]
		if !ok {
			st, ok = unbuilt[g.Tool]
		}
		switch {
		case !ok:
			note("dropped gap %q: not a tool in the context", g.Tool)
			continue
		case st != "planned" && st != "gap":
			note("dropped gap %q: it is %s", g.Tool, st)
			continue
		case gapSeen[g.Tool]:
			continue
		}
		gapSeen[g.Tool] = true
		g.Status = st
		if !oneOf(g.Familiarity, []string{"known", "approximate", "unfamiliar"}) {
			g.Familiarity = "approximate"
		}
		if strings.TrimSpace(g.Approximation) == "" {
			g.Approximation = "approximated with shipped tools by the composer"
			note("gap %q had no approximation", g.Tool)
		}
		p.Gaps = append(p.Gaps, g)
		if _, inContext := toolStatus[g.Tool]; inContext && !oneOf(g.Tool, p.ToolIDs) {
			p.ToolIDs = append(p.ToolIDs, g.Tool)
		}
	}
	for _, t := range requestNeeds(in.Request, in.Unbuilt) {
		if gapSeen[t.ID] || oneOf(t.ID, p.ToolIDs) {
			continue
		}
		gapSeen[t.ID] = true
		p.Gaps = append(p.Gaps, Gap{Tool: t.ID, Status: t.Status, Approximation: "not built yet: approximate it with shipped tools and say so in the game's text; " + clip(t.Notes, 160), Familiarity: "unfamiliar"})
		note("added gap %q: the request asks for it (%s) and the plan dropped it", t.ID, t.Status)
	}
	for _, id := range p.ToolIDs {
		if st := toolStatus[id]; (st == "planned" || st == "gap") && !gapSeen[id] {
			gapSeen[id] = true
			p.Gaps = append(p.Gaps, Gap{Tool: id, Status: st, Approximation: "approximated with shipped tools by the composer", Familiarity: "unfamiliar"})
			note("added gap %q: the plan uses it but listed no approximation", id)
		}
	}

	// clarify: the slots of the checklists for the chosen types (or all that were sent), each settled once
	slots := planSlots(lists, p.TypeIDs)
	given := map[string]Clarify{}
	for _, c := range r.Clarify {
		if _, ok := slots.byID[c.Slot]; !ok {
			if c.Slot != "" {
				note("dropped clarify slot %q: not in the checklists", c.Slot)
			}
			continue
		}
		if _, dup := given[c.Slot]; dup {
			continue
		}
		cl := Clarify{Slot: c.Slot, Value: strings.TrimSpace(anyString(c.Value)), Guessed: c.Guessed == nil || *c.Guessed, Choices: c.Choices}
		if c.Question != nil {
			cl.Question = strings.TrimSpace(*c.Question)
		}
		given[c.Slot] = cl
	}
	questions := 0
	p.Clarify = []Clarify{}
	for _, s := range slots.order {
		c, ok := given[s.ID]
		if !ok {
			c = Clarify{Slot: s.ID, Value: s.Default, Guessed: true}
		}
		if c.Value == "" {
			c.Value, c.Guessed = s.Default, true
		}
		if c.Question != "" {
			switch {
			case !c.Guessed:
				c.Question, c.Choices = "", nil // the request already said it
			case s.Need != "required":
				note("question on %q dropped: only required slots are asked", s.ID)
				c.Question, c.Choices = "", nil
			case slots.borrowed:
				note("question on %q dropped: the chosen type has no checklist, so borrowed slots are defaults only", s.ID)
				c.Question, c.Choices = "", nil
			case questions >= MaxQuestions:
				note("question on %q dropped: at most %d questions", s.ID, MaxQuestions)
				c.Question, c.Choices = "", nil
			default:
				questions++
				if len(c.Choices) < 2 {
					c.Choices = s.Choices
				}
				c.Choices = c.Choices[:min(len(c.Choices), 4)]
			}
		}
		if c.Question == "" {
			c.Choices = nil
		}
		p.Clarify = append(p.Clarify, c)
	}
	return p, nil
}

type slotSet struct {
	order    []Slot
	byID     map[string]Slot
	borrowed bool // the slots come from a type the plan didn't choose
}

// planSlots are the slots of the checklists that apply to the chosen types; if none of them has one, the
// slots of every checklist sent. A slot id that appears twice keeps its first version.
func planSlots(lists []checklistFor, typeIDs []string) slotSet {
	chosen := set(typeIDs)
	pick := func(onlyChosen bool) slotSet {
		ss := slotSet{byID: map[string]Slot{}}
		for _, l := range lists {
			use := !onlyChosen
			for _, id := range l.For {
				if chosen[id] {
					use = true
				}
			}
			if !use {
				continue
			}
			for _, s := range l.List.Slots {
				if _, dup := ss.byID[s.ID]; !dup {
					ss.byID[s.ID] = s
					ss.order = append(ss.order, s)
				}
			}
		}
		return ss
	}
	if ss := pick(true); len(ss.order) > 0 {
		return ss
	}
	ss := pick(false)
	ss.borrowed = true
	return ss
}

// requestNeeds are the unbuilt tools whose name or an alias appears in the request as whole words.
func requestNeeds(request string, tools []GameTool) []GameTool {
	req := " " + Fold(request) + " " // whole words, no stemming or stopwords: "say it" must not match "saying"
	var out []GameTool
	for _, t := range tools {
		if t.Status != "planned" && t.Status != "gap" {
			continue
		}
		for _, a := range append([]string{t.Name}, t.Aliases...) {
			words := strings.Fields(Fold(a))
			if len(words) == 0 || (len(words) == 1 && len(words[0]) < 3) {
				continue
			}
			phrase := " " + strings.Join(words, " ")
			if strings.Contains(req, phrase+" ") || strings.Contains(req, phrase+"s ") {
				out = append(out, t)
				break
			}
		}
	}
	return out
}

func anyString(v any) string {
	switch x := v.(type) {
	case nil:
		return ""
	case string:
		return x
	default:
		b, _ := json.Marshal(x)
		return string(b)
	}
}

// checkAnatomy accepts a game-anatomy/0.1 object (or one wrapped as {"anatomy": {...}}) and calibrates its
// familiarity the way the app does (GameAnatomy.calibrated): "fragment:<id>" with a real fragment is known,
// an unknown fragment or a builtins-only "custom:" plan is approximate, "engine-gap:" is unfamiliar.
func checkAnatomy(raw json.RawMessage, fragments map[string]bool, note func(string, ...any)) (json.RawMessage, error) {
	var a map[string]any
	if len(raw) == 0 || json.Unmarshal(raw, &a) != nil {
		return nil, fmt.Errorf("harness: the plan has no %s anatomy", AnatomyVersion)
	}
	if inner, ok := a["anatomy"].(map[string]any); ok {
		a = inner
	}
	if a["anatomy"] != AnatomyVersion {
		return nil, fmt.Errorf("harness: the plan's anatomy is not %s", AnatomyVersion)
	}
	parts, ok := a["parts"].(map[string]any)
	if !ok {
		return nil, fmt.Errorf("harness: the plan's anatomy has no parts")
	}
	keys := make([]string, 0, len(parts))
	for k := range parts {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		switch v := parts[k].(type) {
		case map[string]any:
			calibrate(k, v, fragments, note)
		case []any:
			for i, x := range v {
				if m, ok := x.(map[string]any); ok {
					calibrate(fmt.Sprintf("%s.%d", k, i+1), m, fragments, note)
				}
			}
		}
	}
	b, err := json.Marshal(a)
	return b, err
}

func calibrate(where string, m map[string]any, fragments map[string]bool, note func(string, ...any)) {
	plan, _ := m["plan"].(string)
	fam, _ := m["familiarity"].(string)
	want := fam
	switch {
	case strings.HasPrefix(plan, "fragment:"):
		id := strings.TrimSpace(strings.TrimPrefix(plan, "fragment:"))
		if fragments[id] {
			want = "known"
		} else {
			want = "approximate"
			note("anatomy %s: fragment %q isn't in the engine, so it is approximate", where, id)
		}
	case strings.HasPrefix(plan, "engine-gap:"):
		want = "unfamiliar"
	case strings.HasPrefix(plan, "custom:"):
		if fam == "known" || fam == "unfamiliar" || fam == "" {
			want = "approximate"
		}
	default:
		if fam == "known" {
			want = "approximate"
		}
	}
	if !oneOf(want, []string{"known", "approximate", "unfamiliar"}) {
		want = "approximate"
	}
	m["familiarity"] = want
}

// AttachPlan puts a plan into a context, trimming tools from the end if the whole thing would pass
// ContextMaxBytes.
func AttachPlan(c *GenContext, p *Plan) error {
	b, err := json.Marshal(p)
	if err != nil {
		return err
	}
	c.Plan = b
	keep := set(p.ToolIDs)
	for size(*c) > ContextMaxBytes {
		i := len(c.Tools) - 1
		for ; i >= 0 && keep[c.Tools[i].ID]; i-- {
		}
		if i < 0 {
			return fmt.Errorf("harness: context with the plan is %d bytes (limit %d)", size(*c), ContextMaxBytes)
		}
		c.Tools = append(c.Tools[:i], c.Tools[i+1:]...)
	}
	for _, t := range c.Types {
		if oneOf(t.ID, p.TypeIDs) {
			c.GateProfile = t.GateProfile
			break
		}
	}
	return nil
}
