package api

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/karthiksing05/meta-hackathon-project/backend/internal/harness"
)

func TestGroupPlayFrom(t *testing.T) {
	var in manifestGroupPlay
	raw := `{"mode":"SERIES","modes":["series","bogus","group_round"],"round_seconds":44.6,"best_of":5,
	  "result":{"kind":"ending","compare":"ending","display":"{ending}","endings":["king","pauper"],"state":["ending","choices_used"]},
	  "share_line":"{name}: {result} on {title}.","same_seed":true}`
	if err := json.Unmarshal([]byte(raw), &in); err != nil {
		t.Fatal(err)
	}
	gp := groupPlayFrom(&in)
	if gp == nil || gp.Mode != "series" || gp.BestOf != 5 || gp.RoundSeconds != 45 || len(gp.Modes) != 2 ||
		gp.Result.Compare != "ending" || len(gp.Result.Endings) != 2 || len(gp.Result.State) != 2 || !gp.SameSeed {
		t.Fatalf("group play = %+v", gp)
	}
	if groupPlayFrom(nil) != nil {
		t.Fatal("no group_play must stay none")
	}
	bad := manifestGroupPlay{}
	bad.Result.Compare = "banana"
	if groupPlayFrom(&bad) != nil {
		t.Fatal("an unknown compare must be dropped")
	}
	odd := manifestGroupPlay{Mode: "party"}
	odd.Result.Compare = "score"
	if g := groupPlayFrom(&odd); g == nil || g.Mode != "same_seed_async" || g.BestOf != 0 {
		t.Fatalf("unknown mode = %+v", g)
	}
}

func TestCheckSpecAnswers(t *testing.T) {
	if s, a, m := checkSpecAnswers(&generateIn{}, false); s != "" || a != nil || m != "" {
		t.Fatal("nothing sent must pass through")
	}
	if _, _, m := checkSpecAnswers(&generateIn{Answers: map[string]string{"a": "b"}}, true); m == "" {
		t.Fatal("a change must refuse spec and answers")
	}
	if _, _, m := checkSpecAnswers(&generateIn{Spec: json.RawMessage(`{"spec":"game-spec/1"}`)}, false); m == "" {
		t.Fatal("an empty spec must be refused")
	}
	if _, _, m := checkSpecAnswers(&generateIn{Spec: json.RawMessage(`[1`)}, false); m == "" {
		t.Fatal("a broken spec must be refused")
	}
	if _, _, m := checkSpecAnswers(&generateIn{Answers: map[string]string{"x": strings.Repeat("a", 400)}}, false); m == "" {
		t.Fatal("a long answer must be refused")
	}
	_, a, m := checkSpecAnswers(&generateIn{Answers: map[string]string{" length ": " short ", "": "x", "empty": " "}}, false)
	if m != "" || len(a) != 1 || a["length"] != "short" {
		t.Fatalf("answers = %v, %q", a, m)
	}
}

func TestFoldAnswers(t *testing.T) {
	p := &harness.Plan{Clarify: []harness.Clarify{{Slot: "length", Value: "60 s", Guessed: true, Question: "How long?", Choices: []string{"30", "60"}}, {Slot: "tone", Value: "calm", Guessed: true}}}
	foldAnswers(p, map[string]string{"length": "30 s", "players": "two friends"})
	if len(p.Clarify) != 3 {
		t.Fatalf("clarify = %+v", p.Clarify)
	}
	if c := p.Clarify[0]; c.Value != "30 s" || c.Guessed || c.Question != "" || c.Choices != nil {
		t.Fatalf("answered slot = %+v", c)
	}
	if !p.Clarify[1].Guessed || p.Clarify[2].Slot != "players" || p.Clarify[2].Guessed {
		t.Fatalf("others = %+v", p.Clarify)
	}
}
