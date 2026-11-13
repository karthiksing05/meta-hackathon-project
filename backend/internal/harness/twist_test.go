package harness

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestTwistDecodesAndNotes(t *testing.T) {
	var p Progression
	raw := `{"steps":[{"at":"0-20 s","change":"slow"},{"at":"20-40 s","change":"faster"},{"at":"40 s+","change":"fastest"}],"levers":["speed"],
	"twist":{"candidates":[{"kind":"decoy","rule":"after 30 s a fake coin costs a life"},{"kind":"speed_up","rule":"every 10 coins the belt speeds up 15%"}],"picked":"","kind":"","why":""}}`
	if err := json.Unmarshal([]byte(raw), &p); err != nil {
		t.Fatal(err)
	}
	s := &Spec{Progression: p}
	notes := twistNotes(s, "a coin game")
	if s.Progression.Twist.Picked != "after 30 s a fake coin costs a life" || s.Progression.Twist.Kind != "decoy" {
		t.Fatalf("picked not filled: %+v", s.Progression.Twist)
	}
	if len(notes) != 1 || !strings.Contains(notes[0], "first candidate") {
		t.Fatalf("notes %v", notes)
	}
	if n := twistNotes(&Spec{}, "x"); len(n) != 1 || !strings.Contains(n[0], "no difficulty twist") {
		t.Fatalf("missing twist note %v", n)
	}
}

func TestGentleRequest(t *testing.T) {
	for _, r := range []string{"an easy puzzle for kids", "a chill fishing game", "something relaxing"} {
		if !GentleRequest(r) {
			t.Errorf("%q should be gentle", r)
		}
	}
	for _, r := range []string{"a hard dodge game", "Harry Potter trivia"} {
		if GentleRequest(r) {
			t.Errorf("%q should not be gentle", r)
		}
	}
}

func TestTwistInPlanSchema(t *testing.T) {
	sch := specSchema([]string{"progression"}, Score{}, Social{})
	if !strings.Contains(sch, "THE TWIST STEP") || !strings.Contains(sch, "late_rule_change") {
		t.Fatal("progression schema lacks the twist step")
	}
}

func TestTwistKindValidated(t *testing.T) {
	s := &Spec{Progression: Progression{Twist: &Twist{Picked: "x", Kind: "bogus"}}}
	problems, _ := s.Validate()
	found := false
	for _, p := range problems {
		if strings.Contains(p, "twist kind") {
			found = true
		}
	}
	if !found {
		t.Fatal("bogus twist kind not flagged")
	}
}
