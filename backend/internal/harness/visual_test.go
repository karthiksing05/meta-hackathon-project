package harness

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

const visualReply = `{"style": "cut-paper diorama, soft shadows", "scene": "a night market",
 "palette": {"mood": "warm night", "colors": {"bg": "#101826", "ink": "#1A1A1A", "surface": "#24324A", "primary": "#E8A33C",
   "secondary": "#4FA3A5", "accent": "#F2D16B", "danger": "#E2445C", "bogus": "red"}},
 "layout": {"hud": "top bar", "play": "middle", "controls": "bottom third", "quiet": ["top 80 px", "middle"]},
 "backdrop": {"id": "backdrop", "depicts": "night market", "render": "image", "prompt": "A night market in cut paper..."},
 "assets": [
  {"id": "Lantern", "piece": "player", "depicts": "paper lantern", "play_px": 48, "frames": 1, "render": "image", "prompt": "A paper lantern..."},
  {"id": "moth", "piece": "pickup", "depicts": "pale moth", "play_px": 32, "frames": 1, "render": "image", "prompt": ""},
  {"id": "map", "piece": "question picture", "depicts": "map of Canada", "play_px": 240, "frames": 1, "render": "image", "prompt": "Canada..."},
  {"id": "cell", "piece": "board cell", "depicts": "tile", "play_px": 56, "frames": 1, "render": "image", "prompt": "a tile"},
  {"id": "flame", "piece": "hazard", "depicts": "flame", "play_px": 40, "frames": 4, "render": "image", "prompt": "a flame"},
  {"id": "lantern", "piece": "again", "depicts": "repeat", "render": "svg"},
  {"id": "bad id!", "piece": "x", "depicts": "x", "render": "image", "prompt": "x"},
  {"id": "score_bar", "piece": "hud", "depicts": "bar", "render": "sparkles"}
 ],
 "readability": ["HUD on a solid surface"]}`

func asset(v *Visual, id string) *VisualAsset {
	for i := range v.Assets {
		if v.Assets[i].ID == id {
			return &v.Assets[i]
		}
	}
	return nil
}

func TestVisualNormalize(t *testing.T) {
	var v Visual
	if err := jsonUnmarshal(visualReply, &v); err != nil {
		t.Fatal(err)
	}
	notes := v.Normalize(rolesFor([]string{"grid_board", "lives", "typed_answer"}))
	want := map[string]string{
		"lantern":   RenderImage, // id lowercased, painted
		"moth":      RenderSVG,   // no prompt
		"map":       RenderImage, // a real place's shape: painted
		"cell":      RenderSVG,   // read exactly
		"flame":     RenderSVG,   // 4 frames must match
		"score_bar": RenderSVG,   // unknown render -> svg (and "bar" is read exactly)
		"life":      RenderSVG,   // fragment role added
	}
	for id, r := range want {
		a := asset(&v, id)
		if a == nil {
			t.Errorf("no asset %s; notes %v", id, notes)
			continue
		}
		if a.Render != r {
			t.Errorf("%s render %s, want %s", id, a.Render, r)
		}
	}
	if asset(&v, "bad id!") != nil {
		t.Error("kept an invalid id")
	}
	if n := len(v.Assets); n != 7 {
		t.Errorf("%d assets, want 7 (duplicate and bad id dropped, life added)", n)
	}
	if v.Backdrop.Render != RenderImage || v.Backdrop.ID != "backdrop" {
		t.Errorf("backdrop %+v", v.Backdrop)
	}
	if _, ok := v.Palette.Colors["bogus"]; ok {
		t.Error("kept a non-hex palette color")
	}
	if ink := v.Palette.Colors["ink"]; ink != "#FAFAFA" {
		t.Errorf("dark ink on a dark bg should flip to light, got %s", ink)
	}
	if got := len(v.ImageAssets()); got != 2 {
		t.Errorf("%d image assets, want 2", got)
	}
}

func TestVisualCapsPaintedSprites(t *testing.T) {
	v := Visual{Backdrop: VisualAsset{}}
	for _, id := range []string{"a", "b", "c", "d", "e", "f", "g", "h"} {
		v.Assets = append(v.Assets, VisualAsset{ID: id, Depicts: "a fox", Render: "image", Prompt: "a fox"})
	}
	v.Normalize(nil)
	if n := len(v.ImageAssets()); n != MaxImageAssets {
		t.Errorf("%d painted, want %d", n, MaxImageAssets)
	}
	if v.Backdrop.Render != RenderSVG {
		t.Error("a backdrop with no prompt should be svg")
	}
}

func TestContrast(t *testing.T) {
	if c := contrast("#000000", "#FFFFFF"); c < 20.9 || c > 21.1 {
		t.Errorf("black on white %.2f, want 21", c)
	}
	if c := contrast("#F5EEDD", "#FFF0C9"); c > 1.5 {
		t.Errorf("cream on cream %.2f should be low", c)
	}
}

func TestPlanRunsVisualStage(t *testing.T) {
	in := planInput(t)
	muse := &fakeMuse{reply: func(system, _ string) string {
		if strings.HasPrefix(system, "You are Muse Studio's art director") {
			return visualReply
		}
		return planReply
	}}
	p, err := (&Planner{Muse: muse, Checklists: testChecklists(), Visual: true}).Plan(context.Background(), in)
	if err != nil {
		t.Fatal(err)
	}
	if p.Spec.Visual == nil {
		t.Fatalf("no visual part; notes %v", p.Notes)
	}
	if p.Calls[len(p.Calls)-1].Step != "visual" {
		t.Errorf("last call %v, want visual", p.Calls)
	}
	// every fragment role of the tools the plan kept has an asset
	for _, r := range rolesFor(p.ToolIDs) {
		if asset(p.Spec.Visual, r.id) == nil {
			t.Errorf("the %s fragment's %s role has no asset", r.fragment, r.id)
		}
	}
	if asset(p.Spec.Visual, "lantern") == nil {
		t.Error("lost Muse's own asset")
	}
}

func TestPlanSurvivesVisualFailure(t *testing.T) {
	in := planInput(t)
	muse := &fakeMuse{reply: func(system, _ string) string {
		if strings.HasPrefix(system, "You are Muse Studio's art director") {
			return `not json at all`
		}
		return planReply
	}}
	p, err := (&Planner{Muse: muse, Checklists: testChecklists(), Visual: true}).Plan(context.Background(), in)
	if err != nil {
		t.Fatal(err)
	}
	if p.Spec == nil || p.Spec.Visual != nil {
		t.Fatalf("the plan should stand without a visual part")
	}
	found := false
	for _, n := range p.Notes {
		found = found || strings.HasPrefix(n, "visual")
	}
	if !found {
		t.Errorf("no note about the failed visual stage: %v", p.Notes)
	}
}

func TestVisualOn(t *testing.T) {
	for v, want := range map[string]bool{"": true, "1": true, "0": false, "off": false, "FALSE": false} {
		if VisualOn(v) != want {
			t.Errorf("VisualOn(%q) != %v", v, want)
		}
	}
}

func jsonUnmarshal(s string, v any) error { return json.Unmarshal([]byte(s), v) }
