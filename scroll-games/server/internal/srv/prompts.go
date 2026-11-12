package srv

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// ---- Brief ----------------------------------------------------------------

var briefSystem = briefSystemBase + genreMenu()

const briefSystemBase = `You turn a creator's idea into a brief for a short mini-game (a photo quiz by default, or another game type). Reply with JSON only, following the schema.
intent: one sentence (<=140 chars). audience: who plays, 2-4 words. mood: one word (playful|calm|intense|cozy|mysterious). energy 1-5. competition: solo|versus|daily (versus when friends compete).
limits.rounds 3-10 (at most the number of photos when photos are given); limits.duration_s is the total play time, about 8-15 seconds per round.
title_idea <=5 words. glue_ideas: 1-2 short plain-language rule twists a script can implement (e.g. "final round is worth double", "a 3-streak adds a 50 point bonus", "a wrong answer costs 25 points").
palette: sunset|ocean|forest|midnight|candy|mono. emoji: one. tone: 2-3 words. difficulty: easy|medium|hard. Be concise.
The game type is chosen from the words of intent and title_idea, so name it plainly in the intent (e.g. "A memory match game about our trip"). Use a quiz unless the creator asks for another type.`

// genreMenu lists the playable game types for the brief writer.
func genreMenu() string {
	var sb strings.Builder
	sb.WriteString("\nGame types you can name in the intent: ")
	for i, g := range genres {
		if i > 0 {
			sb.WriteString("; ")
		}
		sb.WriteString(strings.ReplaceAll(g.Name, "_", " ") + " (" + g.Blurb + ")")
	}
	return sb.String() + "."
}

// fallbackBriefSchema is used only when spec/brief.schema.json is unreadable.
const fallbackBriefSchema = `{"type":"object","required":["intent","audience","mood","energy","competition"],"properties":{
"intent":{"type":"string"},"audience":{"type":"string"},"mood":{"type":"string"},"energy":{"type":"integer","minimum":1,"maximum":5},
"competition":{"enum":["solo","versus","daily"]},"limits":{"type":"object","properties":{"duration_s":{"type":"integer"},"rounds":{"type":"integer"}}},
"title_idea":{"type":"string"},"glue_ideas":{"type":"array","items":{"type":"string"}}}}`

// serverFilledBriefKeys are brief fields the server sets itself; the model is not asked for them.
var serverFilledBriefKeys = []string{"template", "level", "content_source"}

// LoadBriefSchema reads spec/brief.schema.json and strips what the model must not produce.
func LoadBriefSchema(specDir string) map[string]any {
	raw, err := os.ReadFile(filepath.Join(specDir, "brief.schema.json"))
	var schema map[string]any
	if err != nil || json.Unmarshal(raw, &schema) != nil {
		_ = json.Unmarshal([]byte(fallbackBriefSchema), &schema)
	}
	for _, k := range []string{"$schema", "$id", "title"} {
		delete(schema, k)
	}
	props, _ := schema["properties"].(map[string]any)
	for _, k := range serverFilledBriefKeys {
		delete(props, k)
	}
	if req, ok := schema["required"].([]any); ok {
		kept := []any{}
		for _, r := range req {
			s, _ := r.(string)
			if _, isProp := props[s]; isProp {
				kept = append(kept, r)
			}
		}
		schema["required"] = kept
	}
	return schema
}

// ---- Plan -----------------------------------------------------------------

const planRules = `You are the game planner for Scroll Games, a runtime that plays tiny mini-games from a JSON manifest. Reply with ONE sg.manifest/1 JSON object and nothing else.

SHAPE: {"schema":"sg.manifest/1","title","description","level","template":"quiz","seed_scope","concepts":[{"id","params":{}}],"glue":[{"id","on":[events],"script"}],"theme":{"palette","mood","emoji"}}

HARD RULES (a validator rejects the manifest otherwise; follow them exactly)
1. Start from the EXAMPLE manifest: keep every concept it lists (flow.session is mandatory) and change only params, title, description, seed_scope, theme and glue. Use the brief's title_idea verbatim as title. Use ids from the CATALOG only. Never add stub or invented concepts, and do not add concepts unless the brief truly needs one.
2. Params: only names listed in the catalog, with the right type and inside the stated range or enum. Unknown params or out-of-range values are errors. Omit a param to keep its default.
3. Wiring: every event a concept CONSUMES must be built in (session.*, tick, input.raw, input.tap) or EMITTED by another concept in the manifest. Every REQUIRES id must also be in the manifest. Adding or removing a concept can break this, so keep the example list.
4. Set flow.rounds.rounds to the brief's rounds and rule.round_timer.round_ms to the brief's round_ms. theme.palette is one of sunset|ocean|forest|midnight|candy|mono and theme.mood one of playful|calm|intense|cozy|mysterious; use the same values in feel.theme params. seed_scope is per_challenge unless the brief says daily.
5. glue: 1-2 entries that implement the brief's glue_ideas. Each has a unique id, "on" listing events it handles (built-in or concept events such as round.started, round.ended, answer.correct, answer.wrong, timer.expired, score.changed, streak.changed, game.over, or glue.*), and a Rhai script that defines fn on_event(ev). ev.name is the event name and ev.data its fields. Glue runs after the concepts for each event.
` + glueRules + `
Every script is dry-run for all its events in round 1 of 8 and round 8 of 8, so it must not throw there.`

// glueRules is the script API shared by the quiz and genre planners.
const glueRules = `   Script variables are plain variables you read and assign directly: score, streak, multiplier (numbers) and banner (string shown to the player, cleared every round) are writable (assigning score or streak announces score.changed or streak.changed); round, total_rounds, round_points (points earned this round) and time_left_ms are read-only.
   Also: emit("glue.name", #{k: v}) (names start with glue. or feedback.), rand_int(lo, hi), log(msg), and get("k") / set("k", v) for custom state (get returns () when never set, so guard it: let n = get("k"); if n == () { n = 0; }). Prefer the plain variables and no custom state.
   Rhai: let, if / else if / else (no ternary), maps #{a: 1}, double-quoted strings, no eval, imports or unbounded loops; keep scripts short (50000 operations).
   Correct example: fn on_event(ev) { if ev.name == "streak.changed" && streak >= 3 { score += 50; banner = "Streak bonus!"; } }
   Event fields in ev.data are not guaranteed; branch on ev.name.`

func planSystem(catalog string, example []byte) string {
	var sb strings.Builder
	sb.WriteString(planRules)
	if catalog != "" {
		sb.WriteString("\n\nCATALOG (implemented concepts only):\n")
		sb.WriteString(catalog)
	}
	sb.WriteString("\n\nEXAMPLE (a valid manifest for the brief's game type; the quiz one has a glue entry that doubles the final round):\n")
	var compact json.RawMessage
	if json.Valid(example) {
		if b, err := json.Marshal(json.RawMessage(example)); err == nil {
			compact = b
		}
	}
	if compact == nil {
		compact = example
	}
	sb.Write(compact)
	return sb.String()
}

func manifestSchema() map[string]any {
	str := map[string]any{"type": "string"}
	return map[string]any{"type": "object", "properties": map[string]any{
		"schema": str, "title": str, "description": str, "level": str, "template": str, "seed_scope": str,
		"concepts": map[string]any{"type": "array", "items": map[string]any{"type": "object", "properties": map[string]any{
			"id": str, "params": map[string]any{"type": "object"}}, "required": []string{"id"}}},
		"glue": map[string]any{"type": "array", "items": map[string]any{"type": "object", "properties": map[string]any{
			"id": str, "on": map[string]any{"type": "array", "items": str}, "script": str}, "required": []string{"id", "on", "script"}}},
		"theme": map[string]any{"type": "object"},
	}, "required": []string{"schema", "title", "concepts", "glue", "theme"}}
}

// planUser is the compact brief the planner sees.
func planUser(b Brief) string {
	out, _ := json.Marshal(map[string]any{
		"intent": b.Intent, "audience": b.Audience, "mood": b.Mood, "energy": b.Energy, "competition": b.Competition,
		"title_idea": b.TitleIdea, "glue_ideas": b.GlueIdeas, "tone": b.Tone, "difficulty": b.Difficulty,
		"palette": b.ThemePalette(), "emoji": b.Emoji, "level": b.Level, "rounds": b.Limits.Rounds, "round_ms": b.RoundMS(),
		"seed_scope": b.SeedScope(),
	})
	return "BRIEF:\n" + string(out)
}

// ---- Content --------------------------------------------------------------

const contentSystem = `You write quiz content for a short mini-game. Output ONE JSON object only: {"items":[{"prompt","media_id","choices":[4 strings],"answer":0-3,"clue"}],"copy":{"intro","win","lose"}}.
Rules: exactly the requested number of questions; each has exactly 4 distinct short choices and one correct answer, vary the correct index; a photo question uses media_id from the given list (each photo at most once) and asks about what the caption shows; extra questions use media_id "" and the brief's theme; clue is a short hint; copy lines are short and match the tone.`

func contentSchema() map[string]any {
	str := map[string]any{"type": "string"}
	return map[string]any{"type": "object", "properties": map[string]any{
		"items": map[string]any{"type": "array", "items": map[string]any{"type": "object", "properties": map[string]any{
			"prompt": str, "media_id": str, "choices": map[string]any{"type": "array", "items": str},
			"answer": map[string]any{"type": "integer"}, "clue": str}, "required": []string{"prompt", "choices", "answer", "clue"}}},
		"copy": map[string]any{"type": "object", "properties": map[string]any{"intro": str, "win": str, "lose": str}},
	}, "required": []string{"items", "copy"}}
}

// ---- Genre plan ------------------------------------------------------------
//
// A non-quiz genre starts from its pre-baked template. The planner only returns what it changes
// (description, params per concept, glue); the server merges that into the template, so the
// concept list, wiring and theme can never go wrong and the answer stays short.

const genrePlanRules = `You tune a ready-made mini-game for Scroll Games. Reply with ONE JSON object: {"description": string of at most 90 chars, "params": {"<concept id>": {"<param>": value}}, "glue": [{"id","on":[events],"script"}]}.
params: only concepts and params listed under CONCEPTS (NOW shows the current values), with the right type and inside the stated range or enum. List only the params you change so the game fits the brief's difficulty, energy and idea; leave the rest out.
glue: 1-2 entries that implement the brief's glue_ideas. Each has a unique id, "on" listing events from EVENTS only, and a Rhai script that defines fn on_event(ev). ev.name is the event name. Glue runs after the concepts for each event.
` + glueRules + `
Every script is dry-run once per listed event, so it must not throw.`

// serverSetConcepts are concepts whose params the server fills from the brief (the planner must not touch them).
var serverSetConcepts = map[string]bool{"feel.theme": true, "share.score_card": true}

// genrePlanSystem builds the compact planner prompt for a genre from its customized template manifest.
func genrePlanSystem(cs []concept, base map[string]any) string {
	byID := map[string]concept{}
	for _, c := range cs {
		byID[c.ID] = c
	}
	var sb strings.Builder
	sb.WriteString(genrePlanRules)
	events := map[string]bool{}
	var lines []string
	concepts, _ := base["concepts"].([]any)
	for _, raw := range concepts {
		cm, _ := raw.(map[string]any)
		id, _ := cm["id"].(string)
		c, ok := byID[id]
		if !ok || c.Status != "implemented" {
			continue
		}
		for _, e := range c.Emits {
			events[e] = true
		}
		if serverSetConcepts[id] || len(c.Params) == 0 {
			continue
		}
		line := conceptLine(c, false)
		if now, err := json.Marshal(cm["params"]); err == nil && string(now) != "{}" && string(now) != "null" {
			line += " NOW " + string(now)
		}
		lines = append(lines, line)
	}
	sb.WriteString("\n\nCONCEPTS:\n" + strings.Join(lines, "\n"))
	names := make([]string, 0, len(events))
	for e := range events {
		names = append(names, e)
	}
	sort.Strings(names)
	sb.WriteString("\n\nEVENTS: session.started, session.ended, tick, " + strings.Join(names, ", "))
	if glue, _ := base["glue"].([]any); len(glue) > 0 {
		if g, err := json.Marshal(glue[0]); err == nil {
			sb.WriteString("\n\nCURRENT GLUE (replace it with your own): " + string(g))
		}
	}
	return sb.String()
}

func genrePlanSchema() map[string]any {
	str := map[string]any{"type": "string"}
	return map[string]any{"type": "object", "properties": map[string]any{
		"description": str,
		"params":      map[string]any{"type": "object"},
		"glue": map[string]any{"type": "array", "items": map[string]any{"type": "object", "properties": map[string]any{
			"id": str, "on": map[string]any{"type": "array", "items": str}, "script": str}, "required": []string{"id", "on", "script"}}},
	}, "required": []string{"description", "params", "glue"}}
}

// genrePlanUser is the brief fields that matter for tuning a genre template.
func genrePlanUser(b Brief) string {
	out, _ := json.Marshal(map[string]any{
		"genre": b.Genre(), "intent": b.Intent, "title": b.TitleIdea, "difficulty": b.Difficulty, "energy": b.Energy,
		"mood": b.Mood, "tone": b.Tone, "glue_ideas": b.GlueIdeas,
	})
	return "BRIEF:\n" + string(out)
}
