package srv

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestInferGenreFromBriefText(t *testing.T) {
	cases := map[string]string{
		"A quiz about our Lisbon trip":              "quiz",
		"A memory match game of our beach photos":   "memory_match",
		"Wordle but with trip words":                "word_guess",
		"an endless runner where we dodge seagulls": "lane_runner",
		"Put our trip moments on a timeline":        "timeline_sort",
		"shoot the invaders":                        "star_shooter",
		"2048 with fruit":                           "swipe_merge",
		"something fun":                             "quiz",
		"trivia night: match 3 of these":            "quiz",
		"Tap the mole critters as they pop up":      "whack_mole",
		"trace the shapes":                          "trace_draw",
		"A rhythm tap game tapping lanes":           "rhythm_tap",
		"A swipe merge game where matching numbers": "swipe_merge",
		"A daily word game guessing hidden words":   "daily_word",
	}
	for text, want := range cases {
		if got := inferGenre(text); got != want {
			t.Errorf("inferGenre(%q) = %s, want %s", text, got, want)
		}
	}
	b := Brief{Intent: "x", Template: "rhythm_tap"}
	b.Normalize("remix", nil)
	if b.Template != "rhythm_tap" {
		t.Errorf("a valid template must be kept, got %s", b.Template)
	}
	b = Brief{Intent: "A rhythm game", Template: "bogus"}
	b.Normalize("remix", nil)
	if b.Template != "rhythm_tap" {
		t.Errorf("an invalid template is inferred from the text, got %s", b.Template)
	}
}

// Every genre's fallback manifest and content must pass the real validator.
func TestGenreFallbacksValidate(t *testing.T) {
	spec := filepath.Join("..", "..", "..", "spec")
	tool := filepath.Join("..", "..", "..", "runtime", "target", "release", "sgtool")
	if _, err := os.Stat(tool); err != nil {
		t.Skip("sgtool not built")
	}
	a := testApp(t, "http://127.0.0.1:1", tool)
	a.cfg.SpecDir = spec
	media := []Media{{ID: "m1", Caption: "Sunset"}, {ID: "m2", Caption: "Dinner"}, {ID: "m3", Caption: "Tram"}, {ID: "m4", Caption: "Beach"}, {ID: "m5", Caption: "Hike"}}
	for _, g := range GenreNames() {
		for _, md := range [][]Media{nil, media} {
			b := Brief{Intent: "A game", Template: g}
			b.Normalize("remix", md)
			if b.Genre() != g {
				t.Fatalf("%s: genre %s", g, b.Genre())
			}
			m, c := a.templateManifest(b), a.templateContent(b, md)
			res, err := a.tool.Validate(m, c)
			if err != nil || !res.OK {
				t.Errorf("%s (media %d): validate err=%v res=%+v", g, len(md), err, res)
			}
			var mm map[string]any
			_ = json.Unmarshal(m, &mm)
			if mm["template"] != g {
				t.Errorf("%s: manifest template %v", g, mm["template"])
			}
		}
	}
}

func TestNormalizeGenreContent(t *testing.T) {
	words, _ := genreByName("word_guess")
	raw := `{"items":[{"prompt":"beach","clue":"sand"},{"prompt":"toolong"},{"prompt":"BEACH"},{"prompt":"tr4in"},{"prompt":"train"},{"prompt":"lemon"},{"prompt":"pizza"},{"prompt":"music"},{"prompt":"river"},{"prompt":"sunny"}],"copy":{"intro":"Go"}}`
	out, err := normalizeGenreContent(words, json.RawMessage(raw), nil)
	if err != nil {
		t.Fatal(err)
	}
	var c struct {
		Items []struct{ Kind, Prompt string } `json:"items"`
	}
	_ = json.Unmarshal(out, &c)
	if len(c.Items) != 7 || c.Items[0].Kind != "word" || c.Items[0].Prompt != "BEACH" {
		t.Fatalf("unexpected items %+v", c.Items)
	}
	if _, err := normalizeGenreContent(words, json.RawMessage(`{"items":[{"prompt":"beach"}]}`), nil); err == nil {
		t.Fatal("too few words must fail so the template content is used")
	}
	ev, _ := genreByName("timeline_sort")
	out, err = normalizeGenreContent(ev, json.RawMessage(`{"items":[{"prompt":"a","order":2},{"prompt":"b","order":1},{"prompt":"c","order":3},{"prompt":"d","order":3}]}`), nil)
	if err != nil || len(out) == 0 {
		t.Fatalf("event content: %v", err)
	}
}

func TestMergeGenrePlanKeepsTemplateStructure(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "spec", "templates", "lane_runner.manifest.json"))
	if err != nil {
		t.Skip("spec not present")
	}
	var base map[string]any
	_ = json.Unmarshal(raw, &base)
	n := len(base["concepts"].([]any))
	var plan map[string]any
	_ = json.Unmarshal([]byte(`{"description":"Dodge trams","params":{"rule.lives":{"lives":5},"feel.theme":{"palette":"mono"},"nope.x":{"a":1}},
		"glue":[{"id":"bonus","on":["entity.collected"],"script":"fn on_event(ev) { score += 25; banner = \"Yum\"; }"}]}`), &plan)
	m := mergeGenrePlan(base, plan)
	if len(m["concepts"].([]any)) != n || m["description"] != "Dodge trams" {
		t.Fatalf("structure changed: %v", m)
	}
	for _, c := range m["concepts"].([]any) {
		cm := c.(map[string]any)
		p := cm["params"].(map[string]any)
		switch cm["id"] {
		case "rule.lives":
			if p["lives"] != float64(5) {
				t.Errorf("lives not merged: %v", p)
			}
		case "feel.theme":
			if p["palette"] == "mono" {
				t.Errorf("server-set theme must not be overridden")
			}
		}
	}
	if g := m["glue"].([]any); len(g) != 1 || g[0].(map[string]any)["id"] != "bonus" {
		t.Fatalf("glue not replaced: %v", m["glue"])
	}
}

func TestGenrePlanPromptIsCompact(t *testing.T) {
	spec := filepath.Join("..", "..", "..", "spec")
	cs := loadConcepts(spec)
	if len(cs) == 0 {
		t.Skip("spec not present")
	}
	a := testApp(t, "http://127.0.0.1:1", "")
	a.cfg.SpecDir = spec
	for _, g := range GenreNames() {
		if g == "quiz" {
			continue
		}
		b := Brief{Intent: "A game", Template: g}
		b.Normalize("remix", nil)
		base, ok := a.genreBase(b)
		if !ok {
			t.Fatalf("%s: no base", g)
		}
		sys := genrePlanSystem(cs, base)
		if len(sys) > 9000 {
			t.Errorf("%s: plan prompt is %d chars", g, len(sys))
		}
		if !strings.Contains(sys, "score += 50") {
			t.Errorf("%s: prompt lacks the bare-variable example", g)
		}
	}
}

// A speculative run that ends in a fallback is still joined by the Generate that follows it.
func TestSpeculativeFallbackIsJoinedNotRerun(t *testing.T) {
	f := newFakeMuse(t)
	app := testApp(t, f.srv.URL, fakeTool(t, `{"ok":false,"errors":[{"path":"x","msg":"bad"}],"warnings":[]}`))
	app.cfg.Speculate = true
	resp := app.MakeBrief(context.Background(), BriefReq{Prompt: "a quiz about cats", MediaIDs: []string{"m1", "m2", "m3"}})
	briefJSON, _ := json.Marshal(resp.Brief)
	deadline := time.Now().Add(10 * time.Second)
	for {
		app.jobsMu.Lock()
		running := len(app.jobs)
		app.jobsMu.Unlock()
		if running == 0 || time.Now().After(deadline) {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	before := f.calls.Load()
	g, err := app.Generate(context.Background(), "u_me", GenerateReq{Brief: briefJSON}, func(Event) {})
	if err != nil {
		t.Fatal(err)
	}
	if f.calls.Load() != before || g.Gen.Source == "muse" {
		t.Fatalf("Generate re-ran the pipeline: calls %d -> %d, source %s", before, f.calls.Load(), g.Gen.Source)
	}
}
