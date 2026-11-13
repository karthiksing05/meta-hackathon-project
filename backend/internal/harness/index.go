package harness

import (
	"context"
	"fmt"
	"math"
	"sort"
	"strings"
)

// The index is built once per catalog load and never changed afterwards, so any number of goroutines can
// search it at once; Harness swaps in a new one on reload.

// Embedder is an optional fourth scorer: if set, documents and queries are embedded and ranked by cosine
// similarity, and that ranking joins the same reciprocal-rank fusion. Muse has no embeddings endpoint today,
// so it is nil by default.
type Embedder interface {
	Embed(ctx context.Context, texts []string) ([][]float32, error)
}

// Tuning. The field weights are the plan's: name and aliases ×3, example prompts ×2, the rest ×1.
const (
	bm25K1 = 1.2
	bm25B  = 0.75
	rrfK   = 60.0

	weightBM25     = 1.0
	weightTrigram  = 1.0
	weightFacet    = 0.6
	weightEmbed    = 1.0
	trigramMinDice = 0.55 // weakest name/alias similarity that counts as a fuzzy hit
	aliasHitDice   = 0.8  // a named ref this close to a name or alias is a catalog hit (allows a typo or two)
	scorerDepth    = 200  // ranks below this in one scorer don't contribute to the fusion
)

type fieldSpec struct {
	name   string
	weight float64
}

var typeFields = []fieldSpec{
	{"name", 3}, {"aliases", 3}, {"example_prompts", 2}, {"summary", 1}, {"core_loop", 1}, {"verbs", 1}, {"family", 1},
}

var toolFields = []fieldSpec{
	{"name", 3}, {"aliases", 3}, {"when_to_use", 2}, {"summary", 1}, {"api", 1}, {"kind", 1},
}

func typeFieldTexts(t *GameType) []string {
	return []string{
		t.Name,
		strings.Join(t.Aliases, " | "),
		strings.Join(t.ExamplePrompts, " | "),
		t.Summary,
		t.CoreLoop,
		strings.Join(t.Verbs, " "),
		strings.Join(append([]string{strings.ReplaceAll(t.Family, "_", " "), t.Subfamily}, t.Pieces...), " | "),
	}
}

func toolFieldTexts(t *GameTool) []string {
	name := strings.ReplaceAll(t.ID, "_", " ")
	if t.Name != "" && Fold(t.Name) != name {
		name += " | " + t.Name
	}
	return []string{
		name,
		strings.Join(t.Aliases, " | "),
		t.WhenToUse,
		t.Summary,
		t.API,
		strings.ReplaceAll(t.Kind, "_", " "),
	}
}

// ---- BM25F ----

type bm25Doc struct {
	tf  []map[string]int // per field
	len []int
}

type bm25f struct {
	fields   []fieldSpec
	docs     []bm25Doc
	avgLen   []float64
	df       map[string]int
	postings map[string][]int
}

func newBM25F(fields []fieldSpec, texts [][]string) *bm25f {
	ix := &bm25f{fields: fields, df: map[string]int{}, postings: map[string][]int{}, avgLen: make([]float64, len(fields))}
	ix.docs = make([]bm25Doc, len(texts))
	for d, ft := range texts {
		doc := bm25Doc{tf: make([]map[string]int, len(fields)), len: make([]int, len(fields))}
		seen := map[string]bool{}
		for f := range fields {
			terms := TermsWithBigrams(ft[f])
			m := make(map[string]int, len(terms))
			for _, t := range terms {
				m[t]++
				if !seen[t] {
					seen[t] = true
					ix.df[t]++
					ix.postings[t] = append(ix.postings[t], d)
				}
			}
			doc.tf[f] = m
			doc.len[f] = len(terms)
			ix.avgLen[f] += float64(len(terms))
		}
		ix.docs[d] = doc
	}
	for f := range fields {
		if len(texts) > 0 {
			ix.avgLen[f] /= float64(len(texts))
		}
		if ix.avgLen[f] == 0 {
			ix.avgLen[f] = 1
		}
	}
	return ix
}

func (ix *bm25f) idf(t string) float64 {
	n, df := float64(len(ix.docs)), float64(ix.df[t])
	return math.Log(1 + (n-df+0.5)/(df+0.5))
}

type termHit struct {
	term    string
	fields  []string
	contrib float64
}

type bm25Hit struct {
	doc   int
	score float64
	terms []termHit
}

// search scores every document holding at least one query term. Query terms come sorted, so the float sums
// (and therefore tie-breaks) are the same on every run.
func (ix *bm25f) search(q []weightedTerm) []bm25Hit {
	acc := map[int]*bm25Hit{}
	for _, wt := range q {
		post := ix.postings[wt.term]
		if len(post) == 0 {
			continue
		}
		idf := ix.idf(wt.term)
		for _, d := range post {
			doc := &ix.docs[d]
			tf := 0.0
			var fields []string
			for f, spec := range ix.fields {
				n := doc.tf[f][wt.term]
				if n == 0 {
					continue
				}
				norm := 1 - bm25B + bm25B*float64(doc.len[f])/ix.avgLen[f]
				tf += spec.weight * float64(n) / norm
				fields = append(fields, spec.name)
			}
			c := wt.weight * idf * tf / (bm25K1 + tf)
			h := acc[d]
			if h == nil {
				h = &bm25Hit{doc: d}
				acc[d] = h
			}
			h.score += c
			h.terms = append(h.terms, termHit{term: wt.term, fields: fields, contrib: c})
		}
	}
	out := make([]bm25Hit, 0, len(acc))
	for _, h := range acc {
		out = append(out, *h)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].score != out[j].score {
			return out[i].score > out[j].score
		}
		return out[i].doc < out[j].doc
	})
	return out
}

// ---- character trigrams over names and aliases ----

type nameEntry struct {
	doc    int
	text   string // as written
	squash string
	grams  map[string]struct{}
	alias  bool
}

type trigramIndex struct {
	entries  []nameEntry
	postings map[string][]int // trigram → entry indexes
}

func newTrigramIndex(names [][]string, aliasFrom []int) *trigramIndex {
	ix := &trigramIndex{postings: map[string][]int{}}
	for d, ns := range names {
		seen := map[string]bool{}
		for i, n := range ns {
			sq := Squash(n)
			if len(sq) < 2 || seen[sq] {
				continue
			}
			seen[sq] = true
			e := nameEntry{doc: d, text: n, squash: sq, grams: Trigrams(n), alias: i >= aliasFrom[d]}
			id := len(ix.entries)
			ix.entries = append(ix.entries, e)
			for g := range e.grams {
				ix.postings[g] = append(ix.postings[g], id)
			}
		}
	}
	return ix
}

type nameMatch struct {
	doc    int
	entry  int
	phrase string
	dice   float64
	exact  bool
}

// best returns, for one phrase, the best match per document at or above min similarity.
func (ix *trigramIndex) best(phrase string, min float64) []nameMatch {
	g := Trigrams(phrase)
	sq := Squash(phrase)
	if len(g) == 0 {
		return nil
	}
	shared := map[int]int{}
	for t := range g {
		for _, e := range ix.postings[t] {
			shared[e]++
		}
	}
	bestByDoc := map[int]nameMatch{}
	for e, n := range shared {
		ent := &ix.entries[e]
		dice := 2 * float64(n) / float64(len(g)+len(ent.grams))
		// a transposed or doubled letter costs trigrams but only one edit ("wordel" → "wordle")
		if r := editRatio(sq, ent.squash); r > dice {
			dice = r
		}
		exact := ent.squash == sq
		if exact {
			dice = 1
		}
		if dice < min {
			continue
		}
		cur, ok := bestByDoc[ent.doc]
		if !ok || dice > cur.dice || (dice == cur.dice && e < cur.entry) {
			bestByDoc[ent.doc] = nameMatch{doc: ent.doc, entry: e, phrase: phrase, dice: dice, exact: exact}
		}
	}
	out := make([]nameMatch, 0, len(bestByDoc))
	for _, m := range bestByDoc {
		out = append(out, m)
	}
	return out
}

// ---- the index ----

// Index is the searchable catalog. Build it with NewIndex; it is safe for concurrent use.
type Index struct {
	types    []GameType
	tools    []GameTool
	toolByID map[string]int
	typeByID map[string]int
	vocab    Vocab

	typeBM  *bm25f
	toolBM  *bm25f
	typeTri *trigramIndex
	toolTri *trigramIndex

	embedder Embedder
	typeVecs [][]float32
}

// NewIndex builds the index. embedder may be nil.
func NewIndex(ctx context.Context, cat *Catalog, embedder Embedder) (*Index, error) {
	ix := &Index{
		types:    append([]GameType(nil), cat.Types...),
		tools:    append([]GameTool(nil), cat.Tools...),
		toolByID: map[string]int{},
		typeByID: map[string]int{},
		embedder: embedder,
	}
	sort.SliceStable(ix.types, func(i, j int) bool { return ix.types[i].ID < ix.types[j].ID })
	sort.SliceStable(ix.tools, func(i, j int) bool { return ix.tools[i].ID < ix.tools[j].ID })
	for i, t := range ix.types {
		ix.typeByID[t.ID] = i
	}
	for i, t := range ix.tools {
		ix.toolByID[t.ID] = i
	}
	ix.vocab = VocabOf(ix.types)

	typeTexts := make([][]string, len(ix.types))
	typeNames := make([][]string, len(ix.types))
	typeAliasFrom := make([]int, len(ix.types))
	for i := range ix.types {
		t := &ix.types[i]
		typeTexts[i] = typeFieldTexts(t)
		typeNames[i] = append([]string{t.Name, strings.ReplaceAll(t.ID, "_", " ")}, t.Aliases...)
		typeAliasFrom[i] = 2
	}
	toolTexts := make([][]string, len(ix.tools))
	toolNames := make([][]string, len(ix.tools))
	toolAliasFrom := make([]int, len(ix.tools))
	for i := range ix.tools {
		t := &ix.tools[i]
		toolTexts[i] = toolFieldTexts(t)
		toolNames[i] = append([]string{strings.ReplaceAll(t.ID, "_", " "), t.Name}, t.Aliases...)
		toolAliasFrom[i] = 2
	}
	ix.typeBM = newBM25F(typeFields, typeTexts)
	ix.toolBM = newBM25F(toolFields, toolTexts)
	ix.typeTri = newTrigramIndex(typeNames, typeAliasFrom)
	ix.toolTri = newTrigramIndex(toolNames, toolAliasFrom)

	if embedder != nil && len(ix.types) > 0 {
		docs := make([]string, len(ix.types))
		for i := range ix.types {
			t := &ix.types[i]
			docs[i] = t.Name + ". " + strings.Join(t.Aliases, ", ") + ". " + t.Summary + " " + t.CoreLoop
		}
		vecs, err := embedder.Embed(ctx, docs)
		if err != nil {
			return nil, fmt.Errorf("harness: embedding the catalog: %w", err)
		}
		if len(vecs) != len(docs) {
			return nil, fmt.Errorf("harness: embedder returned %d vectors for %d documents", len(vecs), len(docs))
		}
		ix.typeVecs = vecs
	}
	return ix, nil
}

// Len is the number of types and tools indexed.
func (ix *Index) Len() (types, tools int) { return len(ix.types), len(ix.tools) }

// Vocab is the loaded catalog's controlled vocabulary.
func (ix *Index) Vocab() Vocab { return ix.vocab }

// Type returns a type by id.
func (ix *Index) Type(id string) (GameType, bool) {
	i, ok := ix.typeByID[id]
	if !ok {
		return GameType{}, false
	}
	return ix.types[i], true
}

// Tool returns a tool by id.
func (ix *Index) Tool(id string) (GameTool, bool) {
	i, ok := ix.toolByID[id]
	if !ok {
		return GameTool{}, false
	}
	return ix.tools[i], true
}

// Query is what the index searches with: the request text and what the understanding step made of it.
type Query struct {
	Text          string
	Understanding Understanding
	TopTypes      int // default 6
	TopTools      int // default 6
}

// TypeHit is one retrieved game type.
type TypeHit struct {
	Type    GameType       `json:"type"`
	Score   float64        `json:"score"` // fused score scaled to 0..1 (1 = first in every scorer)
	Ranks   map[string]int `json:"ranks"` // the type's rank in each scorer it appeared in, from 1
	Reasons []string       `json:"reasons"`
}

// ToolHit is one retrieved game tool: needed by a retrieved type, matched directly, or both.
type ToolHit struct {
	ID      string    `json:"id"`
	Tool    *GameTool `json:"tool,omitempty"`
	Score   float64   `json:"score"`             // direct-match fused score, 0..1 (0 if only a type needs it)
	Via     []string  `json:"via"`               // "type:<id>" for each retrieved type that lists it, "direct" for a direct match
	Reasons []string  `json:"reasons,omitempty"` // why it matched directly
	Missing bool      `json:"missing,omitempty"` // a type lists it but the catalog has no such tool yet
}

// RefMatch says whether a named ref from the understanding is known to the catalog.
type RefMatch struct {
	Ref        string  `json:"ref"`
	Hit        bool    `json:"hit"` // the closest name or alias is at least aliasHitDice similar
	TypeID     string  `json:"type_id,omitempty"`
	Name       string  `json:"name,omitempty"` // the name or alias it matched
	Similarity float64 `json:"similarity"`
}

// Result is a search's answer.
type Result struct {
	Types []TypeHit  `json:"types"`
	Tools []ToolHit  `json:"tools"`
	Refs  []RefMatch `json:"refs,omitempty"`
	Top   float64    `json:"top"` // the best type's score (0 when nothing matched)
}

type weightedTerm struct {
	term   string
	weight float64
}

// queryTerms builds the weighted BM25 query: the request at full weight, named refs at full weight,
// keywords a little lower, verbs and families lower still, and theme words lowest, because a theme
// ("hogwarts") says what the game looks like, not how it plays.
func queryTerms(text string, u Understanding) []weightedTerm {
	w := map[string]float64{}
	add := func(s string, weight float64) {
		for _, t := range TermsWithBigrams(s) {
			if weight > w[t] {
				w[t] = weight
			}
		}
	}
	add(text, 1)
	for _, r := range u.NamedRefs {
		add(r, 1)
	}
	for _, k := range u.Keywords {
		add(k, 0.7)
	}
	for _, v := range u.Verbs {
		add(v, 0.5)
	}
	for _, f := range u.Families {
		add(strings.ReplaceAll(f, "_", " "), 0.5)
	}
	for _, th := range u.Theme {
		for _, t := range TermsWithBigrams(th) {
			if _, named := namedTerm(t, u); !named {
				w[t] = 0.25
			}
		}
	}
	out := make([]weightedTerm, 0, len(w))
	for t, x := range w {
		out = append(out, weightedTerm{t, x})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].term < out[j].term })
	return out
}

func namedTerm(t string, u Understanding) (string, bool) {
	for _, r := range u.NamedRefs {
		for _, x := range TermsWithBigrams(r) {
			if x == t {
				return r, true
			}
		}
	}
	return "", false
}

// phrases are the request's word windows (1–4 words, not starting or ending on a stopword) plus the
// named refs: the strings compared against names and aliases by trigram similarity.
func phrases(text string, u Understanding) []string {
	words := strings.Fields(Fold(text))
	var out []string
	for i := range words {
		if stopwords[words[i]] {
			continue
		}
		for n := 1; n <= 4 && i+n <= len(words); n++ {
			if stopwords[words[i+n-1]] {
				continue
			}
			p := strings.Join(words[i:i+n], " ")
			if len(p) >= 4 {
				out = append(out, p)
			}
		}
	}
	for _, r := range u.NamedRefs {
		out = append(out, Fold(r))
	}
	// theme words shouldn't be fuzzy-matched to game names ("hogwarts" is not a game, and "potter" is not
	// "pottery"): drop every phrase made only of theme words, unless it is also a named ref
	themeWords := map[string]bool{}
	for _, th := range u.Theme {
		for _, w := range strings.Fields(Fold(th)) {
			themeWords[w] = true
		}
	}
	named := map[string]bool{}
	for _, r := range u.NamedRefs {
		named[Fold(r)] = true
	}
	if len(themeWords) > 0 {
		kept := out[:0]
		for _, p := range out {
			allTheme := true
			for _, w := range strings.Fields(p) {
				if !themeWords[w] {
					allTheme = false
					break
				}
			}
			if !allTheme || named[p] {
				kept = append(kept, p)
			}
		}
		out = kept
	}
	out = uniq(out)
	sort.Strings(out)
	return out
}

type scored struct {
	doc   int
	score float64
}

// ranksOf assigns competition ranks (ties share a rank) to a list already sorted best first.
func ranksOf(list []scored) map[int]int {
	r := make(map[int]int, len(list))
	for i, s := range list {
		if i >= scorerDepth {
			break
		}
		if i > 0 && s.score == list[i-1].score {
			r[s.doc] = r[list[i-1].doc]
		} else {
			r[s.doc] = i + 1
		}
	}
	return r
}

func sortScored(list []scored) {
	sort.Slice(list, func(i, j int) bool {
		if list[i].score != list[j].score {
			return list[i].score > list[j].score
		}
		return list[i].doc < list[j].doc
	})
}

// fuse is reciprocal-rank fusion: Σ weight / (k + rank) over the scorers a document appears in.
func fuse(rankings map[string]map[int]int, weights map[string]float64) []scored {
	names := make([]string, 0, len(rankings))
	for n := range rankings {
		names = append(names, n)
	}
	sort.Strings(names)
	acc := map[int]float64{}
	for _, n := range names {
		for d, r := range rankings[n] {
			acc[d] += weights[n] / (rrfK + float64(r))
		}
	}
	out := make([]scored, 0, len(acc))
	for d, s := range acc {
		out = append(out, scored{d, s})
	}
	sortScored(out)
	return out
}

// Search retrieves types and tools for a query. It is deterministic for a given index and query.
func (ix *Index) Search(ctx context.Context, q Query) (Result, error) {
	topTypes, topTools := q.TopTypes, q.TopTools
	if topTypes <= 0 {
		topTypes = 6
	}
	if topTools <= 0 {
		topTools = 6
	}
	terms := queryTerms(q.Text, q.Understanding)
	phr := phrases(q.Text, q.Understanding)

	rankings := map[string]map[int]int{}
	weights := map[string]float64{"bm25": weightBM25, "trigram": weightTrigram, "facets": weightFacet}
	reasons := map[int][]string{}

	// 1. BM25F
	bm := ix.typeBM.search(terms)
	list := make([]scored, len(bm))
	for i, h := range bm {
		list[i] = scored{h.doc, h.score}
		if i < scorerDepth {
			reasons[h.doc] = append(reasons[h.doc], bm25Reason(h))
		}
	}
	rankings["bm25"] = ranksOf(list)

	// 2. trigram similarity of the request's phrases to names and aliases
	triBest := map[int]nameMatch{}
	for _, p := range phr {
		for _, m := range ix.typeTri.best(p, trigramMinDice) {
			cur, ok := triBest[m.doc]
			if !ok || m.dice > cur.dice || (m.dice == cur.dice && len(m.phrase) > len(cur.phrase)) {
				triBest[m.doc] = m
			}
		}
	}
	list = list[:0]
	for d, m := range triBest {
		list = append(list, scored{d, m.dice})
	}
	sortScored(list)
	rankings["trigram"] = ranksOf(list)
	for _, s := range list[:min(len(list), scorerDepth)] {
		m := triBest[s.doc]
		e := ix.typeTri.entries[m.entry]
		kind := "name"
		if e.alias {
			kind = "alias"
		}
		if m.exact {
			reasons[s.doc] = append(reasons[s.doc], fmt.Sprintf("%s %q matches %q", kind, e.text, m.phrase))
		} else {
			reasons[s.doc] = append(reasons[s.doc], fmt.Sprintf("%s %q is close to %q (%.2f)", kind, e.text, m.phrase, m.dice))
		}
	}

	// 3. exact facet overlap
	u := q.Understanding
	if len(u.Verbs)+len(u.Inputs)+len(u.Families) > 0 {
		fams, verbs, inputs := set(u.Families), set(u.Verbs), set(u.Inputs)
		list = list[:0]
		why := map[int]string{}
		for d := range ix.types {
			t := &ix.types[d]
			score := 0.0
			var parts []string
			if fams[t.Family] {
				score += 2
				parts = append(parts, "family "+t.Family)
			}
			if mv := overlap(t.Verbs, verbs); len(mv) > 0 {
				score += float64(len(mv))
				parts = append(parts, "verbs "+strings.Join(mv, ", "))
			}
			if mi := overlap(t.Inputs, inputs); len(mi) > 0 {
				score += float64(len(mi))
				parts = append(parts, "inputs "+strings.Join(mi, ", "))
			}
			if score > 0 {
				list = append(list, scored{d, score})
				why[d] = strings.Join(parts, "; ")
			}
		}
		sortScored(list)
		rankings["facets"] = ranksOf(list)
		for d, r := range rankings["facets"] {
			if r <= topTypes*4 {
				reasons[d] = append(reasons[d], why[d])
			}
		}
	}

	// 4. optional embeddings
	if ix.embedder != nil && len(ix.typeVecs) > 0 {
		weights["embed"] = weightEmbed
		vecs, err := ix.embedder.Embed(ctx, []string{q.Text})
		if err != nil {
			return Result{}, fmt.Errorf("harness: embedding the query: %w", err)
		}
		if len(vecs) == 1 {
			list = list[:0]
			for d, v := range ix.typeVecs {
				if c := cosine(vecs[0], v); c > 0 {
					list = append(list, scored{d, c})
				}
			}
			sortScored(list)
			rankings["embed"] = ranksOf(list)
		}
	}

	maxFused := 0.0
	for _, w := range weights {
		maxFused += w / (rrfK + 1)
	}
	fused := fuse(rankings, weights)
	res := Result{}
	for i, f := range fused {
		if i >= topTypes {
			break
		}
		ranks := map[string]int{}
		for n, r := range rankings {
			if x, ok := r[f.doc]; ok {
				ranks[n] = x
			}
		}
		res.Types = append(res.Types, TypeHit{Type: ix.types[f.doc], Score: round3(f.score / maxFused), Ranks: ranks, Reasons: reasons[f.doc]})
	}
	if len(res.Types) > 0 {
		res.Top = res.Types[0].Score
	}

	// named refs: is each one a catalog name or alias?
	for _, r := range uniq(append(append([]string{}, u.NamedRefs...), u.UnknownRefs...)) {
		rm := RefMatch{Ref: r}
		for _, m := range ix.typeTri.best(Fold(r), 0.3) {
			e := ix.typeTri.entries[m.entry]
			if m.dice > rm.Similarity || (m.dice == rm.Similarity && ix.types[m.doc].ID < rm.TypeID) {
				rm.Similarity, rm.TypeID, rm.Name = round3(m.dice), ix.types[m.doc].ID, e.text
			}
		}
		rm.Hit = rm.Similarity >= aliasHitDice
		res.Refs = append(res.Refs, rm)
	}

	res.Tools = ix.tools4(terms, phr, res.Types, topTools)
	return res, nil
}

// tools4 is the union of the retrieved types' tools (in type order) and the top directly matched tools.
func (ix *Index) tools4(terms []weightedTerm, phr []string, types []TypeHit, top int) []ToolHit {
	rankings := map[string]map[int]int{}
	bm := ix.toolBM.search(terms)
	list := make([]scored, len(bm))
	why := map[int][]string{}
	for i, h := range bm {
		list[i] = scored{h.doc, h.score}
		if i < scorerDepth {
			why[h.doc] = append(why[h.doc], bm25Reason(h))
		}
	}
	rankings["bm25"] = ranksOf(list)
	best := map[int]nameMatch{}
	for _, p := range phr {
		for _, m := range ix.toolTri.best(p, 0.7) {
			if cur, ok := best[m.doc]; !ok || m.dice > cur.dice {
				best[m.doc] = m
			}
		}
	}
	list = list[:0]
	for d, m := range best {
		list = append(list, scored{d, m.dice})
		why[d] = append(why[d], fmt.Sprintf("name %q is close to %q (%.2f)", ix.toolTri.entries[m.entry].text, m.phrase, m.dice))
	}
	sortScored(list)
	rankings["trigram"] = ranksOf(list)
	weights := map[string]float64{"bm25": weightBM25, "trigram": weightTrigram}
	maxFused := (weightBM25 + weightTrigram) / (rrfK + 1)
	fused := fuse(rankings, weights)

	var out []ToolHit
	pos := map[string]int{}
	get := func(id string) *ToolHit {
		if i, ok := pos[id]; ok {
			return &out[i]
		}
		h := ToolHit{ID: id}
		if i, ok := ix.toolByID[id]; ok {
			t := ix.tools[i]
			h.Tool = &t
		} else {
			h.Missing = true
		}
		pos[id] = len(out)
		out = append(out, h)
		return &out[len(out)-1]
	}
	for _, th := range types {
		for _, id := range th.Type.Tools {
			h := get(id)
			h.Via = append(h.Via, "type:"+th.Type.ID)
		}
	}
	for i, f := range fused {
		if i >= top {
			break
		}
		h := get(ix.tools[f.doc].ID)
		h.Via = append(h.Via, "direct")
		h.Score = round3(f.score / maxFused)
		h.Reasons = why[f.doc]
	}
	return out
}

func bm25Reason(h bm25Hit) string {
	ts := append([]termHit(nil), h.terms...)
	sort.Slice(ts, func(i, j int) bool {
		if ts[i].contrib != ts[j].contrib {
			return ts[i].contrib > ts[j].contrib
		}
		return ts[i].term < ts[j].term
	})
	if len(ts) > 4 {
		ts = ts[:4]
	}
	parts := make([]string, len(ts))
	for i, t := range ts {
		parts[i] = fmt.Sprintf("%q in %s", strings.ReplaceAll(t.term, "_", " "), strings.Join(t.fields, ", "))
	}
	return "words " + strings.Join(parts, "; ")
}

func set(xs []string) map[string]bool {
	m := make(map[string]bool, len(xs))
	for _, x := range xs {
		m[x] = true
	}
	return m
}

func overlap(xs []string, s map[string]bool) []string {
	var out []string
	for _, x := range uniq(xs) {
		if s[x] {
			out = append(out, x)
		}
	}
	return out
}

func cosine(a, b []float32) float64 {
	if len(a) != len(b) || len(a) == 0 {
		return 0
	}
	var dot, na, nb float64
	for i := range a {
		dot += float64(a[i]) * float64(b[i])
		na += float64(a[i]) * float64(a[i])
		nb += float64(b[i]) * float64(b[i])
	}
	if na == 0 || nb == 0 {
		return 0
	}
	return dot / math.Sqrt(na*nb)
}

// editRatio is 1 − (optimal-string-alignment distance / longer length) for two squashed names of at
// least 5 letters whose lengths differ by at most 2; otherwise 0. It rescues typos that trigrams punish.
func editRatio(a, b string) float64 {
	ra, rb := []rune(a), []rune(b)
	la, lb := len(ra), len(rb)
	if la < 5 || lb < 5 || la-lb > 2 || lb-la > 2 {
		return 0
	}
	prev2 := make([]int, lb+1)
	prev := make([]int, lb+1)
	cur := make([]int, lb+1)
	for j := range prev {
		prev[j] = j
	}
	for i := 1; i <= la; i++ {
		cur[0] = i
		for j := 1; j <= lb; j++ {
			cost := 1
			if ra[i-1] == rb[j-1] {
				cost = 0
			}
			cur[j] = min(prev[j]+1, cur[j-1]+1, prev[j-1]+cost)
			if i > 1 && j > 1 && ra[i-1] == rb[j-2] && ra[i-2] == rb[j-1] {
				cur[j] = min(cur[j], prev2[j-2]+1)
			}
		}
		prev2, prev, cur = prev, cur, prev2
	}
	return 1 - float64(prev[lb])/float64(max(la, lb))
}

func round3(x float64) float64 { return math.Round(x*1000) / 1000 }
