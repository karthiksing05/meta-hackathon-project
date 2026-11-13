// Command harness-query runs the harness's understand → retrieve → look-up steps for one request and
// prints the context pack.
//
//	go run ./cmd/harness-query "a harry potter krillion"          # keyword understanding, no network
//	go run ./cmd/harness-query --json "like subway surfers"       # the whole pack as JSON
//	MUSE_API_KEY=… go run ./cmd/harness-query --muse "make krillion"
//
// --muse uses Muse (Spark) to understand the request and turns on the web lookup (Wikipedia and the
// game's own site, then Muse writes a learned entry). The key is read from the MUSE_API_KEY environment
// variable only, never from a flag or a file, and is never printed. MUSE_BASE_URL and MUSE_MODEL override
// the endpoint (https://api.meta.ai/v1) and model (muse-spark-1.3); MUSE_EFFORT the reasoning effort
// (minimal); MUSE_PLAN_EFFORT the planner's. --plan also runs the planner and prints the plan (with
// --json, the whole generator context). The catalog comes from
// authoring/catalog (or --catalog, or $HARNESS_CATALOG).
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/karthiksing05/meta-hackathon-project/backend/internal/harness"
)

func main() {
	var (
		useMuse  = flag.Bool("muse", false, "understand with Muse and allow the web lookup (needs MUSE_API_KEY)")
		asJSON   = flag.Bool("json", false, "print the whole context pack as JSON")
		catalog  = flag.String("catalog", "", "catalog directory (default: authoring/catalog)")
		k        = flag.Int("k", 6, "types and direct tools to return")
		noLookup = flag.Bool("no-lookup", false, "never look anything up")
		budget   = flag.Duration("fetch-budget", 4*time.Second, "time for all web fetching for one name")
		museWait = flag.Duration("muse-timeout", 15*time.Second, "timeout for each Muse call (production: 15 s)")
		withPlan = flag.Bool("plan", false, "also run the planner (muse-wonder-1.0, 12000 tokens, 90 s; needs --muse) and print the game spec")
		chain    = flag.Bool("chain", false, "with --plan: fill the spec in three chained calls instead of one")
	)
	flag.Usage = func() {
		fmt.Fprintf(os.Stderr, "usage: harness-query [flags] \"request\"\n")
		flag.PrintDefaults()
	}
	flag.Parse()
	req := strings.TrimSpace(strings.Join(flag.Args(), " "))
	if req == "" {
		flag.Usage()
		os.Exit(2)
	}
	ctx := context.Background()
	src := &harness.DirSource{Dir: *catalog}
	cfg := harness.Config{Source: src, Options: harness.Options{TopTypes: *k, TopTools: *k}}
	var planner *harness.Planner
	if *useMuse {
		key := strings.TrimSpace(os.Getenv("MUSE_API_KEY"))
		if key == "" {
			fmt.Fprintln(os.Stderr, "harness-query: --muse needs MUSE_API_KEY in the environment")
			os.Exit(2)
		}
		muse := &harness.MuseClient{APIKey: key, BaseURL: os.Getenv("MUSE_BASE_URL"), Model: os.Getenv("MUSE_MODEL"),
			ReasoningEffort: os.Getenv("MUSE_EFFORT"), Timeout: *museWait}
		cfg.Understander = harness.MuseUnderstander{Muse: muse}
		lk := harness.NewLookup(muse)
		lk.FetchBudget = *budget
		cfg.Lookup = lk
		if *withPlan {
			dir := *catalog
			if dir == "" {
				dir, _ = harness.FindCatalogDir()
			}
			lists, _, err := harness.LoadChecklists(dir)
			if err != nil {
				fmt.Fprintln(os.Stderr, "harness-query: checklists:", err)
				os.Exit(1)
			}
			effort := os.Getenv("MUSE_PLAN_EFFORT")
			if effort == "" {
				effort = harness.PlanEffort
			}
			planner = &harness.Planner{Checklists: lists, Chain: *chain, Muse: &harness.MuseClient{APIKey: key, BaseURL: os.Getenv("MUSE_BASE_URL"),
				Model: harness.ModelWonder, MaxTokens: 12000, ReasoningEffort: effort, Timeout: 90 * time.Second}}
		}
	}
	h, err := harness.New(ctx, cfg)
	if err != nil {
		fmt.Fprintln(os.Stderr, "harness-query:", err)
		os.Exit(1)
	}
	if *withPlan {
		if planner == nil {
			fmt.Fprintln(os.Stderr, "harness-query: --plan needs --muse")
			os.Exit(2)
		}
		b, err := h.Build(ctx, harness.Request{Text: req, NoLookup: *noLookup}, planner)
		if err != nil {
			fmt.Fprintln(os.Stderr, "harness-query: plan:", err)
			os.Exit(1)
		}
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		enc.SetEscapeHTML(false)
		if *asJSON {
			_ = enc.Encode(b.Context)
			return
		}
		nt, nl := h.Index().Len()
		printPack(b.Pack, nt, nl, len(src.Skipped))
		printPlan(b.Plan, b.PlanMs)
		fmt.Println("\nspec")
		_ = enc.Encode(b.Plan.Spec)
		return
	}
	pack, err := h.Context(ctx, harness.Request{Text: req, NoLookup: *noLookup})
	if err != nil {
		fmt.Fprintln(os.Stderr, "harness-query:", err)
		os.Exit(1)
	}
	if *asJSON {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		enc.SetEscapeHTML(false)
		_ = enc.Encode(pack)
		return
	}
	nt, nl := h.Index().Len()
	printPack(pack, nt, nl, len(src.Skipped))
}

func printPack(p harness.ContextPack, nTypes, nTools, skipped int) {
	fmt.Printf("request: %q\ncatalog: %d types, %d tools", p.Request, nTypes, nTools)
	if skipped > 0 {
		fmt.Printf(" (%d invalid entries skipped)", skipped)
	}
	fmt.Println()
	u := p.Understanding
	fmt.Printf("\nunderstood by %s\n", p.Understood)
	line := func(k string, v []string) {
		if len(v) > 0 {
			fmt.Printf("  %-13s %s\n", k, strings.Join(v, ", "))
		}
	}
	line("named_refs", u.NamedRefs)
	line("unknown_refs", u.UnknownRefs)
	line("verbs", u.Verbs)
	line("inputs", u.Inputs)
	line("families", u.Families)
	line("theme", u.Theme)
	line("keywords", u.Keywords)
	fmt.Printf("  %-13s %s\n", "players", u.Players)
	for _, r := range p.Refs {
		fmt.Printf("  ref %q: hit=%v closest %q (%s, %.2f)\n", r.Ref, r.Hit, r.Name, r.TypeID, r.Similarity)
	}

	fmt.Println("\ntypes")
	for i, t := range p.Types {
		fmt.Printf("  %d. %-34s %.3f  [%s] %s\n", i+1, t.Type.ID, t.Score, t.Type.Family, t.Type.Status)
		for _, r := range t.Reasons {
			fmt.Printf("       - %s\n", r)
		}
	}
	fmt.Println("\ntools")
	for _, t := range p.Tools {
		status := "MISSING"
		if t.Tool != nil {
			status = t.Tool.Kind + "/" + t.Tool.Status
		}
		fmt.Printf("  %-26s %-22s via %s", t.ID, status, strings.Join(t.Via, ", "))
		if t.Score > 0 {
			fmt.Printf("  (%.3f)", t.Score)
		}
		fmt.Println()
	}
	if len(p.Lookups) > 0 {
		fmt.Println("\nlookups")
		for _, l := range p.Lookups {
			fmt.Printf("  %q (%d ms, cached=%v): %s\n", l.Ref, l.Ms, l.Cached, l.Reason)
			for _, s := range l.Sources {
				fmt.Printf("    source %s %s — %s\n", s.Kind, s.URL, s.Title)
			}
			if l.Error != "" {
				fmt.Printf("    error: %s\n", l.Error)
			}
			if l.Learned != nil {
				b, _ := json.MarshalIndent(l.Learned, "    ", "  ")
				fmt.Printf("    learned: %s\n", b)
			}
		}
	}
	for _, n := range p.Notes {
		fmt.Printf("\nnote: %s\n", n)
	}
	fmt.Printf("\ntimings: understand %d ms, retrieve %d ms, lookup %d ms, total %d ms\n",
		p.Timings.Understand, p.Timings.Retrieve, p.Timings.Lookup, p.Timings.Total)
}

func printPlan(p *harness.Plan, planMs int64) {
	fmt.Printf("\nplan (%d ms):", planMs)
	for _, c := range p.Calls {
		fmt.Printf(" %s %d ms;", c.Step, c.Ms)
	}
	fmt.Printf("\n  types %s", strings.Join(p.TypeIDs, ", "))
	if p.Blend != "" {
		fmt.Printf(" (%s)", p.Blend)
	}
	fmt.Printf("\n  tools %s\n", strings.Join(p.ToolIDs, ", "))
	for _, g := range p.Gaps {
		fmt.Printf("  gap %s (%s): %s\n", g.Tool, g.Status, g.Approximation)
	}
	for _, c := range p.Clarify {
		how := "from the request"
		if c.Guessed {
			how = "guessed"
		}
		fmt.Printf("  slot %-16s %q (%s)", c.Slot, c.Value, how)
		if c.Question != "" {
			fmt.Printf("  ASK %q %v", c.Question, c.Choices)
		}
		fmt.Println()
	}
	if s := p.Spec; s != nil {
		sc := s.Score
		fmt.Printf("  goal: %s [target %q, measure %q]\n", s.Goal.Text, s.Goal.Target, s.Goal.Measure)
		fmt.Printf("  score: %s, %s is better, counts when %s, %s, tie %s, format %q, measures %q, events %v",
			sc.Kind, sc.Direction, sc.CountsWhen, sc.Aggregate, sc.TieBreak, sc.Format, sc.Measures, sc.Events)
		if sc.Reason != "" {
			fmt.Printf(", reason %q", sc.Reason)
		}
		fmt.Println()
	}
	for _, i := range p.Issues {
		fmt.Printf("  spec issue: %s\n", i)
	}
	for _, n := range p.Notes {
		fmt.Printf("  note: %s\n", n)
	}
}
