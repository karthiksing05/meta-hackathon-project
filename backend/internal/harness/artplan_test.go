package harness

import (
	"path/filepath"
	"testing"
)

func TestArtHeavy(t *testing.T) {
	pieces := func(names ...string) *Spec {
		s := baseSpec()
		s.Pieces.Items = nil
		for _, n := range names {
			s.Pieces.Items = append(s.Pieces.Items, Piece{Name: n, Role: "x", Count: "1"})
		}
		return &s
	}
	cases := []struct {
		name string
		plan Plan
		want bool
	}{
		{"#19 shooter", Plan{Spec: pieces("Bombardiro Crocodilo plane", "flying pineapple", "player bolt", "juice shot", "bomb")}, true},
		{"#1 story", Plan{ToolIDs: []string{"choice_story", "score"}, Spec: pieces("Scene tree", "Choice buttons")}, true},
		{"#13 slicer", Plan{Spec: pieces("spam email", "boss email", "blade trail", "life icons")}, false},
		{"#20 quiz", Plan{Spec: pieces("synth melody bank", "decade choices", "style hint", "replay button")}, false},
	}
	for _, c := range cases {
		if got := artHeavy(&c.plan); got != c.want {
			t.Errorf("%s: art heavy %v, want %v", c.name, got, c.want)
		}
	}
}

func TestFinishArt(t *testing.T) {
	story := func() *Plan {
		s := baseSpec()
		return &Plan{ToolIDs: []string{"choice_story"}, Spec: &s, Clarify: []Clarify{{Slot: ArtStyleSlot, Value: "bold cartoon", Guessed: true, Question: "What should it look like?", Choices: []string{"comic", "pixel art", "anime"}}}}
	}
	// no style named: the question stays, the guess is the art style
	p := story()
	finishArt(p, PlanInput{Request: "Choose your own adventure as a peasant"})
	if p.Art != ArtImage || p.Clarify[0].Question == "" || p.Spec.Theme.ArtStyle != "bold cartoon" {
		t.Errorf("unnamed: art %q, %+v, style %q", p.Art, p.Clarify[0], p.Spec.Theme.ArtStyle)
	}
	// the request names one: no question, the person's words
	p = story()
	finishArt(p, PlanInput{Request: "Leia escapes the Death Star, drawn in 80s anime style"})
	if p.Clarify[0].Question != "" || p.Clarify[0].Guessed || p.Spec.Theme.ArtStyle == "" {
		t.Errorf("named: %+v, style %q", p.Clarify[0], p.Spec.Theme.ArtStyle)
	}
	// a look pick settles it
	p = story()
	finishArt(p, PlanInput{Request: "a peasant story", Context: GenContext{Preferences: []Preference{{Axis: "look", Chosen: PreferenceSide{Label: "Storybook", Value: "illuminated storybook"}}}}})
	if p.Clarify[0].Question != "" || p.Spec.Theme.ArtStyle != "illuminated storybook" {
		t.Errorf("picked: %+v, style %q", p.Clarify[0], p.Spec.Theme.ArtStyle)
	}
	// not art-heavy: no art "image", no question
	s := baseSpec()
	q := &Plan{Spec: &s, Clarify: []Clarify{{Slot: ArtStyleSlot, Value: "flat", Guessed: true, Question: "Look?"}}}
	finishArt(q, PlanInput{Request: "a quiz"})
	if q.Art != "" || q.Clarify[0].Question != "" {
		t.Errorf("light: art %q, %+v", q.Art, q.Clarify[0])
	}
}

func TestSharedArtStyleSlot(t *testing.T) {
	cl, skipped, err := LoadChecklists(filepath.Join("..", "..", "..", "authoring", "catalog"))
	if err != nil {
		t.Fatal(err)
	}
	for _, s := range skipped {
		t.Logf("skipped %s", s)
	}
	if cl.sharedSlot(ArtStyleSlot, "arcade_shooter") == nil {
		t.Fatal("the shared art_style slot isn't loaded for arcade_shooter")
	}
	if cl.sharedSlot(ArtStyleSlot, "knowledge_quiz") != nil {
		t.Error("art_style doesn't apply to quizzes")
	}
	lists := cl.withArtStyle(nil, []ContextType{{ID: "x", Family: "arcade_shooter"}})
	if len(lists) != 1 || lists[0].Slots[len(lists[0].Slots)-1].ID != ArtStyleSlot {
		t.Errorf("withArtStyle: %+v", lists)
	}
}

func TestFillThemeType(t *testing.T) {
	s := baseSpec()
	s.Theme.ArtStyle = "pixel art"
	fillThemeType(&s, ContextUnder{Theme: []string{"space"}, Families: []string{"arcade_action"}})
	if s.Theme.Type == nil || s.Theme.Type.Theme[0] != "space" || s.Theme.Type.Genre[0] != "arcade_action" || s.Theme.Type.Style[0] != "pixel art" {
		t.Fatalf("theme.type not filled: %+v", s.Theme.Type)
	}
	// The spec's own words win; only the empty parts are filled.
	s2 := baseSpec()
	s2.Theme.Type = &ThemeType{Era: "1985", Theme: []string{"game show"}}
	fillThemeType(&s2, ContextUnder{Theme: []string{"tv"}, Families: []string{"trivia"}})
	if s2.Theme.Type.Era != "1985" || s2.Theme.Type.Theme[0] != "game show" || s2.Theme.Type.Genre[0] != "trivia" {
		t.Fatalf("spec words not kept: %+v", s2.Theme.Type)
	}
	// Nothing to say: no type.
	s3 := baseSpec()
	s3.Theme.ArtStyle = ""
	fillThemeType(&s3, ContextUnder{})
	if s3.Theme.Type != nil {
		t.Fatalf("empty type set: %+v", s3.Theme.Type)
	}
	fillThemeType(nil, ContextUnder{Theme: []string{"x"}})
}
