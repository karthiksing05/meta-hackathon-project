package harness

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// Harness runs steps 1–3: understand, retrieve and (only when needed) look up. It holds the current index
// and swaps it atomically on Reload, so Context can run concurrently with a reload.
type Harness struct {
	src        Source
	understand Understander
	fallback   Understander
	lookup     *Lookup
	learned    LearnedStore
	embedder   Embedder
	opts       Options

	idx      atomic.Pointer[Index]
	reloadMu sync.Mutex
}

// Options tune the harness.
type Options struct {
	TopTypes int // default 6
	TopTools int // default 6
	// LookupBelow fires a lookup for the named refs when the best type scores below it (0..1, the fused
	// score scaled so 1 is first in every scorer). Default 0.45.
	LookupBelow float64
	// MaxLookups caps how many names one request looks up. Default 2.
	MaxLookups int
}

// Config is what New needs. Only Source is required: with no Understander the keyword fallback is used,
// and with no Lookup nothing is looked up.
type Config struct {
	Source       Source
	Understander Understander // e.g. MuseUnderstander; nil = KeywordUnderstander
	Lookup       *Lookup      // nil = no web lookup
	Learned      LearnedStore // nil = an in-memory store
	Embedder     Embedder     // nil = three scorers
	Options      Options
}

// New loads the catalog and builds the first index.
func New(ctx context.Context, c Config) (*Harness, error) {
	if c.Source == nil {
		return nil, errors.New("harness: no catalog source")
	}
	h := &Harness{src: c.Source, understand: c.Understander, fallback: KeywordUnderstander{}, lookup: c.Lookup,
		learned: c.Learned, embedder: c.Embedder, opts: c.Options}
	if h.understand == nil {
		h.understand = h.fallback
	}
	if h.learned == nil {
		h.learned = NewMemoryLearned()
	}
	if h.opts.TopTypes <= 0 {
		h.opts.TopTypes = 6
	}
	if h.opts.TopTools <= 0 {
		h.opts.TopTools = 6
	}
	if h.opts.LookupBelow <= 0 {
		h.opts.LookupBelow = 0.45
	}
	if h.opts.MaxLookups <= 0 {
		h.opts.MaxLookups = 2
	}
	if err := h.Reload(ctx); err != nil {
		return nil, err
	}
	return h, nil
}

// Reload reloads the catalog (plus every learned type) and swaps in a new index.
func (h *Harness) Reload(ctx context.Context) error {
	h.reloadMu.Lock()
	defer h.reloadMu.Unlock()
	cat, err := h.src.Load(ctx)
	if err != nil {
		return err
	}
	return h.rebuild(ctx, cat)
}

func (h *Harness) rebuild(ctx context.Context, cat *Catalog) error {
	learned, err := h.learned.List(ctx)
	if err != nil {
		return err
	}
	merged := &Catalog{Types: append([]GameType(nil), cat.Types...), Tools: cat.Tools}
	have := map[string]bool{}
	for _, t := range merged.Types {
		have[t.ID] = true
	}
	for _, t := range learned {
		if !have[t.ID] {
			merged.Types = append(merged.Types, t)
			have[t.ID] = true
		}
	}
	ix, err := NewIndex(ctx, merged, h.embedder)
	if err != nil {
		return err
	}
	h.idx.Store(ix)
	return nil
}

// Index is the current index.
func (h *Harness) Index() *Index { return h.idx.Load() }

// Request is one game request.
type Request struct {
	Text string `json:"text"`
	// Understanding, if set, skips step 1 (replays, tests, or a caller that already understood the request).
	Understanding *Understanding `json:"understanding,omitempty"`
	// NoLookup turns step 3 off for this request.
	NoLookup bool `json:"no_lookup,omitempty"`
	// Preferences are the person's earlier picks between versions (docs/harness-gaps/variants.md), from the
	// server's profile store. They go into the context and the planner prompt.
	Preferences []Preference `json:"preferences,omitempty"`
	// Sponsor is the server's sponsor record for this job (a brand account's game, model.Sponsor): when the request
	// doesn't name a sponsor itself, the understanding carries this one, so the plan's spec.theme gets it.
	Sponsor *Sponsor `json:"sponsor,omitempty"`
	// Media describes the person's own photos and video (the API's context.media, as text). The planner's prompts get
	// it after the request; understanding and the stated requirements read only Text, so the media's words never
	// become requirements.
	Media string `json:"media,omitempty"`
	// Group is the Group or Event the game is made for (its name and members' display names), for the plan.
	Group *Group `json:"group,omitempty"`
}

// Timings are in milliseconds.
type Timings struct {
	Understand   int64  `json:"understand_ms"`
	UnderstoodBy string `json:"understood_by,omitempty"` // muse, keywords, given, or "keywords (muse failed: …)"
	Retrieve     int64  `json:"retrieve_ms"`
	Lookup       int64  `json:"lookup_ms"`
	Total        int64  `json:"total_ms"`
}

// ContextPack is what steps 1–3 hand the planner.
type ContextPack struct {
	Request       string         `json:"request"`
	Understanding Understanding  `json:"understanding"`
	Understood    string         `json:"understood_by"` // "muse", "keywords", "given", or "keywords (muse failed: …)"
	Types         []TypeHit      `json:"types"`
	Tools         []ToolHit      `json:"tools"`
	Refs          []RefMatch     `json:"refs,omitempty"`
	Learned       []GameType     `json:"learned,omitempty"` // types learned (or recalled) from the web for this request
	Lookups       []LookupReport `json:"lookups,omitempty"`
	Timings       Timings        `json:"timings"`
	Notes         []string       `json:"notes,omitempty"`
}

// Context runs understand → retrieve → look up for one request. Given the same understanding and catalog,
// the retrieval result is the same every time.
func (h *Harness) Context(ctx context.Context, req Request) (ContextPack, error) {
	start := time.Now()
	ix := h.idx.Load()
	pack := ContextPack{Request: req.Text}

	// 1. understand
	t0 := time.Now()
	switch {
	case req.Understanding != nil:
		pack.Understanding = req.Understanding.clean(ix.Vocab())
		pack.Understood = "given"
	default:
		u, err := h.understand.Understand(ctx, req.Text, ix.Vocab())
		pack.Understood = understoodBy(h.understand)
		if err != nil {
			if ctx.Err() != nil {
				return pack, ctx.Err()
			}
			u, _ = h.fallback.Understand(ctx, req.Text, ix.Vocab())
			pack.Understood = "keywords (muse failed: " + err.Error() + ")"
		}
		pack.Understanding = u
	}
	if req.Sponsor != nil && strings.TrimSpace(req.Sponsor.Name) != "" && pack.Understanding.Sponsor == nil {
		sp := *req.Sponsor
		sp.Name = strings.TrimSpace(sp.Name)
		pack.Understanding.Sponsor = &sp
	}
	pack.Timings.Understand = ms(time.Since(t0))
	pack.Timings.UnderstoodBy = pack.Understood

	// 2. retrieve
	t1 := time.Now()
	res, err := ix.Search(ctx, Query{Text: req.Text, Understanding: pack.Understanding, TopTypes: h.opts.TopTypes, TopTools: h.opts.TopTools})
	if err != nil {
		return pack, err
	}
	pack.Types, pack.Tools, pack.Refs = res.Types, res.Tools, res.Refs
	pack.Timings.Retrieve = ms(time.Since(t1))

	// 3. look up, only when needed
	t2 := time.Now()
	targets := h.lookupTargets(pack, res)
	if len(targets) > 0 && !req.NoLookup {
		learnedAny := false
		// each name is looked up at once (they are independent); the reports keep the targets' order
		reps := make([]LookupReport, len(targets))
		var wg sync.WaitGroup
		for i, tg := range targets {
			wg.Add(1)
			go func(i int, tg lookupTarget) {
				defer wg.Done()
				reps[i] = h.lookupOne(ctx, req.Text, tg.ref, tg.reason, ix.Vocab())
			}(i, tg)
		}
		wg.Wait()
		for _, rep := range reps {
			pack.Lookups = append(pack.Lookups, rep)
			if rep.Learned != nil {
				pack.Learned = append(pack.Learned, *rep.Learned)
				learnedAny = learnedAny || !rep.Cached
			}
		}
		if learnedAny {
			// make what was learned searchable for the next request
			if err := h.rebuildWithCurrent(ctx); err != nil {
				pack.Notes = append(pack.Notes, "couldn't add the learned type to the index: "+err.Error())
			}
		}
		if len(pack.Learned) > 0 {
			pack.Types = prependLearned(pack.Types, pack.Learned, h.opts.TopTypes)
		}
	} else if len(targets) > 0 {
		pack.Notes = append(pack.Notes, "a lookup would have fired, but it is off for this request")
	} else if res.Top < h.opts.LookupBelow {
		pack.Notes = append(pack.Notes, fmt.Sprintf("low confidence (top %.2f) and no named game to look up", res.Top))
	}
	pack.Timings.Lookup = ms(time.Since(t2))
	pack.Timings.Total = ms(time.Since(start))
	return pack, nil
}

type lookupTarget struct{ ref, reason string }

// lookupTargets are the named refs to look up: any the catalog has no alias for (or that Muse said it
// doesn't know and the catalog doesn't either), and, when the best score is low, every named ref without
// an exact hit.
func (h *Harness) lookupTargets(pack ContextPack, res Result) []lookupTarget {
	byRef := map[string]RefMatch{}
	for _, r := range res.Refs {
		byRef[r.Ref] = r
	}
	unknown := set(pack.Understanding.UnknownRefs)
	var out []lookupTarget
	seen := map[string]bool{}
	for _, r := range uniq(append(append([]string{}, pack.Understanding.NamedRefs...), pack.Understanding.UnknownRefs...)) {
		k := LearnedKey(r)
		if k == "" || seen[k] {
			continue
		}
		m := byRef[r]
		switch {
		case !m.Hit && unknown[r]:
			out = append(out, lookupTarget{r, "Muse doesn't know it and the catalog has no alias for it"})
		case !m.Hit:
			out = append(out, lookupTarget{r, fmt.Sprintf("no catalog alias for it (closest %q, %.2f)", m.Name, m.Similarity)})
		case res.Top < h.opts.LookupBelow && m.Similarity < 1:
			out = append(out, lookupTarget{r, fmt.Sprintf("low confidence (top %.2f) and only a fuzzy alias hit", res.Top)})
		default:
			continue
		}
		seen[k] = true
		if len(out) >= h.opts.MaxLookups {
			break
		}
	}
	return out
}

func (h *Harness) lookupOne(ctx context.Context, request, ref, reason string, vocab Vocab) LookupReport {
	t := time.Now()
	rep := LookupReport{Ref: ref, Reason: reason}
	if got, ok, err := h.learned.Get(ctx, ref); err == nil && ok {
		rep.Cached, rep.Learned = true, &got
		rep.Ms = ms(time.Since(t))
		return rep
	}
	if h.lookup == nil {
		rep.Error = "web lookup is off"
		rep.Ms = ms(time.Since(t))
		return rep
	}
	gt, ev, err := h.lookup.Find(ctx, ref, request, vocab)
	for _, e := range ev {
		e.Text = clip(e.Text, 280) // the pack carries an excerpt; the full text went to Muse
		rep.Sources = append(rep.Sources, e)
	}
	if err != nil {
		rep.Error = err.Error()
	} else {
		rep.Learned = gt
		if perr := h.learned.Put(ctx, ref, *gt); perr != nil {
			rep.Error = "learned but not saved: " + perr.Error()
		}
	}
	rep.Ms = ms(time.Since(t))
	return rep
}

func (h *Harness) rebuildWithCurrent(ctx context.Context) error {
	h.reloadMu.Lock()
	defer h.reloadMu.Unlock()
	cat, err := h.src.Load(ctx)
	if err != nil {
		return err
	}
	return h.rebuild(ctx, cat)
}

// prependLearned puts learned types first (they are what the person named), keeping the list at most n
// long and without duplicates.
func prependLearned(types []TypeHit, learned []GameType, n int) []TypeHit {
	out := make([]TypeHit, 0, n)
	seen := map[string]bool{}
	for _, t := range learned {
		if seen[t.ID] {
			continue
		}
		seen[t.ID] = true
		out = append(out, TypeHit{Type: t, Score: 1, Ranks: map[string]int{}, Reasons: []string{"learned from the web for this request"}})
	}
	for _, t := range types {
		if len(out) >= n {
			break
		}
		if !seen[t.Type.ID] {
			seen[t.Type.ID] = true
			out = append(out, t)
		}
	}
	return out
}

func understoodBy(u Understander) string {
	switch u.(type) {
	case MuseUnderstander, *MuseUnderstander:
		return "muse"
	case KeywordUnderstander, *KeywordUnderstander:
		return "keywords"
	}
	return fmt.Sprintf("%T", u)
}

func ms(d time.Duration) int64 { return d.Milliseconds() }
