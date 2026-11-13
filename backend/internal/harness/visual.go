package harness

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// The visual stage (draft, Bayan): after the spec is settled, Muse art-directs the game. It writes what the
// game should look like and how each piece must read at play size, plus a full image-model prompt for every
// asset worth painting, and picks how each asset is drawn: painted by Muse Image ("image"), drawn as SVG
// ("svg") or left to the engine ("engine"). The generator's art step paints the "image" assets after the
// game passes the gate. The stage is optional: any failure leaves Spec.Visual nil and the plan stands.

// Visual is spec.visual.
type Visual struct {
	Style       string        `json:"style"`       // medium, line, shading, texture, shape language
	Scene       string        `json:"scene"`       // the setting, light and time of day, what sits at the edges
	Palette     VisualPalette `json:"palette"`     // the colors the engine uses for HUD, text and controls
	Layout      VisualLayout  `json:"layout"`      // where things sit on the 360 x 640 portrait screen
	Backdrop    VisualAsset   `json:"backdrop"`    // the full-screen backdrop
	Assets      []VisualAsset `json:"assets"`      // one per drawn piece
	Readability []string      `json:"readability"` // rules a player-eye check can test
}

// VisualPalette is the mood and the engine's color tokens.
type VisualPalette struct {
	Mood   string            `json:"mood"`
	Colors map[string]string `json:"colors"` // bg, ink, surface, primary, secondary, accent, danger as #RRGGBB
}

// VisualLayout is the screen plan.
type VisualLayout struct {
	HUD      string   `json:"hud"`      // where the score, timer and lives sit
	Play     string   `json:"play"`     // the play area
	Controls string   `json:"controls"` // where the buttons, keys or drag zone sit
	Quiet    []string `json:"quiet"`    // areas the backdrop keeps plain, because text or pieces go there
}

// VisualAsset is one drawn thing.
type VisualAsset struct {
	ID      string `json:"id"`       // the art.sprites name the manifest uses
	Piece   string `json:"piece"`    // the spec piece or fragment role it draws
	Depicts string `json:"depicts"`  // the one subject, in 1-6 plain words
	ReadsAs string `json:"reads_as"` // how it reads at play size and how it differs from the other pieces
	PlayPx  int    `json:"play_px"`  // about how big it is on screen
	Frames  int    `json:"frames"`   // 1, or the number of variants/frames
	Render  string `json:"render"`   // image | svg | engine
	Reason  string `json:"reason"`   // why that render
	Prompt  string `json:"prompt"`   // for "image": the full image-model prompt, subject and style only
}

// Render modes.
const (
	RenderImage  = "image"
	RenderSVG    = "svg"
	RenderEngine = "engine"
)

// MaxImageAssets caps the painted sprites per game (the backdrop is extra): each is one Muse Image call.
const MaxImageAssets = 6

// fragmentRoles are the sprite roles each fragment draws (authoring/expander: the art roles).
var fragmentRoles = map[string][]string{
	"player_drag": {"avatar"}, "lanes": {"avatar"}, "gravity_jump": {"avatar", "ground"}, "spawn_wave": {"hazard"},
	"pickups": {"pickup"}, "lives": {"life"}, "grid_board": {"cell"}, "match_pairs": {"card"}, "tile_slide": {"tile"},
	"sort_bins": {"bin"}, "sequence_memory": {"pad"}, "quiz": {"button"}, "choice_story": {"scene", "button"},
}

// Pieces a player must read exactly (a value, a match, a hit edge, a control). SVG and the engine draw them
// crisply at the size and colors the game sets; a painted version blurs, drifts between copies or hides the
// number the engine writes on it. Blind tests (2026-11-12): SVG wins for matched sets and color-coded pieces.
var functionalWords = regexp.MustCompile(`(?i)\b(cell|cells|tile|tiles|bin|bins|button|buttons|pad|pads|card|cards|key|keys|keyboard|lane|lanes|wall|walls|pipe|pipes|gap|board|slot|slots|bar|meter|gauge|grid|counter|letter|letters|digit|digits|number|numbers|text|label|word|words|arrow|arrows|icon|icons)\b`)

var visualID = regexp.MustCompile(`^[a-z][a-z0-9_]{0,23}$`)
var hexColor = regexp.MustCompile(`^#[0-9A-Fa-f]{6}$`)

const visualSystem = `You are Muse Studio's art director. A tiny phone game has been planned (the spec below). Decide how it
looks before anyone draws it: the scene, the style, the screen plan, and every piece the player sees, so the art
helps people play instead of getting in the way. Think about the actual screen: 360 x 640 portrait, a HUD at the
top, the play area in the middle, controls where the thumb is. Reply with one JSON object only:

{"style": string, "scene": string,
 "palette": {"mood": string, "colors": {"bg": hex, "ink": hex, "surface": hex, "primary": hex, "secondary": hex, "accent": hex, "danger": hex}},
 "layout": {"hud": string, "play": string, "controls": string, "quiet": [string]},
 "backdrop": {"id": "backdrop", "depicts": string, "reads_as": string, "render": "image"|"svg", "reason": string, "prompt": string},
 "assets": [{"id": string, "piece": string, "depicts": string, "reads_as": string, "play_px": number, "frames": number,
             "render": "image"|"svg"|"engine", "reason": string, "prompt": string}],
 "readability": [string]}

How to fill it
- style: the medium and its rules in one or two sentences (line weight, shading, texture, shape language). Carry the
  person's requested style fully; if they named none, pick one that fits the theme and tone, not a generic cartoon.
- scene: the setting, the light, the time of day, and what sits at the edges. The middle stays calm.
- palette: ink is the text color and must contrast strongly with bg (4.5:1 or more); surface is panels and cards;
  danger is warnings. The engine draws the HUD, text and controls in these colors.
- layout: say where the HUD, the play area and the controls go for THIS game, and list the quiet areas (where text,
  the HUD or moving pieces go) the backdrop must keep plain.
- assets: one per thing the player sees that is drawn: every spec piece with a body, and every fragment role listed
  below. id is the sprite name the game will use (lowercase, digits and _, max 24; use the fragment role's own name
  for fragment roles). piece says which spec piece or role it is. reads_as: how a player tells it apart at play_px
  (silhouette, color, size) from the other pieces and the backdrop.
- render, per asset:
  "image" = painted by an image model: characters, creatures, food, objects, props, real places and anything that
    must look like a real thing (a country's shape on a map, a landmark, an animal). One subject per image.
  "svg" = drawn as vector: pieces a player must read exactly or that must match each other: cells, tiles, cards,
    buttons, keys, lanes, walls, bins, color-coded sets, anything with a number, letter or word on it, and pieces with
    several frames or variants that must stay consistent.
  "engine" = the engine draws it from shapes and text (counters, bars, plain markers). No art needed.
  Give the reason in a few words. At most 6 assets may be "image".
- prompt (only for "image", and for the backdrop): a detailed prompt for the image model, 40-120 words. For a sprite:
  the single subject, its pose and angle, its silhouette, its colors in the palette, the style's line and shading,
  and what makes it read at play_px. Never mention the background, text, or other objects: the art step adds those.
  For the backdrop: the scene in the style, where the detail goes (edges and corners), which areas stay plain (the
  layout's quiet areas, by position), the light, and the palette. No characters, game pieces, text, numbers or UI.
- readability: 3-6 short testable rules for this game ("the HUD text sits on a solid surface", "hazards are the only
  red things", "no text over the play area").
- Real people, brands and franchises the person named may be drawn with their real names; real people only as a
  cartoon or caricature, never photorealistic. Never copy another game's art.`

// planVisual runs the visual stage and puts the result on plan.Spec.Visual. Errors become notes.
func (p *Planner) planVisual(ctx context.Context, plan *Plan, in PlanInput) {
	if plan.Spec == nil {
		return
	}
	t := time.Now()
	raw, err := p.Muse.JSON(ctx, visualSystem, visualUser(in, plan))
	plan.Calls = append(plan.Calls, CallTiming{Step: "visual", Ms: ms(time.Since(t))})
	if err != nil {
		plan.Notes = append(plan.Notes, "visual stage failed: "+err.Error())
		return
	}
	var v Visual
	if err := json.Unmarshal(raw, &v); err != nil {
		var wrapped struct {
			Visual Visual `json:"visual"`
		}
		if json.Unmarshal(raw, &wrapped) != nil || wrapped.Visual.Style == "" {
			plan.Notes = append(plan.Notes, "visual stage: reply doesn't match its schema: "+err.Error())
			return
		}
		v = wrapped.Visual
	}
	notes := v.Normalize(rolesFor(plan.ToolIDs))
	for _, n := range notes {
		plan.Notes = append(plan.Notes, "visual: "+n)
	}
	plan.Spec.Visual = &v
}

func visualUser(in PlanInput, plan *Plan) string {
	var sb strings.Builder
	sb.WriteString(requestLine(in))
	spec, _ := json.Marshal(plan.Spec)
	fmt.Fprintf(&sb, "The game spec:\n%s\n\n", spec)
	if d, err := json.Marshal(plan.Design); err == nil {
		fmt.Fprintf(&sb, "The design:\n%s\n\n", d)
	}
	roles := rolesFor(plan.ToolIDs)
	if len(roles) > 0 {
		sb.WriteString("Fragment roles the game will draw (each needs an asset with this id):\n")
		for _, r := range roles {
			fmt.Fprintf(&sb, "- %s (drawn by %s)\n", r.id, r.fragment)
		}
	}
	return sb.String()
}

type fragmentRole struct{ id, fragment string }

// rolesFor are the sprite roles of the planned tools that are fragments, in tool order.
func rolesFor(toolIDs []string) []fragmentRole {
	var out []fragmentRole
	seen := map[string]bool{}
	for _, t := range toolIDs {
		for _, r := range fragmentRoles[t] {
			if !seen[r] {
				seen[r] = true
				out = append(out, fragmentRole{id: r, fragment: t})
			}
		}
	}
	return out
}

// Normalize checks the visual part and fixes what it safely can, returning what it changed:
//   - ids are valid sprite names and unique; fragment roles that have no asset get one (svg);
//   - render is image, svg or engine; pieces a player must read exactly, and multi-frame pieces, are svg;
//   - an "image" asset has a prompt (else it is drawn as svg); at most MaxImageAssets are painted;
//   - the backdrop is painted when it has a prompt;
//   - palette colors are hex, and ink contrasts with bg (4.5:1), else ink becomes near-black or near-white.
func (v *Visual) Normalize(roles []fragmentRole) []string {
	var notes []string
	note := func(f string, a ...any) { notes = append(notes, fmt.Sprintf(f, a...)) }

	seen := map[string]bool{"backdrop": true}
	kept := v.Assets[:0]
	for _, a := range v.Assets {
		a.ID = strings.ToLower(strings.TrimSpace(a.ID))
		if !visualID.MatchString(a.ID) || seen[a.ID] {
			note("dropped asset %q (bad or repeated id)", a.ID)
			continue
		}
		seen[a.ID] = true
		kept = append(kept, a)
	}
	v.Assets = kept
	for _, r := range roles {
		if !seen[r.id] {
			seen[r.id] = true
			v.Assets = append(v.Assets, VisualAsset{ID: r.id, Piece: r.fragment + " " + r.id, Depicts: r.id, Frames: 1,
				Render: RenderSVG, Reason: "fragment role with no art direction"})
			note("added %s for the %s fragment (svg)", r.id, r.fragment)
		}
	}

	images := 0
	for i := range v.Assets {
		a := &v.Assets[i]
		if a.Frames < 1 {
			a.Frames = 1
		}
		a.Render = strings.ToLower(strings.TrimSpace(a.Render))
		switch a.Render {
		case RenderImage, RenderSVG, RenderEngine:
		default:
			note("%s: render %q isn't image, svg or engine; using svg", a.ID, a.Render)
			a.Render = RenderSVG
		}
		if a.Render != RenderImage {
			continue
		}
		switch {
		case functionalWords.MatchString(a.ID + " " + a.Piece + " " + a.Depicts):
			note("%s: a piece players read exactly; drawn as svg, not painted", a.ID)
			a.Render, a.Reason = RenderSVG, "read exactly: "+a.Reason
		case a.Frames > 1:
			note("%s: %d frames must stay consistent; drawn as svg, not painted", a.ID, a.Frames)
			a.Render = RenderSVG
		case strings.TrimSpace(a.Prompt) == "":
			note("%s: no image prompt; drawn as svg", a.ID)
			a.Render = RenderSVG
		case images >= MaxImageAssets:
			note("%s: over the %d painted sprites; drawn as svg", a.ID, MaxImageAssets)
			a.Render = RenderSVG
		default:
			images++
		}
	}

	v.Backdrop.ID = "backdrop"
	v.Backdrop.Frames = 1
	if strings.TrimSpace(v.Backdrop.Prompt) != "" {
		v.Backdrop.Render = RenderImage
	} else {
		v.Backdrop.Render = RenderSVG
		note("backdrop: no image prompt; drawn as svg")
	}

	if v.Palette.Colors == nil {
		v.Palette.Colors = map[string]string{}
	}
	for k, c := range v.Palette.Colors {
		if !hexColor.MatchString(c) {
			delete(v.Palette.Colors, k)
			note("palette.%s: %q isn't #RRGGBB; dropped", k, c)
		} else {
			v.Palette.Colors[k] = strings.ToUpper(c)
		}
	}
	if bg, ok := v.Palette.Colors["bg"]; ok {
		ink, hasInk := v.Palette.Colors["ink"]
		if !hasInk || contrast(ink, bg) < 4.5 {
			fix := "#141414"
			if contrast("#FAFAFA", bg) > contrast(fix, bg) {
				fix = "#FAFAFA"
			}
			v.Palette.Colors["ink"] = fix
			note("palette.ink %s has %.1f:1 contrast on bg %s; using %s", ink, contrast(ink, bg), bg, fix)
		}
	}
	return notes
}

// ImageAssets are the sprites the art step paints.
func (v *Visual) ImageAssets() []VisualAsset {
	var out []VisualAsset
	for _, a := range v.Assets {
		if a.Render == RenderImage {
			out = append(out, a)
		}
	}
	return out
}

// contrast is the WCAG contrast ratio of two #RRGGBB colors (1 when either is malformed).
func contrast(a, b string) float64 {
	la, ok1 := luminance(a)
	lb, ok2 := luminance(b)
	if !ok1 || !ok2 {
		return 1
	}
	if la < lb {
		la, lb = lb, la
	}
	return (la + 0.05) / (lb + 0.05)
}

func luminance(hex string) (float64, bool) {
	if !hexColor.MatchString(hex) {
		return 0, false
	}
	var l float64
	for i, w := range []float64{0.2126, 0.7152, 0.0722} {
		n, _ := strconv.ParseUint(hex[1+2*i:3+2*i], 16, 8)
		c := float64(n) / 255
		if c <= 0.03928 {
			c /= 12.92
		} else {
			c = math.Pow((c+0.055)/1.055, 2.4)
		}
		l += w * c
	}
	return l, true
}

// VisualOn reads HARNESS_VISUAL: unset or "1" is on; "0", "off" or "false" turns the visual stage off.
func VisualOn(v string) bool {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "0", "off", "false":
		return false
	}
	return true
}
