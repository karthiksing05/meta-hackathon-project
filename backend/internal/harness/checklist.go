package harness

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// Clarification checklists (authoring/catalog/checklists/<family>.json, schema/checklist.schema.json): what
// the planner must settle before it makes a game of a family. A checklist that applies to ["*"] is the
// family default; one naming type ids replaces it for those types.

// Slot is one thing to settle.
type Slot struct {
	ID              string   `json:"id"`
	Ask             string   `json:"ask"`
	Why             string   `json:"why"`
	Need            string   `json:"need"` // "required" or "nice"
	ExtrapolateFrom string   `json:"extrapolate_from,omitempty"`
	Default         string   `json:"default"`
	AskWhen         string   `json:"ask_when,omitempty"`
	Choices         []string `json:"choices"`
	Affects         []string `json:"affects"`
	Notes           string   `json:"notes,omitempty"`
}

// Checklist is a set of slots for some types of a family.
type Checklist struct {
	AppliesTo []string `json:"applies_to"`
	Slots     []Slot   `json:"slots"`
	Notes     string   `json:"notes,omitempty"`
}

// FamilyChecklists is one checklists file.
type FamilyChecklists struct {
	Family     string      `json:"family"`
	Checklists []Checklist `json:"checklists"`
	Notes      string      `json:"notes,omitempty"`
}

// Checklists are every family's checklists, by family.
type Checklists map[string]FamilyChecklists

// For returns the checklist that applies to a type: its own if one names it, else the family default
// (nil if the family has none).
func (c Checklists) For(t GameType) *Checklist {
	fc, ok := c[t.Family]
	if !ok {
		return nil
	}
	var def *Checklist
	for i := range fc.Checklists {
		cl := &fc.Checklists[i]
		for _, id := range cl.AppliesTo {
			if id == t.ID {
				return cl
			}
			if id == "*" && def == nil {
				def = cl
			}
		}
	}
	return def
}

// LoadChecklists reads dir/checklists/*.json. A missing folder is no checklists; a file that doesn't
// parse or is incomplete is skipped and reported.
func LoadChecklists(catalogDir string) (Checklists, []string, error) {
	out := Checklists{}
	var skipped []string
	files, err := filepath.Glob(filepath.Join(catalogDir, "checklists", "*.json"))
	if err != nil {
		return nil, nil, err
	}
	sort.Strings(files)
	for _, f := range files {
		b, err := os.ReadFile(f)
		if err != nil {
			return nil, nil, err
		}
		var fc FamilyChecklists
		if err := json.Unmarshal(b, &fc); err != nil {
			skipped = append(skipped, fmt.Sprintf("%s: %v", filepath.Base(f), err))
			continue
		}
		if err := fc.validate(); err != nil {
			skipped = append(skipped, fmt.Sprintf("%s: %v", filepath.Base(f), err))
			continue
		}
		out[fc.Family] = fc
	}
	return out, skipped, nil
}

func (fc *FamilyChecklists) validate() error {
	if !oneOf(fc.Family, Families) {
		return fmt.Errorf("family %q is not a catalog family", fc.Family)
	}
	if len(fc.Checklists) == 0 {
		return fmt.Errorf("no checklists")
	}
	for _, cl := range fc.Checklists {
		if len(cl.AppliesTo) == 0 || len(cl.Slots) == 0 {
			return fmt.Errorf("a checklist without applies_to or slots")
		}
		seen := map[string]bool{}
		for _, s := range cl.Slots {
			if !idPattern.MatchString(s.ID) || seen[s.ID] {
				return fmt.Errorf("slot id %q is not snake_case or is repeated", s.ID)
			}
			seen[s.ID] = true
			if strings.TrimSpace(s.Ask) == "" || strings.TrimSpace(s.Default) == "" {
				return fmt.Errorf("slot %q needs ask and default", s.ID)
			}
		}
	}
	return nil
}
