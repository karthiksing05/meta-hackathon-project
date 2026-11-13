package harness

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

// baseSpec is a valid spec that each case changes one thing in.
func baseSpec() Spec {
	return Spec{
		Theme:       Theme{World: "a race track", Tone: "fast"},
		Goal:        Goal{Text: "Finish 3 laps.", Target: "finish 3 laps", Measure: "lap time"},
		Loop:        Loop{Verb: "steer", Input: "drag", Feedback: "skid marks", CycleSeconds: 2},
		Pieces:      Pieces{Items: []Piece{{Name: "car", Role: "you"}}},
		Progression: Progression{Steps: []Step{{}, {}, {}}},
		End:         End{Win: "3 laps", EndsWhen: []string{"target_reached"}, SessionSeconds: []int{40, 120}},
		Score:       Score{Kind: "time_to_complete", Measures: "lap time for 3 laps", Events: []string{"lap"}},
		Social:      Social{ShareLine: "{name} ran {result}. Your turn.", Result: PlayResult{Kind: "score", Compare: "score"}},
		Feel:        Feel{Juice: []string{"sparks"}},
	}
}

func TestDefaultSocial(t *testing.T) {
	cases := []struct {
		t                  ContextType
		req, mode, compare string
		bestOf             int
	}{
		{ContextType{Family: "racing"}, "an F1 game", "series", "score", 3},
		{ContextType{Family: "story_choice"}, "a peasant becomes king", "same_seed_async", "ending", 0},
		{ContextType{Family: "party_social", Name: "Rank by consensus", Summary: "sort items into tiers; compare with the group consensus"}, "rank the brainrot", "opinion_compare", "agreement", 0},
		{ContextType{Family: "number_math"}, "A rating game where you rate which car brands are better", "opinion_compare", "agreement", 0},
		{ContextType{Family: "number_math"}, "make 24 from four numbers", "group_round", "score", 0},
		{ContextType{Family: "calm_cozy"}, "a garden", "same_seed_async", "score", 0},
	}
	for _, c := range cases {
		s := DefaultSocial(c.t, c.req)
		if s.Mode != c.mode || s.Result.Compare != c.compare || s.BestOf != c.bestOf || !s.SameSeed {
			t.Errorf("%q (%s): %+v", c.req, c.t.Family, s)
		}
	}
}

func TestValidateSocial(t *testing.T) {
	s := baseSpec()
	if p, _ := s.Validate(); len(p) != 0 {
		t.Fatalf("base spec: %v", p)
	}
	if !s.Social.SameSeed || s.Social.Mode != "same_seed_async" || len(s.Social.Modes) != 4 || s.Social.RoundSeconds != 90 || s.Social.Result.Display != "{score}" {
		t.Errorf("defaults: %+v", s.Social)
	}

	// agreement: the score is unranked and the mode is opinion_compare
	s = baseSpec()
	s.Social.Result = PlayResult{Kind: "score", Compare: "agreement"}
	s.Social.Mode = "series"
	p, fixed := s.Validate()
	if len(p) != 0 || s.Score.Ranked == nil || *s.Score.Ranked || s.Social.Mode != "opinion_compare" || s.Social.Result.Kind != "picks" || s.Social.BestOf != 0 {
		t.Errorf("agreement: problems %v, fixed %v, social %+v, ranked %v", p, fixed, s.Social, s.Score.Ranked)
	}

	// ending: needs the endings, and the share line must not name one
	s = baseSpec()
	s.Social.Result = PlayResult{Compare: "ending"}
	p, _ = s.Validate()
	if len(p) != 1 || !strings.Contains(p[0], "endings") {
		t.Errorf("ending without endings: %v", p)
	}
	s.Social.Result.Endings = []string{"Crowned", "Exiled"}
	s.Social.ShareLine = "{name} got Crowned: {result}"
	p, _ = s.Validate()
	if len(p) != 1 || !strings.Contains(p[0], "spoils") {
		t.Errorf("a share line naming an ending: %v", p)
	}

	// an old plan's share text, with no result placeholder, becomes the default line; series gets best of 3
	s = baseSpec()
	s.Social = Social{Share: "I did it", Mode: "series", BestOf: 7}
	p, _ = s.Validate()
	if len(p) != 0 || s.Social.ShareLine != DefaultShareLine || s.Social.BestOf != 3 || s.Social.Result.Compare != "score" {
		t.Errorf("legacy share: %v %+v", p, s.Social)
	}

	// a round inside the run, and a run too long for a chat
	s = baseSpec()
	s.Social.RoundSeconds = 300
	s.Validate()
	if s.Social.RoundSeconds != 120 {
		t.Errorf("round_seconds should be capped at the run's longest: %d", s.Social.RoundSeconds)
	}
	s.End.SessionSeconds = []int{200, 400}
	p, _ = s.Validate()
	if len(p) != 1 || !strings.HasPrefix(p[0], "end:") {
		t.Errorf("a 200 s minimum isn't a chat round: %v", p)
	}

	// an unranked score shows side by side; an opinion mode without agreement goes back to async
	s = baseSpec()
	f := false
	s.Score.Ranked = &f
	s.Social.Mode = "opinion_compare"
	s.Validate()
	if s.Social.Result.Compare != "none" || s.Social.Mode != "same_seed_async" {
		t.Errorf("unranked: %+v", s.Social)
	}
}

func TestRequestChecks(t *testing.T) {
	in := PlanInput{Request: "Max Verstappen F1 game", Context: GenContext{Types: []ContextType{{ID: "top_down_racer", Name: "Top-down racer", Summary: "race laps"}}}}
	s := baseSpec()
	s.Goal.Target = "clear every tile"
	p := requestChecks(&s, in)
	if len(p) != 1 || !strings.Contains(p[0], "copies a schema example") {
		t.Errorf("leak: %v", p)
	}
	// a Krillion request may say "rarest"
	in2 := PlanInput{Request: "krillion", Context: GenContext{Types: []ContextType{{Summary: "rarer answers score more"}}}}
	s = baseSpec()
	s.Goal.Target = "find the rarest answer"
	if p := requestChecks(&s, in2); len(p) != 0 {
		t.Errorf("rarest is the game here: %v", p)
	}

	// #17: become king in 10 choices or less, scored per choice
	in3 := PlanInput{Request: "Choose your own adventure where I'm a medieval peasant trying to become king in 10 choices or less"}
	s = baseSpec()
	s.Goal = Goal{Text: "Become king.", Target: "become king in 10 choices or less", Measure: "choices"}
	s.Score = Score{Kind: "points", Direction: "higher", Measures: "10 points per choice made", Events: []string{"choice"}}
	p = requestChecks(&s, in3)
	if len(p) != 1 || !strings.Contains(p[0], "caps choice") {
		t.Errorf("a score that rewards more choices: %v", p)
	}
	s.Score.Measures = "ending reached plus 10 points per choice left"
	if p := requestChecks(&s, in3); len(p) != 0 {
		t.Errorf("choices left is fine: %v", p)
	}
	// a time cap is not a count cap
	s.Goal.Target = "survive within 60 seconds"
	s.Score.Measures = "seconds alive"
	if p := requestChecks(&s, PlanInput{Request: "dodge"}); len(p) != 0 {
		t.Errorf("time caps: %v", p)
	}

	// #6: an opinion request scored as a quiz
	s = baseSpec()
	p = requestChecks(&s, PlanInput{Request: "A rating game where you rate which car brands are better"})
	if len(p) != 1 || !strings.HasPrefix(p[0], "social:") {
		t.Errorf("opinion: %v", p)
	}
	s.Social.Reason = "it's a quiz with a right answer"
	if p := requestChecks(&s, PlanInput{Request: "rate my knowledge of cars"}); len(p) != 0 {
		t.Errorf("a reason keeps the score: %v", p)
	}
}

func TestRequestNeeds(t *testing.T) {
	tools := []GameTool{
		{ID: "map_pin", Status: "planned", Aliases: []string{"map", "world map"}},
		{ID: "audio_clip", Status: "planned", Name: "Audio clip", Aliases: []string{"hear", "listen"}},
		{ID: "lanes", Status: "shipped", Aliases: []string{"map"}},
		{ID: "x", Status: "gap", Aliases: []string{"a"}},
	}
	got := requestNeeds(`"Finish the Saying" trivia, with the country shown on a map once I answer`, tools)
	if len(got) != 1 || got[0].ID != "map_pin" {
		t.Errorf("map: %+v", got)
	}
	if got := requestNeeds("Guess the decade where I hear a short synth melody", tools); len(got) != 1 || got[0].ID != "audio_clip" {
		t.Errorf("hear: %+v", got)
	}
	// stopwords count: the alias "say it" is not the word "saying" (Kevin32 #11)
	if got := requestNeeds(`"Finish the Saying" trivia game featuring sayings`, []GameTool{{ID: "speech_input", Status: "gap", Aliases: []string{"say it"}}}); len(got) != 0 {
		t.Errorf("say it: %+v", got)
	}
	if got := requestNeeds("roadmap of a city", tools); len(got) != 0 {
		t.Errorf("whole words only: %+v", got)
	}
}

func TestPlanFlagsRequestGapsAndBorrowedSlots(t *testing.T) {
	in := planInput(t)
	in.Request = "a harry potter krillion shown on a map"
	in.Unbuilt = []GameTool{{ID: "map_pin", Status: "planned", Aliases: []string{"map"}, Notes: "pins on a drawn map"}}
	p, err := ValidatePlan(json.RawMessage(planReply), in, nil)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, g := range p.Gaps {
		if g.Tool == "map_pin" && g.Status == "planned" && g.Approximation != "" {
			found = true
		}
	}
	if !found {
		t.Errorf("the map should be a gap: %+v", p.Gaps)
	}
	for _, id := range p.ToolIDs {
		if id == "map_pin" {
			t.Error("a gap tool outside the context should not become a tool id")
		}
	}

	// the checklists sent belong to a type the plan didn't choose: settle the slots, ask nothing
	lists := []checklistFor{{Family: "daily_puzzle", For: []string{"some_daily"}, List: testChecklists()["trivia"].Checklists[0], Slots: testChecklists()["trivia"].Checklists[0].Slots}}
	p, err = ValidatePlan(json.RawMessage(planReply), in, lists)
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range p.Clarify {
		if c.Question != "" {
			t.Errorf("borrowed slot %s asked %q", c.Slot, c.Question)
		}
	}
	if len(p.Clarify) != 4 {
		t.Errorf("borrowed slots still settle: %+v", p.Clarify)
	}
}

func TestContextSaysWhoUnderstood(t *testing.T) {
	h := newTestHarness(t, Config{})
	pack, err := h.Context(context.Background(), Request{Text: "a harry potter krillion"})
	if err != nil {
		t.Fatal(err)
	}
	if pack.Timings.UnderstoodBy != "keywords" {
		t.Errorf("timings: %+v", pack.Timings)
	}
	gc, _ := BuildContext(pack)
	if gc.Understanding.By != "keywords" || !oneOf("understood by keywords", gc.Notes) {
		t.Errorf("context: %+v %v", gc.Understanding, gc.Notes)
	}
}
