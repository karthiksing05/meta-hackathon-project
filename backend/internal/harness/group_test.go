package harness

import (
	"fmt"
	"strings"
	"testing"
)

func TestGroupLinesNameThePeople(t *testing.T) {
	if groupLines(nil) != "" || groupLines(&Group{ID: "g"}) != "" {
		t.Fatal("no Group, no lines")
	}
	g := &Group{ID: "g", Kind: "group", Name: "Pickle Crew"}
	for i := 0; i < 25; i++ {
		g.Members = append(g.Members, GroupMember{Name: fmt.Sprintf("P%d", i)})
	}
	l := groupLines(g)
	if !strings.Contains(l, `Group "Pickle Crew"`) || !strings.Contains(l, "P0, P1") || !strings.Contains(l, "P19") || strings.Contains(l, "P20") {
		t.Fatalf("group lines: %s", l)
	}
	in := PlanInput{Request: "a quiz about us", Group: g, Context: GenContext{Types: []ContextType{{ID: "t"}}}}
	if !strings.Contains(planUser(in, nil), "Pickle Crew") || !strings.Contains(stageUser(in, nil, []string{"content"}), "Pickle Crew") {
		t.Fatal("the plan prompts don't name the Group")
	}
	if !strings.Contains(groupLines(&Group{Kind: "event", Name: "Fog Run"}), `Event "Fog Run"`) {
		t.Fatal("an Event is called an Event")
	}
}
