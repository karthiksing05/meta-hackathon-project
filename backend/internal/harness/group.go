package harness

import (
	"fmt"
	"strings"
)

// A game made for a Group (or an Event): the API sends the Group's name and its members' display names, so the
// plan and the build can use the Group's own people when the request is about them ("a quiz about our crew",
// icebreakers, a story starring us). Only names: no emails, usernames or anything else about a person.

// GroupMaxMembers caps the members a plan or a compose sees.
const GroupMaxMembers = 20

// GroupMember is one person in the Group, by display name.
type GroupMember struct {
	Name string `json:"name"`
}

// Group is the Group a game is made for.
type Group struct {
	ID      string        `json:"id"`
	Kind    string        `json:"kind"` // "group" or "event"
	Name    string        `json:"name"`
	Members []GroupMember `json:"members,omitempty"`
}

// groupLines is the plan prompt's paragraph about the Group the game is for; empty when there is none.
func groupLines(g *Group) string {
	if g == nil || strings.TrimSpace(g.Name) == "" {
		return ""
	}
	what := "Group"
	if g.Kind == "event" {
		what = "Event"
	}
	var names []string
	for _, m := range g.Members {
		if n := strings.TrimSpace(m.Name); n != "" && len(names) < GroupMaxMembers {
			names = append(names, clip(n, 40))
		}
	}
	var sb strings.Builder
	fmt.Fprintf(&sb, "Made for the %s %q", what, clip(strings.TrimSpace(g.Name), 80))
	if len(names) > 0 {
		fmt.Fprintf(&sb, ", whose members are %s", strings.Join(names, ", "))
	}
	sb.WriteString(".\n")
	sb.WriteString("When the request is about this " + what + " or its people (\"our group\", \"us\", \"the crew\", a quiz about each other, " +
		"icebreakers, a story or cast starring us), put the " + what + "'s name and these people's names into the spec: " +
		"the cast and characters, the questions and prompts, the theme. Use only the names given here and never invent " +
		"facts about them (ask or write questions people answer about each other instead). When the request isn't about " +
		"the people, the game may simply nod to the " + what + "'s name.\n")
	return sb.String()
}
