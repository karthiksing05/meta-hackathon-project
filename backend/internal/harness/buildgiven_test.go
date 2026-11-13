package harness

import (
	"context"
	"encoding/json"
	"testing"
)

// BuildGiven makes the context without asking the planner: the person's agreed spec is the plan's spec.
func TestBuildGivenUsesTheSpec(t *testing.T) {
	h := newTestHarness(t, Config{})
	spec := &Spec{Spec: SpecVersion, Theme: Theme{World: "kitchen", Tone: "frantic"}}
	b, err := h.BuildGiven(context.Background(), Request{Text: "a harry potter krillion"}, spec)
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]any
	raw, _ := json.Marshal(b.Context)
	_ = json.Unmarshal(raw, &m)
	plan, ok := m["plan"].(map[string]any)
	if !ok {
		t.Fatalf("context plan = %v", m["plan"])
	}
	sp, _ := plan["spec"].(map[string]any)
	th, _ := sp["theme"].(map[string]any)
	if th["world"] != "kitchen" || len(raw) > ContextMaxBytes || b.Plan.Spec != spec {
		t.Errorf("spec in context = %v, %d bytes", sp, len(raw))
	}
	if len(b.Plan.TypeIDs) == 0 || len(b.Plan.TypeIDs) > 3 {
		t.Errorf("type ids = %v", b.Plan.TypeIDs)
	}
}
