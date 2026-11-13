package harness

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

const officeRequest = "The Office trivia with 12 questions, a 15-second timer and 3 lives"

func TestRequirementsJSInGoja(t *testing.T) {
	js, err := LoadReqJS()
	if err != nil {
		t.Fatal(err)
	}
	var seeds []Requirement
	if err := js.Call(&seeds, "seedRequirements", officeRequest); err != nil {
		t.Fatal(err)
	}
	quotes := []string{}
	for _, r := range seeds {
		quotes = append(quotes, r.Quote)
	}
	joined := strings.Join(quotes, " | ")
	for _, want := range []string{"12 questions", "15-second", "3 lives"} {
		if !strings.Contains(joined, want) {
			t.Errorf("seeds %q lack %q", joined, want)
		}
	}
	// a plan that says 10 questions contradicts "12 questions"
	s := baseSpec()
	s.Pieces.Items = []Piece{{Name: "question deck", Role: "the 10 questions of a run", Count: "10 questions"}}
	got := requirementChecks(&s, PlanInput{Request: officeRequest, Requirements: seeds})
	if len(got) == 0 || !strings.HasPrefix(got[0], "pieces: requirements ") || len(s.Requirements) != len(seeds) {
		t.Errorf("contradiction not found: %v", got)
	}
	s.Pieces.Items[0].Count = "12 questions"
	s.Pieces.Items[0].Role = "the 12 questions of a run"
	if got := requirementChecks(&s, PlanInput{Request: officeRequest, Requirements: seeds}); len(got) != 0 {
		t.Errorf("a plan that agrees is flagged: %v", got)
	}
}

// reqMuse answers the requirements call with a list, or fails.
type reqMuse struct {
	calls int
	fail  bool
}

func (m *reqMuse) JSON(_ context.Context, system, _ string) (json.RawMessage, error) {
	m.calls++
	if m.fail {
		return nil, errors.New("402 billing")
	}
	return json.RawMessage(`{"requirements":[{"quote":"12 questions","kind":"count","target":{"measure":"questions","op":"==","value":12},"must":true,"verify":"code"},{"quote":"The Office","kind":"content","target":null,"must":true,"verify":"judge"}]}`), nil
}

func TestExtractRequirements(t *testing.T) {
	ok := &reqMuse{}
	plan := &Plan{}
	ex := (&Planner{Requirements: true, ReqMuse: ok}).extractRequirements(context.Background(), officeRequest, plan)
	if ex == nil || ex.By != "muse" || ok.calls != 1 || len(plan.Calls) != 1 || plan.Calls[0].Step != "requirements" {
		t.Fatalf("muse extraction: %+v calls %d", ex, ok.calls)
	}
	all := ""
	for _, r := range ex.Requirements {
		all += r.Quote + " | "
	}
	if !strings.Contains(all, "The Office") || !strings.Contains(all, "3 lives") {
		t.Errorf("merge lost a requirement: %s", all)
	}
	// a failing call keeps the code pass
	bad := &reqMuse{fail: true}
	ex = (&Planner{Requirements: true, ReqMuse: bad}).extractRequirements(context.Background(), officeRequest, &Plan{})
	if ex == nil || !strings.HasPrefix(ex.By, "code (muse failed") || len(ex.Requirements) == 0 {
		t.Errorf("fallback: %+v", ex)
	}
	// off: no Muse call
	off := &reqMuse{}
	ex = (&Planner{ReqMuse: off}).extractRequirements(context.Background(), officeRequest, &Plan{})
	if ex == nil || ex.By != "code" || off.calls != 0 {
		t.Errorf("off: %+v, %d calls", ex, off.calls)
	}
	if !RequirementsOn("") || RequirementsOn("0") || RequirementsOn("off") {
		t.Error("HARNESS_REQUIREMENTS: on by default, 0 turns it off")
	}
	if l := requirementsLines(ex.Requirements); !strings.Contains(l, "spec.requirements") || !strings.Contains(l, `"12 questions"`) {
		t.Errorf("prompt lines: %s", l)
	}
}
