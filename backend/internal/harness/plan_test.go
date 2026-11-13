package harness

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func testChecklists() Checklists {
	return Checklists{"trivia": {Family: "trivia", Checklists: []Checklist{
		{AppliesTo: []string{"*"}, Slots: []Slot{
			{ID: "theme", Ask: "What should the questions be about?", Need: "required", Default: "general knowledge", Choices: []string{"general knowledge", "a show"}},
			{ID: "audience", Ask: "Who plays?", Need: "required", Default: "friends", Choices: []string{"friends", "anyone"}},
			{ID: "rounds", Ask: "How many prompts?", Need: "required", Default: "5", Choices: []string{"5", "10"}},
			{ID: "timer", Ask: "Timed?", Need: "nice", Default: "10 s", Choices: []string{"10 s", "none"}},
		}},
	}}}
}

const planReply = `{
 "anatomy": {"anatomy": {"anatomy": "game-anatomy/0.1", "title": "Rarest Spell", "genre": "word",
   "parts": {"core_loop": {"text": "type the rarest answer", "source": "you", "familiarity": "known", "plan": "fragment:typed_answer"},
     "verbs": {"items": ["type"], "source": "you", "familiarity": "known", "plan": "fragment:not_a_fragment"},
     "share": {"grid": "a grid", "source": "guess", "familiarity": "known", "plan": "engine-gap:share_grid"},
     "rules": [{"n": 1, "text": "rarer scores more", "check": "a rare answer scores 100", "source": "you", "familiarity": "unfamiliar", "plan": "custom:sort_by - rank by rarity"}]}}},
 "spec": {"spec": "game-spec/1",
   "theme": {"world": "a wizard school", "named": ["Harry Potter"], "tone": "cozy", "look": "candlelit", "terms": ["Hogwarts"]},
   "goal": {"text": "Name the rarest correct answers.", "target": "find the rarest answer in each of 5 prompts", "measure": "rarity points"},
   "loop": {"verb": "type", "sees": "a category", "input": "type", "feedback": "the answer's rarity tier", "cycle_seconds": 12},
   "pieces": {"items": [{"name": "prompt", "role": "category", "count": 5, "content": "answer bank with tiers"}]},
   "constraints": {"items": [{"kind": "time", "value": 10, "enforced_by": "the timer ends each prompt", "hud": "timer bar"}]},
   "progression": {"steps": [{"at": "prompt 1", "change": "broad"}, {"at": "prompt 3", "change": "narrower"}, {"at": "prompt 5", "change": "obscure"}], "levers": ["timer"]},
   "end": {"win": "best total", "lose": "", "ends_when": ["all_prompts_done"], "session_seconds": [60, 120]},
   "score": {"kind": "points", "measures": "rarity points per answer", "unit": "points", "direction": "lower", "counts_when": "any", "aggregate": "best", "tie_break": "fewer mistakes", "format": "{n} points", "events": ["answer_scored"], "bounds": {"min": 0, "max": 9}},
   "social": {"share": "I scored 340 rarity points", "challenge": "same prompts", "same_seed": true, "board": "highest first"},
   "feel": {"juice": ["a gold burst on a rare answer"], "sounds": "chimes", "look": "candlelit gold"}},
 "design": {"pitch": "Name the rarest spell.", "theme": "Harry Potter", "verb": "type", "twist": "rarity", "arc": ["warm up", "hard"]},
 "type_ids": ["rare_answer_trivia", "invented_type"],
 "blend": "rare-answer scoring",
 "tool_ids": ["typed_answer", "fuzzy_match", "made_up_tool", "lanes"],
 "gaps": [{"tool": "timer_bar", "approximation": "x", "familiarity": "known"}, {"tool": "nope", "approximation": "y"}],
 "clarify": [
  {"slot": "theme", "value": "Harry Potter", "guessed": false, "question": "What about?", "choices": ["a", "b"]},
  {"slot": "audience", "value": "friends", "guessed": true, "question": "Who plays?", "choices": ["friends", "anyone"]},
  {"slot": "rounds", "value": "5", "guessed": true, "question": "How many?"},
  {"slot": "timer", "value": "10 s", "guessed": true, "question": "Timed?"},
  {"slot": "unknown_slot", "value": "?"}
 ]}`

func planInput(t *testing.T) PlanInput {
	h := newTestHarness(t, Config{})
	pack, err := h.Context(context.Background(), Request{Text: "a harry potter krillion"})
	if err != nil {
		t.Fatal(err)
	}
	gc, err := BuildContext(pack)
	if err != nil {
		t.Fatal(err)
	}
	return PlanInput{Request: "a harry potter krillion", Pack: pack, Context: gc,
		Fragments: []GameTool{{ID: "typed_answer", Kind: "fragment"}, {ID: "timer_bar", Kind: "fragment"}}}
}

func TestPlanValidation(t *testing.T) {
	in := planInput(t)
	var gotUser string
	muse := &fakeMuse{reply: func(system, user string) string {
		if gotUser == "" {
			gotUser = user
		}
		if !strings.Contains(system, "AT MOST 2 questions") {
			t.Error("system prompt lacks the question limit")
		}
		return planReply
	}}
	pl := &Planner{Muse: muse, Checklists: testChecklists()}
	p, err := pl.Plan(context.Background(), in)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(gotUser, `"rare_answer_trivia"`) || !strings.Contains(gotUser, "Clarification checklists:\n[") || !strings.Contains(gotUser, "- typed_answer") {
		t.Errorf("prompt is missing cards, checklists or fragments:\n%s", gotUser)
	}
	if strings.Join(p.TypeIDs, ",") != "rare_answer_trivia" {
		t.Errorf("type_ids = %v", p.TypeIDs)
	}
	for _, id := range p.ToolIDs {
		if id == "made_up_tool" {
			t.Error("unknown tool kept")
		}
	}
	if len(p.Gaps) != 0 {
		t.Errorf("gaps on shipped or unknown tools should be dropped: %+v", p.Gaps)
	}
	// clarify: every slot, in checklist order; theme came from the request (no question); at most 2 questions
	var slots []string
	questions := 0
	for _, c := range p.Clarify {
		slots = append(slots, c.Slot)
		if c.Question != "" {
			questions++
			if len(c.Choices) < 2 {
				t.Errorf("question on %s without choices", c.Slot)
			}
		}
	}
	if strings.Join(slots, ",") != "theme,audience,rounds,timer" {
		t.Errorf("slots = %v", slots)
	}
	if questions != 2 || p.Clarify[0].Question != "" || p.Clarify[0].Guessed || p.Clarify[0].Value != "Harry Potter" {
		t.Errorf("questions: %+v", p.Clarify)
	}
	// the theme's question was dropped (the request said it), so audience and rounds are the two asked
	if p.Clarify[1].Question == "" || p.Clarify[2].Question == "" || len(p.Clarify[2].Choices) != 2 {
		t.Errorf("audience and rounds should be asked, rounds with the slot's choices: %+v", p.Clarify[1:3])
	}
	if p.Clarify[3].Question != "" {
		t.Error("a nice slot must not be asked")
	}
	// anatomy unwrapped and calibrated
	var a struct {
		Anatomy string `json:"anatomy"`
		Parts   map[string]json.RawMessage
	}
	if err := json.Unmarshal(p.Anatomy, &a); err != nil || a.Anatomy != AnatomyVersion {
		t.Fatalf("anatomy = %s", p.Anatomy)
	}
	fam := func(part string) string {
		var m map[string]any
		_ = json.Unmarshal(a.Parts[part], &m)
		s, _ := m["familiarity"].(string)
		return s
	}
	if fam("core_loop") != "known" || fam("verbs") != "approximate" || fam("share") != "unfamiliar" {
		t.Errorf("calibration: core_loop %s verbs %s share %s", fam("core_loop"), fam("verbs"), fam("share"))
	}
	if !strings.Contains(string(a.Parts["rules"]), `"familiarity":"approximate"`) {
		t.Errorf("custom rule should be approximate: %s", a.Parts["rules"])
	}
	if len(p.Design.Theme) != 1 || p.Design.Theme[0] != "Harry Potter" {
		t.Errorf("design theme = %v", p.Design.Theme)
	}
	notes := strings.Join(p.Notes, "|")
	for _, want := range []string{"invented_type", "made_up_tool", "unknown_slot", "not_a_fragment"} {
		if !strings.Contains(notes, want) {
			t.Errorf("no note about %s: %s", want, notes)
		}
	}
}

func TestPlanGapsAndDefaults(t *testing.T) {
	in := planInput(t)
	// make fuzzy_match a planned tool in the context
	for i := range in.Context.Tools {
		if in.Context.Tools[i].ID == "fuzzy_match" {
			in.Context.Tools[i].Status = "planned"
		}
	}
	reply := `{"anatomy": {"anatomy": "game-anatomy/0.1", "parts": {}}, "type_ids": [], "tool_ids": ["fuzzy_match"], "clarify": []}`
	pl := &Planner{Muse: &fakeMuse{reply: func(string, string) string { return reply }}, Checklists: testChecklists()}
	p, err := pl.Plan(context.Background(), in)
	if err != nil {
		t.Fatal(err)
	}
	if len(p.TypeIDs) != 1 || p.TypeIDs[0] != in.Context.Types[0].ID {
		t.Errorf("type_ids fallback = %v", p.TypeIDs)
	}
	if len(p.Gaps) != 1 || p.Gaps[0].Tool != "fuzzy_match" || p.Gaps[0].Status != "planned" {
		t.Errorf("gaps = %+v", p.Gaps)
	}
	if len(p.Clarify) != 4 || !p.Clarify[0].Guessed || p.Clarify[0].Value != "general knowledge" {
		t.Errorf("defaults = %+v", p.Clarify)
	}
	// no anatomy is no plan
	pl.Muse = &fakeMuse{reply: func(string, string) string { return `{"type_ids": []}` }}
	if _, err := pl.Plan(context.Background(), in); err == nil {
		t.Error("a plan without an anatomy should fail")
	}
}

func TestBuildAttachesPlan(t *testing.T) {
	h := newTestHarness(t, Config{})
	pl := &Planner{Muse: &fakeMuse{reply: func(string, string) string { return planReply }}, Checklists: testChecklists()}
	b, err := h.Build(context.Background(), Request{Text: "a harry potter krillion"}, pl)
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]any
	raw, _ := json.Marshal(b.Context)
	_ = json.Unmarshal(raw, &m)
	plan, ok := m["plan"].(map[string]any)
	if !ok || plan["anatomy"] == nil || plan["type_ids"] == nil || plan["clarify"] == nil {
		t.Fatalf("context plan = %v", m["plan"])
	}
	if b.Context.GateProfile != "trivia" || len(raw) > ContextMaxBytes {
		t.Errorf("gate %q size %d", b.Context.GateProfile, len(raw))
	}
}

func TestLoadChecklists(t *testing.T) {
	dir := t.TempDir()
	os.MkdirAll(filepath.Join(dir, "checklists"), 0o755)
	good, _ := json.Marshal(testChecklists()["trivia"])
	os.WriteFile(filepath.Join(dir, "checklists", "trivia.json"), good, 0o644)
	os.WriteFile(filepath.Join(dir, "checklists", "bad.json"), []byte(`{"family": "nope", "checklists": []}`), 0o644)
	cl, skipped, err := LoadChecklists(dir)
	if err != nil || len(cl) != 1 || len(skipped) != 1 {
		t.Fatalf("loaded %d, skipped %v, err %v", len(cl), skipped, err)
	}
	if c := cl.For(GameType{ID: "x", Family: "trivia"}); c == nil || len(c.Slots) != 4 {
		t.Error("family default not found")
	}
	if cl.For(GameType{ID: "x", Family: "word"}) != nil {
		t.Error("a family without checklists has none")
	}
	if none, _, err := LoadChecklists(t.TempDir()); err != nil || len(none) != 0 {
		t.Error("a missing folder is no checklists")
	}
	// the repository's checklists, if any, load cleanly
	if dir, ok := FindCatalogDir(); ok {
		cl, skipped, err := LoadChecklists(dir)
		if err != nil || len(skipped) > 0 {
			t.Errorf("repository checklists: %d loaded, skipped %v, err %v", len(cl), skipped, err)
		}
	}
}

func TestPlanSpec(t *testing.T) {
	in := planInput(t)
	muse := &fakeMuse{reply: func(string, string) string { return planReply }}
	p, err := (&Planner{Muse: muse, Checklists: testChecklists()}).Plan(context.Background(), in)
	if err != nil {
		t.Fatal(err)
	}
	sc := p.Spec.Score
	// the type is rare-answer trivia: its default kind is tiered_points, and "points" came with no reason
	if sc.Kind != "tiered_points" || sc.Direction != "higher" || sc.Bounds != nil || sc.TieBreak != "less time" {
		t.Errorf("score = %+v", sc)
	}
	if len(p.Issues) != 0 {
		t.Errorf("a valid spec has issues: %v", p.Issues)
	}
	if muse.calls != 1 {
		t.Errorf("a valid spec needs no repair, made %d calls", muse.calls)
	}
	if p.Spec.Pieces.Items[0].Count != "5" || p.Spec.Constraints.Items[0].Value != "10" {
		t.Errorf("numbers as text: %+v %+v", p.Spec.Pieces.Items[0], p.Spec.Constraints.Items[0])
	}
}

func TestPlanSpecChainAndRepair(t *testing.T) {
	in := planInput(t)
	var full map[string]json.RawMessage
	var r struct {
		Spec map[string]json.RawMessage `json:"spec"`
	}
	_ = json.Unmarshal([]byte(planReply), &r)
	full = r.Spec
	stage := func(keys ...string) string {
		m := map[string]json.RawMessage{}
		for _, k := range keys {
			m[k] = full[k]
		}
		b, _ := json.Marshal(m)
		return string(b)
	}
	calls := 0
	muse := &fakeMuse{reply: func(system, user string) string {
		calls++
		switch {
		case strings.Contains(system, "continuing a game spec") && strings.Contains(user, "Fill: constraints"):
			if !strings.Contains(user, `"goal"`) {
				t.Error("stage 2 doesn't see the earlier parts")
			}
			return stage("constraints", "progression", "end")
		case strings.Contains(system, "continuing a game spec"):
			// a score that doesn't measure the goal, to force the repair
			return `{"score": {"kind": "tiered_points", "measures": "taps", "events": ["tap"]}, "social": ` + string(full["social"]) + `, "feel": ` + string(full["feel"]) + `}`
		case strings.Contains(system, "failed their checks"):
			if !strings.Contains(user, "Rewrite: score") {
				t.Errorf("repair should ask for the score only: %s", user)
			}
			return stage("score")
		}
		// the plan call: only the first stage of the spec
		var whole map[string]json.RawMessage
		_ = json.Unmarshal([]byte(planReply), &whole)
		whole["spec"] = json.RawMessage(stage("theme", "goal", "loop", "pieces"))
		b, _ := json.Marshal(whole)
		return string(b)
	}}
	p, err := (&Planner{Muse: muse, Checklists: testChecklists(), Chain: true}).Plan(context.Background(), in)
	if err != nil {
		t.Fatal(err)
	}
	if calls != 4 || len(p.Calls) != 4 {
		t.Errorf("chain + repair should be 4 calls, got %d (%v)", calls, p.Calls)
	}
	if len(p.Issues) != 0 || p.Spec.Score.Measures != "rarity points per answer" {
		t.Errorf("after repair: issues %v, score %+v", p.Issues, p.Spec.Score)
	}
}

func TestSpecValidate(t *testing.T) {
	s := Spec{
		Theme:       Theme{World: "kitchen", Tone: "frantic"},
		Goal:        Goal{Text: "make sandwiches", Target: "make 20 sandwiches as fast as you can", Measure: "sandwiches made"},
		Loop:        Loop{Verb: "tap", Input: "tap", Feedback: "ding", CycleSeconds: 3},
		Pieces:      Pieces{Items: []Piece{{Name: "order", Role: "what to make"}}},
		Progression: Progression{Steps: []Step{{}, {}, {}}},
		End:         End{Win: "20 made", EndsWhen: []string{"time_out"}, SessionSeconds: []int{30, 90}},
		Score:       Score{Kind: "time_to_complete", Measures: "seconds to make 20 sandwiches", Direction: "higher", CountsWhen: "any", Events: []string{"done"}},
		Social:      Social{Share: "20 in 1:02"}, Feel: Feel{Juice: []string{"pop"}},
	}
	problems, fixed := s.Validate()
	if s.Score.Direction != "lower" || s.Score.CountsWhen != "finished" || s.Score.Unit != "ms" || s.Score.Format != "m:ss.t" || len(fixed) < 4 {
		t.Errorf("direction and counts_when should follow the kind: %+v, fixed %v", s.Score, fixed)
	}
	if len(problems) != 1 || !strings.Contains(problems[0], "can finish") {
		t.Errorf("a time trial that can only time out should be flagged: %v", problems)
	}
	s.End.EndsWhen = []string{"target_reached", "time_out"}
	s.Goal.Target = "do well"
	problems, _ = s.Validate()
	if len(problems) != 1 || !strings.HasPrefix(problems[0], "goal:") {
		t.Errorf("an unmeasurable goal should be flagged: %v", problems)
	}
	s.Goal.Target = "make 20 sandwiches"
	s.Score.Measures = "taps"
	problems, _ = s.Validate()
	if len(problems) != 1 || !strings.HasPrefix(problems[0], "score:") {
		t.Errorf("a score that doesn't measure the goal should be flagged: %v", problems)
	}
}

func TestDefaultScoreKind(t *testing.T) {
	cases := []struct {
		t    GameType
		want string
	}{
		{GameType{Family: "trivia", Name: "Rare-answer trivia", Scoring: "tiered points per answer"}, "tiered_points"},
		{GameType{Family: "cooking_crafting", Scoring: "fastest time to clear all orders"}, "time_to_complete"},
		{GameType{Family: "runner", Scoring: "coins"}, "distance"},
		{GameType{Family: "dodge_survive"}, "survival_time"},
		{GameType{Family: "word", Scoring: "longest streak of correct words"}, "streak"},
		{GameType{Family: "nope"}, "points"},
	}
	for _, c := range cases {
		if got := DefaultScoreKind(c.t); got != c.want {
			t.Errorf("%+v → %s, want %s", c.t, got, c.want)
		}
	}
}
