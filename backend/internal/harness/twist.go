package harness

import (
	"regexp"
	"strings"
)

// The twist step (Karthik, 2026-11-13: "think actively of some twist to make things harder"). It rides on the plan's
// progression part, so it costs no extra Muse round trip: the planner lists 2-3 candidate difficulty twists, picks the
// one that best fits the theme, and compose builds it. The gate's skill spread (playtest/bots.mjs skillSpread) checks
// that it made skill show. Difficulty stays the creator's: a gentle request keeps a gentle twist.

// Twist is the difficulty twist on spec.progression.
type Twist struct {
	Candidates []TwistCandidate `json:"candidates,omitempty"`
	Picked     string           `json:"picked"`
	Kind       string           `json:"kind,omitempty"`
	Why        string           `json:"why,omitempty"`
}

// TwistCandidate is one proposed twist.
type TwistCandidate struct {
	Kind string `json:"kind"`
	Rule string `json:"rule"`
}

// TwistKinds are the kinds of difficulty twist.
var TwistKinds = []string{"ramp", "constraint", "limited_resource", "decoy", "speed_up", "late_rule_change", "combo", "penalty"}

var gentleWords = regexp.MustCompile(`(?i)\b(easy|easier|chill|chilled|relax(ing|ed)?|gentle|cozy|cosy|calm|for (kids|children|toddlers|my (son|daughter|kid))|kid[- ]friendly|no stress|stress[- ]free|beginner)\b`)

// GentleRequest reports whether the person asked for an easy game, which keeps the twist gentle.
func GentleRequest(request string) bool { return gentleWords.MatchString(request) }

// twistNotes checks the twist step and returns notes for plan.Notes (never problems: a missing twist must not cost a
// repair round). It fills picked from the first candidate when the planner left it empty.
func twistNotes(s *Spec, request string) []string {
	t := s.Progression.Twist
	if t == nil || (strings.TrimSpace(t.Picked) == "" && len(t.Candidates) == 0) {
		return []string{"twist: the planner proposed no difficulty twist"}
	}
	var notes []string
	if strings.TrimSpace(t.Picked) == "" {
		t.Picked, t.Kind = t.Candidates[0].Rule, t.Candidates[0].Kind
		notes = append(notes, "twist: picked the first candidate")
	}
	if GentleRequest(request) {
		notes = append(notes, "twist: the request asks for a gentle game; keep the twist soft")
	}
	return notes
}
