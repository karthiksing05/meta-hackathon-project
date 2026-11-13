package recs

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"strings"
	"sync"
	"testing"
)

// The golden file is a fixed sequence of calls made by Node (testdata/gen_golden.mjs). Replaying the
// same calls inside goja must give the same answers: the same picks in the same order and numbers
// that agree to rounding. That is what shows the embedded engine runs Kevin's file faithfully.
func TestGoldenAgainstNode(t *testing.T) {
	raw, err := os.ReadFile("testdata/golden.json")
	if err != nil {
		t.Fatal(err)
	}
	var g struct {
		Version string `json:"version"`
		Steps   []struct {
			Method string          `json:"method"`
			Input  json.RawMessage `json:"input"`
			Output json.RawMessage `json:"output"`
		} `json:"steps"`
	}
	if err := json.Unmarshal(raw, &g); err != nil {
		t.Fatal(err)
	}
	e, err := New(Options{Runtimes: 1})
	if err != nil {
		t.Fatal(err)
	}
	if e.Version() != g.Version {
		t.Fatalf("game-recs.js is version %q, the golden file is %q: regenerate it with testdata/gen_golden.mjs", e.Version(), g.Version)
	}
	_, err = e.Run(context.Background(), "", func(s *Session) error {
		for i, st := range g.Steps {
			if st.Method == "load" {
				continue // Run already loaded a new person
			}
			var out []byte
			var err error
			switch st.Method {
			case "rank":
				out, err = s.Rank(st.Input)
			case "observe":
				out, err = s.Observe(st.Input)
			case "signal":
				out, err = s.Signal(st.Input)
			case "groupBlend":
				out, err = s.GroupBlend(st.Input)
			case "profile":
				out, err = s.Profile()
			case "debugSummary":
				out, err = s.DebugSummary()
			default:
				t.Fatalf("unknown step %q", st.Method)
			}
			if err != nil {
				t.Fatalf("step %d %s: %v", i, st.Method, err)
			}
			var want, got any
			json.Unmarshal(st.Output, &want)
			if err := json.Unmarshal(out, &got); err != nil {
				t.Fatalf("step %d %s: not JSON: %v", i, st.Method, err)
			}
			if d := diff("", want, got); d != "" {
				t.Errorf("step %d (%s) differs from Node: %s", i, st.Method, d)
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

// diff compares two decoded JSON values: strings, bools and structure exactly, numbers to 1e-9 relative.
func diff(path string, want, got any) string {
	switch w := want.(type) {
	case map[string]any:
		g, ok := got.(map[string]any)
		if !ok {
			return path + ": want an object"
		}
		for k, wv := range w {
			gv, ok := g[k]
			if !ok {
				return path + "." + k + ": missing"
			}
			if d := diff(path+"."+k, wv, gv); d != "" {
				return d
			}
		}
		for k := range g {
			if _, ok := w[k]; !ok {
				return path + "." + k + ": unexpected"
			}
		}
	case []any:
		g, ok := got.([]any)
		if !ok || len(g) != len(w) {
			return fmt.Sprintf("%s: want %d items, got %v", path, len(w), got)
		}
		for i := range w {
			if d := diff(fmt.Sprintf("%s[%d]", path, i), w[i], g[i]); d != "" {
				return d
			}
		}
	case float64:
		g, ok := got.(float64)
		if !ok {
			return path + ": want a number"
		}
		if math.Abs(g-w) > 1e-9*math.Max(1, math.Abs(w)) {
			return fmt.Sprintf("%s: want %v, got %v", path, w, g)
		}
	default:
		if fmt.Sprint(want) != fmt.Sprint(got) {
			return fmt.Sprintf("%s: want %v, got %v", path, want, got)
		}
	}
	return ""
}

func summary(id, formula string, mood ...string) map[string]any {
	return map[string]any{"id": id, "formula": formula, "mood": mood, "energy": "medium", "competition": "light",
		"look": "paper", "scope": "everyone", "isDaily": false, "bots": []any{}, "creatorID": "u0", "groupID": nil}
}

func rankInput(summaries []map[string]any, feed []string, count int, seed uint32) []byte {
	cands := make([]map[string]any, len(summaries))
	for i, s := range summaries {
		cands[i] = map[string]any{"gameID": s["id"], "reason": "popular", "runUserID": nil, "weight": 1.0}
	}
	b, _ := json.Marshal(map[string]any{"candidates": cands, "summaries": summaries, "feed": feed, "count": count, "seed": seed, "day": 20800, "now": 1794000000000})
	return b
}

func picksOf(t *testing.T, out []byte) []string {
	t.Helper()
	var r struct {
		Picks []struct {
			GameID string `json:"gameID"`
		} `json:"picks"`
	}
	if err := json.Unmarshal(out, &r); err != nil {
		t.Fatal(err)
	}
	ids := make([]string, len(r.Picks))
	for i, p := range r.Picks {
		ids[i] = p.GameID
	}
	return ids
}

// A person who finishes, replays and saves one game and skips another is shown the first more and
// the second less, and the state survives a round trip through the database form (a string).
func TestLearnsFromWhatHappens(t *testing.T) {
	e, err := New(Options{Runtimes: 2})
	if err != nil {
		t.Fatal(err)
	}
	var games []map[string]any
	for i, f := range []string{"dodge", "time", "merge", "guess", "group", "answer", "make", "dodge"} {
		games = append(games, summary(fmt.Sprintf("g%d", i), f, []string{"calm", "playful", "hype"}[i%3]))
	}
	state := ""
	love := func(id string) []byte {
		b, _ := json.Marshal(map[string]any{"id": id, "dwellSec": 20, "tookOver": true, "runsFinished": 2, "replays": 2, "saved": true, "floated": true, "day": 20800,
			"social": []string{}, "with": []string{}})
		return b
	}
	hate := func(id string) []byte {
		b, _ := json.Marshal(map[string]any{"id": id, "dwellSec": 0.5, "tookOver": false, "quitMidRun": false, "day": 20800, "social": []string{}, "with": []string{}})
		return b
	}
	for round := 0; round < 12; round++ {
		state, err = e.Run(context.Background(), state, func(s *Session) error {
			list, _ := json.Marshal(games)
			if err := s.Describe(list); err != nil {
				return err
			}
			if _, err := s.Observe(love("g2")); err != nil {
				return err
			}
			_, err := s.Observe(hate("g5"))
			return err
		})
		if err != nil {
			t.Fatal(err)
		}
	}
	if !strings.Contains(state, `"g2"`) {
		t.Fatalf("the saved state doesn't mention the game it learned from: %.200s", state)
	}
	pos := map[string]int{}
	for seed := uint32(1); seed <= 15; seed++ {
		_, err = e.Run(context.Background(), state, func(s *Session) error {
			out, err := s.Rank(rankInput(games, nil, 8, seed))
			for i, id := range picksOf(t, out) {
				pos[id] += i
			}
			return err
		})
		if err != nil {
			t.Fatal(err)
		}
	}
	if pos["g2"] >= pos["g5"] {
		t.Fatalf("the loved game should rank ahead of the skipped one on average: g2 %d vs g5 %d (lower is earlier)", pos["g2"], pos["g5"])
	}
}

// The same state and seed give the same ranking, and a new person starts without errors.
func TestDeterministicAndNewPerson(t *testing.T) {
	e, err := New(Options{Runtimes: 1})
	if err != nil {
		t.Fatal(err)
	}
	games := []map[string]any{summary("a", "dodge", "calm"), summary("b", "guess", "playful"), summary("c", "make", "hype"), summary("d", "merge", "calm")}
	var first []string
	for i := 0; i < 2; i++ {
		_, err := e.Run(context.Background(), "", func(s *Session) error {
			out, err := s.Rank(rankInput(games, nil, 4, 7))
			ids := picksOf(t, out)
			if len(ids) != 4 {
				t.Fatalf("want 4 picks, got %v", ids)
			}
			if first == nil {
				first = ids
			} else if strings.Join(first, ",") != strings.Join(ids, ",") {
				t.Fatalf("not deterministic: %v vs %v", first, ids)
			}
			return err
		})
		if err != nil {
			t.Fatal(err)
		}
	}
}

// A damaged saved state starts a fresh person instead of failing, and concurrent use is safe.
func TestBadStateAndConcurrency(t *testing.T) {
	e, err := New(Options{Runtimes: 2})
	if err != nil {
		t.Fatal(err)
	}
	games := []map[string]any{summary("a", "dodge", "calm"), summary("b", "guess", "playful")}
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			state := "not json"
			if i%2 == 0 {
				state = ""
			}
			_, err := e.Run(context.Background(), state, func(s *Session) error {
				out, err := s.Rank(rankInput(games, nil, 2, uint32(i)))
				if ids := picksOf(t, out); len(ids) != 2 {
					t.Errorf("picks: %v", ids)
				}
				return err
			})
			if err != nil {
				t.Error(err)
			}
		}(i)
	}
	wg.Wait()
}
