package harness

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"testing"
)

// EvalCase is one retrieval eval case (authoring/catalog/schema/eval.schema.json).
type EvalCase struct {
	Request string   `json:"request"`
	Expect  []string `json:"expect"`
	Notes   string   `json:"notes,omitempty"`
}

// TestRetrievalEval loads the real catalog and its eval cases and reports recall@5 and MRR with the
// keyword understander (no network), overall and per eval file (one per family). It prints the numbers and
// does not fail below the target yet (docs/HARNESS_V2.md: recall@5 ≥ 0.9 before the planner uses it).
// Run with -v to see them: go test ./internal/harness -run RetrievalEval -v
func TestRetrievalEval(t *testing.T) {
	dir, ok := FindCatalogDir()
	if !ok {
		t.Skip("no catalog directory")
	}
	files, _ := filepath.Glob(filepath.Join(dir, "eval", "*.json"))
	sort.Strings(files)
	src := &DirSource{Dir: dir}
	h, err := New(context.Background(), Config{Source: src})
	if err != nil {
		t.Fatal(err)
	}
	nTypes, nTools := h.Index().Len()
	if nTypes == 0 || len(files) == 0 {
		t.Skipf("catalog has %d types and %d eval files", nTypes, len(files))
	}
	t.Logf("catalog: %d types, %d tools, %d entries skipped as invalid", nTypes, nTools, len(src.Skipped))
	for _, s := range src.Skipped {
		t.Logf("  skipped %s", s)
	}

	type agg struct {
		n, hit5    int
		rr         float64
		unknownIDs int
	}
	total, hard := agg{}, agg{}
	var misses []string
	for _, f := range files {
		b, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		var cases []EvalCase
		if err := json.Unmarshal(b, &cases); err != nil {
			t.Errorf("%s: %v", f, err)
			continue
		}
		a := agg{}
		for _, c := range cases {
			want := set(c.Expect)
			for id := range want {
				if _, ok := h.Index().Type(id); !ok {
					a.unknownIDs++
				}
			}
			p, err := h.Context(context.Background(), Request{Text: c.Request, NoLookup: true})
			if err != nil {
				t.Fatal(err)
			}
			a.n++
			rank := 0
			var got []string
			for i, th := range p.Types {
				got = append(got, th.Type.ID)
				if rank == 0 && want[th.Type.ID] {
					rank = i + 1
				}
			}
			if rank > 0 && rank <= 5 {
				a.hit5++
			}
			if rank > 0 {
				a.rr += 1 / float64(rank)
			} else {
				misses = append(misses, c.Request+" → want "+strings.Join(c.Expect, ",")+", got "+strings.Join(got, ","))
			}
		}
		name := strings.TrimSuffix(filepath.Base(f), ".json")
		if a.n > 0 {
			t.Logf("%-22s n=%3d  recall@5=%.2f  MRR=%.2f%s", name, a.n, float64(a.hit5)/float64(a.n), a.rr/float64(a.n), unknownNote(a.unknownIDs))
		}
		total.n += a.n
		total.hit5 += a.hit5
		total.rr += a.rr
		total.unknownIDs += a.unknownIDs
		if strings.HasPrefix(name, "hard_") {
			hard.n += a.n
			hard.hit5 += a.hit5
			hard.rr += a.rr
		}
	}
	if total.n == 0 {
		t.Skip("no eval cases")
	}
	t.Logf("%-22s n=%3d  recall@5=%.2f  MRR=%.2f%s  (target recall@5 ≥ 0.90)", "ALL", total.n, float64(total.hit5)/float64(total.n), total.rr/float64(total.n), unknownNote(total.unknownIDs))
	if hard.n > 0 {
		t.Logf("%-22s n=%3d  recall@5=%.2f  MRR=%.2f  (the eval/hard_*.json files)", "HARD", hard.n, float64(hard.hit5)/float64(hard.n), hard.rr/float64(hard.n))
	}
	for _, m := range misses {
		t.Logf("  miss: %s", m)
	}
}

func unknownNote(n int) string {
	if n == 0 {
		return ""
	}
	return "  (" + strconv.Itoa(n) + " expected ids not in the catalog)"
}

// TestCatalogLoads makes sure the repository catalog parses (when present) and that every loaded type
// passes Validate.
func TestCatalogLoads(t *testing.T) {
	dir, ok := FindCatalogDir()
	if !ok {
		t.Skip("no catalog directory")
	}
	src := &DirSource{Dir: dir}
	cat, err := src.Load(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(src.Skipped) > 0 {
		t.Logf("%d invalid entries skipped (check.mjs reports them too); first: %s", len(src.Skipped), src.Skipped[0])
	}
	t.Logf("%d types, %d tools", len(cat.Types), len(cat.Tools))
}
