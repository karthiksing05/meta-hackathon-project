package harness

import (
	"context"
	"encoding/json"
	"math"
	"reflect"
	"strings"
	"sync"
	"testing"
)

func TestFold(t *testing.T) {
	cases := map[string]string{
		"Pokémon-style!":        "pokemon style",
		"Don't  STOP":           "dont stop",
		"  Crème brûlée  ":      "creme brulee",
		"Subway_Surfers 2.0":    "subway surfers 2 0",
		"straße":                "strasse",
		"":                      "",
		"krillion.io":           "krillion io",
		"rock, paper; scissors": "rock paper scissors",
	}
	for in, want := range cases {
		if got := Fold(in); got != want {
			t.Errorf("Fold(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestStemMeets(t *testing.T) {
	groups := [][]string{
		{"match", "matches", "matching", "matched"},
		{"race", "races", "racing", "raced"},
		{"puzzle", "puzzles"},
		{"tile", "tiles"},
		{"category", "categories"},
		{"speed", "speeding"},
		{"run", "running"},
	}
	for _, g := range groups {
		want := Stem(g[0])
		for _, w := range g[1:] {
			if got := Stem(w); got != want {
				t.Errorf("Stem(%q) = %q, Stem(%q) = %q; want them equal", w, got, g[0], want)
			}
		}
	}
	for _, w := range []string{"bus", "glass", "chess", "string", "is"} {
		if got := Stem(w); got == "" {
			t.Errorf("Stem(%q) is empty", w)
		}
	}
	if Stem("string") == Stem("str") && Stem("string") != "string" {
		t.Errorf("Stem(string) collapsed to %q", Stem("string"))
	}
}

func TestTokens(t *testing.T) {
	got := Tokens("Make a Harry Potter Krillion game, please!")
	want := []string{"harry", "potter", "krillion"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("Tokens = %v, want %v", got, want)
	}
	tb := TermsWithBigrams("subway surfers")
	if !reflect.DeepEqual(tb, []string{"subway", "surfer", "subway_surfer"}) {
		t.Fatalf("TermsWithBigrams = %v", tb)
	}
}

func TestTrigramDice(t *testing.T) {
	a, b := Trigrams("krillion"), Trigrams("krilion")
	if d := Dice(a, b); d < 0.75 {
		t.Errorf("krillion vs krilion dice = %.2f, want ≥ 0.75", d)
	}
	if r := editRatio("wordle", "wordel"); r < 0.8 {
		t.Errorf("wordle vs wordel edit ratio = %.2f", r)
	}
	if r := editRatio("pong", "ping"); r != 0 {
		t.Errorf("short names should not get an edit ratio, got %.2f", r)
	}
	if d := Dice(Trigrams("krillion"), Trigrams("tetris")); d > 0.2 {
		t.Errorf("unrelated dice = %.2f", d)
	}
	if d := Dice(Trigrams("abc"), Trigrams("abc")); d != 1 {
		t.Errorf("identical dice = %.2f", d)
	}
	if Dice(nil, Trigrams("x")) != 0 {
		t.Error("empty set dice should be 0")
	}
}

func TestBM25FFieldWeightsAndIDF(t *testing.T) {
	fields := []fieldSpec{{"name", 3}, {"summary", 1}}
	ix := newBM25F(fields, [][]string{
		{"lane runner", "dodge things"},       // 0: term in name
		{"tilt maze", "a runner of sorts"},    // 1: term in summary
		{"word search", "find words in grid"}, // 2: no term
	})
	hits := ix.search([]weightedTerm{{"runner", 1}})
	if len(hits) != 2 || hits[0].doc != 0 || hits[1].doc != 1 {
		t.Fatalf("hits = %+v, want doc 0 (name) above doc 1 (summary)", hits)
	}
	if hits[0].score <= hits[1].score {
		t.Fatalf("name hit %.3f should beat summary hit %.3f", hits[0].score, hits[1].score)
	}
	// rarer terms weigh more
	if ix.idf("maze") <= ix.idf("nonexistent")-10 || ix.idf("maze") <= 0 {
		t.Fatalf("idf(maze) = %.3f", ix.idf("maze"))
	}
	// saturation: tf grows sub-linearly
	ix2 := newBM25F(fields, [][]string{{"x", "jump"}, {"x", "jump jump jump jump"}, {"x", "other"}})
	h2 := ix2.search([]weightedTerm{{"jump", 1}})
	if len(h2) != 2 {
		t.Fatalf("h2 = %+v", h2)
	}
	ratio := h2[0].score / h2[1].score
	if ratio > 2.5 {
		t.Errorf("four occurrences scored %.2f× one; BM25 should saturate", ratio)
	}
}

func TestRRF(t *testing.T) {
	r := map[string]map[int]int{
		"a": {1: 1, 2: 2, 3: 3},
		"b": {2: 1, 1: 3},
	}
	out := fuse(r, map[string]float64{"a": 1, "b": 1})
	if len(out) != 3 || out[0].doc != 2 {
		t.Fatalf("fused = %+v, want doc 2 first (ranks 2 and 1)", out)
	}
	want := 1/(rrfK+2) + 1/(rrfK+1)
	if math.Abs(out[0].score-want) > 1e-12 {
		t.Fatalf("score = %v, want %v", out[0].score, want)
	}
	// ties share a rank
	rk := ranksOf([]scored{{5, 3}, {6, 3}, {7, 1}})
	if rk[5] != 1 || rk[6] != 1 || rk[7] != 3 {
		t.Fatalf("competition ranks = %v", rk)
	}
}

func testCatalog() *Catalog {
	mk := func(id, name, family string, aliases []string, summary, loop string, verbs, inputs, tools, prompts []string, gate string) GameType {
		return GameType{ID: id, Name: name, Aliases: aliases, Family: family, Summary: summary, CoreLoop: loop,
			Verbs: verbs, Inputs: inputs, Rules: []string{"one rule"}, Win: "win", Scoring: "points", Players: []string{"solo"},
			Tools: tools, GateProfile: gate, ExamplePrompts: prompts, Status: "seed", Source: "seed"}
	}
	return &Catalog{
		Types: []GameType{
			mk("rare_answer_trivia", "Rare-answer trivia", "trivia", []string{"Krillion", "Pointless-style", "rarest answer"},
				"A category prompt; type one correct answer; rarer correct answers score more.",
				"read prompt, type an answer before the timer, see its rarity tier", []string{"type", "recall", "guess"}, []string{"type"},
				[]string{"typed_answer", "fuzzy_match", "timer_bar"}, []string{"a harry potter krillion", "trivia where obscure answers win", "name the rarest pokemon"}, "trivia"),
			mk("lane_runner", "Lane runner", "runner", []string{"Subway Surfers", "Temple Run", "endless runner"},
				"Run forward through three lanes, swiping to dodge obstacles and grab coins as the speed climbs.",
				"swipe left or right to change lanes, swipe up to jump, collect coins, survive", []string{"dodge", "jump", "collect"}, []string{"swipe"},
				[]string{"lanes", "speed_ramp", "pickups", "endless"}, []string{"like subway surfers but in hogwarts", "an endless runner through a city", "dodge trains in three lanes"}, "runner"),
			mk("five_letter_deduction", "Five-letter deduction", "word", []string{"Wordle", "Lingo"},
				"Guess a hidden five-letter word in six tries with colour feedback on each letter.",
				"type a guess, read the letter colours, narrow it down", []string{"guess", "deduce", "type"}, []string{"type"},
				[]string{"keyboard", "word_check", "daily_seed"}, []string{"a wordle about cheese", "guess the five letter word", "daily word guess for my group"}, "puzzle"),
			mk("tilt_maze", "Tilt maze", "physics_toy", []string{"Labyrinth", "marble maze"},
				"Tilt the phone to roll a marble through a maze to the goal without falling into holes.",
				"tilt to roll, avoid holes, reach the goal", []string{"tilt", "steer", "balance"}, []string{"tilt"},
				[]string{"tilt_input", "physics"}, []string{"a marble maze you tilt", "roll a ball through a labyrinth", "tilt game with holes"}, "arcade"),
		},
		Tools: []GameTool{
			{ID: "fuzzy_match", Kind: "runtime_tool", Summary: "Does a typed answer match an accepted one? Tolerates typos.", WhenToUse: "any typed or open answer", Status: "building"},
			{ID: "typed_answer", Kind: "fragment", Summary: "A typed answer checked against accepted answers.", WhenToUse: "typed trivia answers", Status: "shipped"},
			{ID: "timer_bar", Kind: "fragment", Summary: "A shrinking bar that ends the round.", WhenToUse: "any timed round", Status: "shipped"},
			{ID: "lanes", Kind: "fragment", Summary: "Three lanes the player switches between.", WhenToUse: "lane runners", Status: "shipped"},
			{ID: "keyboard", Kind: "fragment", Summary: "An on-screen letter keyboard for typing.", WhenToUse: "word games with typing", Status: "shipped"},
		},
	}
}

func newTestHarness(t *testing.T, cfg Config) *Harness {
	t.Helper()
	if cfg.Source == nil {
		cfg.Source = MemorySource{Catalog: *testCatalog()}
	}
	h, err := New(context.Background(), cfg)
	if err != nil {
		t.Fatal(err)
	}
	return h
}

func TestTestCatalogValidates(t *testing.T) {
	c := testCatalog()
	for i := range c.Types {
		if err := c.Types[i].Validate(); err != nil {
			t.Error(err)
		}
	}
	for i := range c.Tools {
		if err := c.Tools[i].Validate(); err != nil {
			t.Error(err)
		}
	}
}

func TestSearchFindsByAliasTypoAndFacets(t *testing.T) {
	h := newTestHarness(t, Config{})
	ctx := context.Background()
	cases := []struct{ req, want string }{
		{"make krillion", "rare_answer_trivia"},
		{"a harry potter krilion", "rare_answer_trivia"}, // typo
		{"like subway surfers but in hogwarts", "lane_runner"},
		{"a wordel about cats", "five_letter_deduction"}, // typo
		{"roll a marble by tilting the phone", "tilt_maze"},
	}
	for _, c := range cases {
		p, err := h.Context(ctx, Request{Text: c.req})
		if err != nil {
			t.Fatal(err)
		}
		if len(p.Types) == 0 || p.Types[0].Type.ID != c.want {
			var got []string
			for _, x := range p.Types {
				got = append(got, x.Type.ID)
			}
			t.Errorf("%q → %v, want %s first", c.req, got, c.want)
			continue
		}
		if len(p.Types[0].Reasons) == 0 {
			t.Errorf("%q: no reasons", c.req)
		}
	}
}

func TestToolsUnionAndMissing(t *testing.T) {
	h := newTestHarness(t, Config{})
	p, err := h.Context(context.Background(), Request{Text: "make krillion"})
	if err != nil {
		t.Fatal(err)
	}
	byID := map[string]ToolHit{}
	for _, th := range p.Tools {
		byID[th.ID] = th
	}
	fm, ok := byID["fuzzy_match"]
	if !ok || fm.Tool == nil || !strings.HasPrefix(fm.Via[0], "type:") {
		t.Fatalf("fuzzy_match should come via the type: %+v", fm)
	}
	// lane_runner may rank lower; any missing tool must be flagged, not dropped
	for _, th := range p.Tools {
		if th.Tool == nil && !th.Missing {
			t.Errorf("%s has no tool and isn't marked missing", th.ID)
		}
	}
}

func TestSearchIsDeterministic(t *testing.T) {
	h := newTestHarness(t, Config{})
	u := Understanding{NamedRefs: []string{"Subway Surfers"}, Verbs: []string{"dodge"}, Inputs: []string{"swipe"}, Families: []string{"runner"}, Theme: []string{"Hogwarts"}}
	var first []byte
	for i := 0; i < 20; i++ {
		p, err := h.Context(context.Background(), Request{Text: "like subway surfers but in hogwarts", Understanding: &u})
		if err != nil {
			t.Fatal(err)
		}
		p.Timings = Timings{}
		b, _ := json.Marshal(p)
		if first == nil {
			first = b
		} else if string(b) != string(first) {
			t.Fatalf("run %d differs", i)
		}
	}
}

func TestConcurrentSearchAndReload(t *testing.T) {
	h := newTestHarness(t, Config{})
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			for j := 0; j < 50; j++ {
				if i == 0 && j%10 == 0 {
					if err := h.Reload(context.Background()); err != nil {
						t.Error(err)
					}
				}
				if _, err := h.Context(context.Background(), Request{Text: "a tilt maze"}); err != nil {
					t.Error(err)
				}
			}
		}(i)
	}
	wg.Wait()
}

func TestKeywordUnderstander(t *testing.T) {
	v := VocabOf(testCatalog().Types)
	k := KeywordUnderstander{}
	u, _ := k.Understand(context.Background(), "like Subway Surfers but in Hogwarts", v)
	if !reflect.DeepEqual(u.NamedRefs, []string{"Subway Surfers"}) || !reflect.DeepEqual(u.Theme, []string{"Hogwarts"}) {
		t.Fatalf("refs %v theme %v", u.NamedRefs, u.Theme)
	}
	u, _ = k.Understand(context.Background(), "make krillion", v)
	if !reflect.DeepEqual(u.NamedRefs, []string{"krillion"}) {
		t.Fatalf("make krillion refs = %v", u.NamedRefs)
	}
	u, _ = k.Understand(context.Background(), "make a word game", v)
	if len(u.NamedRefs) != 0 || !reflect.DeepEqual(u.Families, []string{"word"}) {
		t.Fatalf("generic request: refs %v families %v", u.NamedRefs, u.Families)
	}
	u, _ = k.Understand(context.Background(), "a trivia game to play with friends, check out krillion.io", v)
	if !contains(u.NamedRefs, "krillion.io") || u.Players != "async_friends" || !contains(u.Families, "trivia") {
		t.Fatalf("domain request: %+v", u)
	}
}

func contains(xs []string, x string) bool {
	for _, y := range xs {
		if y == x {
			return true
		}
	}
	return false
}

// fakeMuse answers from a function of the system prompt.
type fakeMuse struct {
	mu    sync.Mutex
	calls int
	reply func(system, user string) string
}

func (f *fakeMuse) JSON(_ context.Context, system, user string) (json.RawMessage, error) {
	f.mu.Lock()
	f.calls++
	f.mu.Unlock()
	return ExtractObject(f.reply(system, user)), nil
}

func TestMuseUnderstanderConstrainsVocab(t *testing.T) {
	m := &fakeMuse{reply: func(_, user string) string {
		if !strings.Contains(user, "families:") || !strings.Contains(user, "trivia") {
			t.Errorf("prompt lacks the vocabulary: %s", user)
		}
		return "```json\n" + `{"named_refs":["Krillion"],"verbs":["Type","juggle"],"inputs":["type","telepathy"],"families":["Trivia"],"theme":["Harry Potter"],"keywords":["rare answer"],"players":"","unknown_refs":["Krillion"]}` + "\n```"
	}}
	u, err := MuseUnderstander{Muse: m}.Understand(context.Background(), "a harry potter krillion", VocabOf(testCatalog().Types))
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(u.Verbs, []string{"type"}) || !reflect.DeepEqual(u.Inputs, []string{"type"}) || !reflect.DeepEqual(u.Families, []string{"trivia"}) || u.Players != "solo" {
		t.Fatalf("not constrained: %+v", u)
	}
}

func TestExtractObject(t *testing.T) {
	for in, ok := range map[string]bool{
		`{"a":1}`:                      true,
		"```json\n{\"a\":1}\n```":      true,
		"Sure! {\"a\": {\"b\": 2}} ok": true,
		"[1,2]":                        false,
		"nothing":                      false,
	} {
		if got := ExtractObject(in) != nil; got != ok {
			t.Errorf("ExtractObject(%q) ok = %v", in, got)
		}
	}
}

func TestPhrasesDropThemeWords(t *testing.T) {
	u := Understanding{NamedRefs: []string{"Krillion"}, Theme: []string{"Harry Potter"}}
	for _, p := range phrases("a harry potter krillion", u) {
		if p == "potter" || p == "harry" || p == "harry potter" {
			t.Errorf("theme phrase %q kept", p)
		}
	}
	if !contains(phrases("a harry potter krillion", u), "krillion") {
		t.Error("named ref dropped")
	}
}
