package harness

// Picture art in the plan (docs/harness-gaps/images.md): an art-heavy plan sets plan.art = "image" so
// compose draws its pictures with muse-image, and the shared art_style slot
// (authoring/catalog/checklists/shared/art_style.json) settles the style, passed on as spec.theme.art_style.

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// ArtImage is plan.art for games whose pictures muse-image draws.
const ArtImage = "image"

// ArtStyleSlot is the shared slot's id.
const ArtStyleSlot = "art_style"

// sharedKey holds the cross-family slots in Checklists (not a family, so For never returns it).
const sharedKey = "_shared"

// sharedSlotFile is one checklists/shared/*.json file.
type sharedSlotFile struct {
	Slot              Slot     `json:"slot"`
	AppliesToFamilies []string `json:"applies_to_families"`
	Notes             string   `json:"notes,omitempty"`
}

// loadSharedSlots reads checklists/shared/*.json into out[sharedKey], one checklist per slot with the
// families it applies to. Files that don't parse are reported in skipped.
func loadSharedSlots(catalogDir string, out Checklists) (skipped []string) {
	files, _ := filepath.Glob(filepath.Join(catalogDir, "checklists", "shared", "*.json"))
	var fc FamilyChecklists
	fc.Family = sharedKey
	for _, f := range files {
		b, err := os.ReadFile(f)
		if err != nil {
			skipped = append(skipped, filepath.Base(f)+": "+err.Error())
			continue
		}
		var s sharedSlotFile
		if err := json.Unmarshal(b, &s); err != nil || s.Slot.ID == "" || len(s.AppliesToFamilies) == 0 {
			skipped = append(skipped, "shared/"+filepath.Base(f)+": not a shared slot")
			continue
		}
		fc.Checklists = append(fc.Checklists, Checklist{AppliesTo: s.AppliesToFamilies, Slots: []Slot{s.Slot}, Notes: s.Notes})
	}
	if len(fc.Checklists) > 0 {
		out[sharedKey] = fc
	}
	return skipped
}

// sharedSlot is the shared slot with this id when it applies to the family, or nil.
func (c Checklists) sharedSlot(id, family string) *Slot {
	for _, cl := range c[sharedKey].Checklists {
		for i := range cl.Slots {
			if cl.Slots[i].ID == id && oneOf(family, cl.AppliesTo) {
				s := cl.Slots[i]
				return &s
			}
		}
	}
	return nil
}

// withArtStyle adds the shared art_style slot to the checklists when the top type's family takes it and
// no checklist has it already. The planner then settles it like any slot; finishArt decides whether it
// may be a question.
func (c Checklists) withArtStyle(lists []checklistFor, types []ContextType) []checklistFor {
	if len(types) == 0 {
		return lists
	}
	for _, l := range lists {
		for _, s := range l.Slots {
			if s.ID == ArtStyleSlot {
				return lists
			}
		}
	}
	s := c.sharedSlot(ArtStyleSlot, types[0].Family)
	if s == nil {
		return lists
	}
	if len(lists) == 0 {
		return []checklistFor{{Family: types[0].Family, For: []string{types[0].ID}, Slots: []Slot{*s}}}
	}
	out := append([]checklistFor(nil), lists...)
	out[0].Slots = append(append([]Slot(nil), out[0].Slots...), *s)
	return out
}

// reUIPiece names pieces that are interface or content, not pictures (buttons, counters, word banks).
var reUIPiece = regexp.MustCompile(`(?i)\b(button|buttons|card|cards|counter|bar|meter|timer|clock|hud|label|labels|choice|choices|bank|list|text|hint|prompt|prompts|answer|answers|icon|icons|score|trail|track|lane|lanes|tree|surface|grid|board|tile|tiles|cell|cells|keyboard|slot|slots|reveal|control|controls|menu|scene)\b`)

// storyTools are the tools that make a game a story.
var storyTools = []string{"branching_story", "choice_story", "story_vars"}

// artHeavy reports a plan whose pictures carry the game: a story (it has characters), or three or more
// pieces that are drawn things rather than interface or content.
func artHeavy(plan *Plan) bool {
	for _, t := range plan.ToolIDs {
		if oneOf(t, storyTools) {
			return true
		}
	}
	if plan.Spec == nil {
		return false
	}
	drawn := 0
	for _, it := range plan.Spec.Pieces.Items {
		if strings.TrimSpace(it.Name) != "" && !reUIPiece.MatchString(it.Name) {
			drawn++
		}
	}
	return drawn >= 3
}

// requestStyle is the art style the request names ("80s anime", "pixel art"), or "".
func requestStyle(request string) string {
	return strings.ToLower(strings.TrimSpace(reStyleWords.FindString(request)))
}

// finishArt sets plan.art and spec.theme.art_style. Only an art-heavy plan whose request names no style
// and whose style no earlier look pick settles may ask about the style; otherwise the slot is a stated
// guess (the anatomy says "I'm drawing it as …"), or the person's own words.
func finishArt(plan *Plan, in PlanInput) {
	heavy := artHeavy(plan)
	if heavy {
		plan.Art = ArtImage
	}
	named := requestStyle(in.Request)
	var picked string
	if p := lookPreference(in.Context.Preferences); p != nil {
		picked = strings.TrimSpace(p.Chosen.Value)
		if picked == "" {
			picked = strings.TrimSpace(p.Chosen.Label)
		}
	}
	style := ""
	for i := range plan.Clarify {
		c := &plan.Clarify[i]
		if c.Slot != ArtStyleSlot {
			continue
		}
		switch {
		case named != "":
			c.Value, c.Guessed, c.Question, c.Choices = named, false, "", nil
		case picked != "":
			c.Value, c.Guessed, c.Question, c.Choices = picked, false, "", nil
		case !heavy && c.Question != "":
			c.Question, c.Choices = "", nil
			plan.Notes = append(plan.Notes, "art_style: not asked (the game is not art-heavy)")
		}
		style = c.Value
	}
	if style == "" {
		style = named
	}
	if style == "" {
		style = picked
	}
	if plan.Spec != nil && style != "" && plan.Spec.Theme.ArtStyle == "" {
		plan.Spec.Theme.ArtStyle = style
	}
}
