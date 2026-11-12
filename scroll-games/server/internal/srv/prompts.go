package srv

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
)

// ---- Brief ----------------------------------------------------------------

const briefSystem = `You turn a creator's idea into a brief for a short photo-quiz mini-game. Reply with JSON only, following the schema.
intent: one sentence (<=140 chars). audience: who plays, 2-4 words. mood: one word (playful|calm|intense|cozy|mysterious). energy 1-5. competition: solo|versus|daily (versus when friends compete).
limits.rounds 3-10 (at most the number of photos when photos are given); limits.duration_s is the total play time, about 8-15 seconds per round.
title_idea <=5 words. glue_ideas: 1-2 short plain-language rule twists a script can implement (e.g. "final round is worth double", "a 3-streak adds a 50 point bonus", "a wrong answer costs 25 points").
palette: sunset|ocean|forest|midnight|candy|mono. emoji: one. tone: 2-3 words. difficulty: easy|medium|hard. Be concise.`

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
5. glue: 1-2 entries that implement the brief's glue_ideas. Each has a unique id, "on" listing events it handles (built-in or concept events such as round.started, round.ended, answer.correct, answer.wrong, timer.expired, score.changed, streak.changed, game.over, or glue.* ), and a Rhai script that defines fn on_event(ev). ev is a map: ev.name, ev.data. Glue runs after the concepts for each event.
   Script API: get(key), set(key, value), emit(name, #{...}) with names starting glue. or feedback. only, rand_int(lo, hi), log(msg).
   Reserved vars: score and streak (settable; setting them announces score.changed/streak.changed), multiplier (settable), banner (string shown to the player, cleared every round), round_points (read-only: points earned this round, available in answer.correct), round, total_rounds, time_left_ms (read-only, never set them).
   get() of a var that was never set returns () and arithmetic on it is an error: guard custom vars, e.g. let n = get("bonus"); if n == () { n = 0; }. Prefer reserved vars and no custom state.
   Rhai: let, if/else (no elif, no ternary), maps #{a: 1}, strings in double quotes, no eval or imports, no loops over unbounded ranges; keep scripts short (limit 50000 operations). Every script is dry-run for all its events in round 1 of 8 and round 8 of 8, so it must not throw there.`

func planSystem(catalog string, example []byte) string {
	var sb strings.Builder
	sb.WriteString(planRules)
	if catalog != "" {
		sb.WriteString("\n\nCATALOG (implemented concepts only):\n")
		sb.WriteString(catalog)
	}
	sb.WriteString("\n\nEXAMPLE (a valid quiz manifest, with a glue entry that doubles the final round):\n")
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
