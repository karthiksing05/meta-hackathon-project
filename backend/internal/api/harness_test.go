package api_test

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/http/httputil"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/karthiksing05/meta-hackathon-project/backend/internal/api"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/auth"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/harness"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/pkgstore"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/store"
)

// A tiny catalog for the harness: one rare-answer trivia type and its tools.
func harnessCatalog() harness.Catalog {
	return harness.Catalog{
		Types: []harness.GameType{{
			ID: "rare_answer_trivia", Name: "Rare-answer trivia", Aliases: []string{"Krillion"}, Family: "trivia",
			Summary:  "Type one correct answer; rarer correct answers score more.",
			CoreLoop: "read a prompt, type an answer, see its rarity tier", Verbs: []string{"type", "recall"}, Inputs: []string{"type"},
			Rules: []string{"rarer answers score more"}, Win: "best total", Scoring: "tiered points per answer",
			Players: []string{"solo"}, Tools: []string{"typed_answer", "timer_bar"}, GateProfile: "trivia",
			ExamplePrompts: []string{"a harry potter krillion", "obscure answers win", "name the rarest"}, Status: "seed", Source: "seed",
		}},
		Tools: []harness.GameTool{
			{ID: "typed_answer", Kind: "fragment", Summary: "A typed answer checked against a list.", WhenToUse: "typed answers", Status: "shipped"},
			{ID: "timer_bar", Kind: "fragment", Summary: "A bar that ends the round.", WhenToUse: "timed rounds", Status: "shipped"},
		},
	}
}

const fakePlan = `{"anatomy": {"anatomy": "game-anatomy/0.1", "title": "Rarest Spell", "genre": "word", "parts": {"core_loop": {"text": "type", "plan": "fragment:typed_answer", "familiarity": "known"}}},
 "spec": {"spec": "game-spec/1", "theme": {"world": "wizard school", "named": ["Harry Potter"], "tone": "cozy", "look": "gold"},
  "goal": {"text": "name rare spells", "target": "the rarest answer in 5 prompts", "measure": "rarity points"},
  "loop": {"verb": "type", "sees": "a prompt", "input": "type", "feedback": "a tier", "cycle_seconds": 10},
  "pieces": {"items": [{"name": "prompt", "role": "category", "count": 5}]},
  "constraints": {"items": [{"kind": "time", "value": "10 s", "enforced_by": "timer", "hud": "bar"}]},
  "progression": {"steps": [{"at": "1", "change": "a"}, {"at": "2", "change": "b"}, {"at": "3", "change": "c"}], "levers": ["timer"]},
  "end": {"win": "best total", "lose": "", "ends_when": ["all_prompts_done"], "session_seconds": [60, 120]},
  "score": {"kind": "tiered_points", "measures": "rarity points", "unit": "points", "direction": "higher", "counts_when": "any", "aggregate": "best", "tie_break": "less time", "format": "{n} points", "events": ["scored"]},
  "social": {"share": "I scored 300", "challenge": "same prompts", "same_seed": true, "board": "highest first"},
  "feel": {"juice": ["gold burst"], "sounds": "chimes", "look": "gold"}},
 "design": {"pitch": "Name the rarest spell.", "theme": ["Harry Potter"], "verb": "type", "twist": "rarity", "arc": ["a"]},
 "type_ids": ["rare_answer_trivia"], "tool_ids": ["typed_answer"], "gaps": [], "clarify": []}`

// harnessGenerator is the fake generator plus /internal/muse/json answering as Muse would.
type harnessGenerator struct {
	*httptest.Server
	gen       *fakeGenerator
	mu        sync.Mutex
	museCalls []string // the model of each call
	museFail  bool
}

func newHarnessGenerator(t *testing.T) *harnessGenerator {
	h := &harnessGenerator{gen: newFakeGenerator(t)}
	target, _ := url.Parse(h.gen.URL)
	proxy := httputil.NewSingleHostReverseProxy(target)
	h.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/internal/muse/json" {
			proxy.ServeHTTP(w, r)
			return
		}
		var in struct{ Model, System, User string }
		b, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(b, &in)
		h.mu.Lock()
		h.museCalls = append(h.museCalls, in.Model)
		fail := h.museFail
		h.mu.Unlock()
		if fail {
			w.WriteHeader(502)
			io.WriteString(w, `{"error":"muse_failed"}`)
			return
		}
		content := `{"named_refs":["Krillion"],"verbs":["type"],"inputs":["type"],"families":["trivia"],"theme":["Harry Potter"],"keywords":["rare answer"],"players":"solo","unknown_refs":[]}`
		if in.Model == harness.ModelWonder {
			content = fakePlan
		}
		json.NewEncoder(w).Encode(map[string]string{"content": content, "model": in.Model})
	}))
	t.Cleanup(h.Close)
	return h
}

func serverWithHarness(t *testing.T, genURL string, on bool) *httptest.Server {
	t.Helper()
	h, err := harness.New(context.Background(), harness.Config{
		Source:       harness.MemorySource{Catalog: harnessCatalog()},
		Understander: harness.MuseUnderstander{Muse: harness.UnderstandMuse(genURL)},
	})
	if err != nil {
		t.Fatal(err)
	}
	pk, err := pkgstore.NewLocal(t.TempDir(), pkgstore.Limits{MaxUploadBytes: 5 << 20, MaxUnpackedBytes: 10 << 20, MaxFileBytes: 5 << 20})
	if err != nil {
		t.Fatal(err)
	}
	s := api.New(api.Options{
		Store: store.NewMemory(), Packages: pk, Signer: auth.NewSigner([]byte(strings.Repeat("k", 32)), time.Minute),
		RefreshTTL: time.Hour, GamesBaseURL: "https://games.example.com", MaxUploadMB: 5,
		GeneratorURL: genURL, GenerateConcurrent: 2, GeneratePerHour: 6,
		HarnessContext: on, Harness: h, Planner: &harness.Planner{Muse: harness.PlanMuse(genURL)},
	})
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)
	return ts
}

func composeBody(t *testing.T, g *fakeGenerator) map[string]any {
	t.Helper()
	g.mu.Lock()
	defer g.mu.Unlock()
	for _, r := range g.requests {
		var m map[string]any
		if json.Unmarshal([]byte(r), &m) == nil && m["request"] != nil {
			return m
		}
	}
	t.Fatalf("no /compose request: %v", g.requests)
	return nil
}

func TestHarnessContextOnTheJob(t *testing.T) {
	hg := newHarnessGenerator(t)
	ts := serverWithHarness(t, hg.URL, true)
	tok := register(t, ts, "planner")
	code, out := startJob(t, ts, tok, map[string]any{"request": "a harry potter krillion"})
	if code != 202 {
		t.Fatalf("start: %d %v", code, out)
	}
	waitJob(t, ts, tok, out["jobId"].(string), "done")
	body := composeBody(t, hg.gen)
	c, ok := body["context"].(map[string]any)
	if !ok || c["version"] != "harness-context/1" {
		t.Fatalf("context sent to /compose: %v", body["context"])
	}
	plan := c["plan"].(map[string]any)
	spec := plan["spec"].(map[string]any)
	if spec["score"].(map[string]any)["kind"] != "tiered_points" || c["gate_profile"] != "trivia" {
		t.Errorf("plan in context: %v", plan)
	}
	if hg.museCalls[0] != harness.ModelSpark || hg.museCalls[len(hg.museCalls)-1] != harness.ModelWonder {
		t.Errorf("muse calls = %v", hg.museCalls)
	}
}

func TestHarnessOffOrFailingSendsNoContext(t *testing.T) {
	for _, tc := range []struct {
		name     string
		on, fail bool
	}{{"off", false, false}, {"muse fails", true, true}} {
		t.Run(tc.name, func(t *testing.T) {
			hg := newHarnessGenerator(t)
			hg.museFail = tc.fail
			ts := serverWithHarness(t, hg.URL, tc.on)
			tok := register(t, ts, "maker")
			_, out := startJob(t, ts, tok, map[string]any{"request": "a harry potter krillion"})
			waitJob(t, ts, tok, out["jobId"].(string), "done")
			if body := composeBody(t, hg.gen); body["context"] != nil {
				t.Errorf("context sent: %v", body["context"])
			}
			if !tc.on && len(hg.museCalls) != 0 {
				t.Errorf("harness off made Muse calls: %v", hg.museCalls)
			}
		})
	}
}

func TestHarnessPlanEndpoint(t *testing.T) {
	hg := newHarnessGenerator(t)
	ts := serverWithHarness(t, hg.URL, true)
	tok := register(t, ts, "asker")
	code, out := do(t, "POST", ts.URL+"/v1/harness/plan", tok, js(map[string]any{"request": "a harry potter krillion"}), "application/json")
	if code != 200 || out["plan"] == nil || out["spec"] == nil || out["clarify"] == nil || out["types"] == nil {
		t.Fatalf("plan: %d %v", code, out)
	}
	if code, _ := do(t, "POST", ts.URL+"/v1/harness/plan", "", js(map[string]any{"request": "x"}), "application/json"); code != 401 {
		t.Errorf("signed out: %d", code)
	}
	if code, _ := do(t, "POST", ts.URL+"/v1/harness/plan", tok, js(map[string]any{"request": ""}), "application/json"); code != 400 {
		t.Errorf("empty request: %d", code)
	}
	off := serverWithHarness(t, hg.URL, false)
	tok2 := register(t, off, "asker2")
	if code, _ := do(t, "POST", off.URL+"/v1/harness/plan", tok2, js(map[string]any{"request": "x"}), "application/json"); code != 404 {
		t.Errorf("flag off: %d", code)
	}
}
