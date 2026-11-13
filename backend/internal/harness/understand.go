package harness

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strings"
)

// Understanding is step 1's answer: the request turned into fields the index can match. Verbs, inputs and
// families use the catalog's own vocabulary.
type Understanding struct {
	NamedRefs   []string `json:"named_refs"`   // games, apps or sites the request names ("Krillion", "Subway Surfers")
	Verbs       []string `json:"verbs"`        // what the player does, from the catalog's verbs
	Inputs      []string `json:"inputs"`       // how the player does it, from the catalog's inputs
	Families    []string `json:"families"`     // the catalog families it belongs to
	Theme       []string `json:"theme"`        // what it should look and feel like ("Harry Potter", "Hogwarts")
	Keywords    []string `json:"keywords"`     // other words that describe the mechanic
	Players     string   `json:"players"`      // solo, pass_and_play, async_friends, group_daily, live
	UnknownRefs []string `json:"unknown_refs"` // named refs the model says it doesn't know
}

// Understander turns a free-text request into an Understanding.
type Understander interface {
	Understand(ctx context.Context, request string, vocab Vocab) (Understanding, error)
}

// MuseJSON is one JSON-mode model call: a system and a user message in, one JSON object out. The direct
// HTTP client (MuseClient) implements it; so can a call routed through the generator.
type MuseJSON interface {
	JSON(ctx context.Context, system, user string) (json.RawMessage, error)
}

// ---- Muse-backed understanding ----

// MuseUnderstander asks Muse (Spark) to read the request, constrained to the catalog's vocabulary.
type MuseUnderstander struct {
	Muse MuseJSON
}

const understandSystem = `You read one request for a tiny mobile game and turn it into search fields for a catalog of game mechanics.
Reply with one JSON object and nothing else:
{"named_refs": [], "verbs": [], "inputs": [], "families": [], "theme": [], "keywords": [], "players": "solo", "unknown_refs": []}

- named_refs: every existing game, app, show-format or website the request names or compares to, as written ("Krillion", "Subway Surfers", "Wordle"). Not themes.
- verbs, inputs, families: ONLY words from the vocabulary lists below; pick what the requested game's play needs (1-4 verbs, 1-2 inputs, 1-3 families). If a named game is known to you, describe ITS mechanic.
- theme: the setting, franchise, characters or look ("Harry Potter", "Hogwarts", "space"). Theme never changes the mechanic.
- keywords: 2-6 short phrases describing the mechanic in plain words ("rare answer", "lane runner", "typed answer"); for a named game you know, its core mechanic.
- players: one of solo, pass_and_play, async_friends, group_daily, live.
- unknown_refs: named_refs you do not confidently know as games. Be honest: if you are not sure what a name is, list it here and do not guess its mechanic.`

// Understand implements Understander.
func (m MuseUnderstander) Understand(ctx context.Context, request string, vocab Vocab) (Understanding, error) {
	if m.Muse == nil {
		return Understanding{}, fmt.Errorf("harness: no Muse client")
	}
	user := fmt.Sprintf("Vocabulary\nfamilies: %s\nverbs: %s\ninputs: %s\n\nRequest: %s",
		strings.Join(vocab.Families, ", "), strings.Join(vocab.Verbs, ", "), strings.Join(vocab.Inputs, ", "), request)
	raw, err := m.Muse.JSON(ctx, understandSystem, user)
	if err != nil {
		return Understanding{}, err
	}
	var u Understanding
	if err := json.Unmarshal(raw, &u); err != nil {
		return Understanding{}, fmt.Errorf("harness: understanding reply: %w", err)
	}
	return u.clean(vocab), nil
}

// clean keeps verbs, inputs and families inside the vocabulary (folding case and simple variants), and
// dedupes every list, so the facet scorer only ever sees catalog words.
func (u Understanding) clean(v Vocab) Understanding {
	u.Verbs = constrain(u.Verbs, v.Verbs)
	u.Inputs = constrain(u.Inputs, v.Inputs)
	u.Families = constrain(u.Families, v.Families)
	u.NamedRefs = uniq(u.NamedRefs)
	u.Theme = uniq(u.Theme)
	u.Keywords = uniq(u.Keywords)
	u.UnknownRefs = uniq(u.UnknownRefs)
	if u.Players == "" {
		u.Players = "solo"
	}
	u.ensureSlices()
	return u
}

func (u *Understanding) ensureSlices() {
	for _, p := range []*[]string{&u.NamedRefs, &u.Verbs, &u.Inputs, &u.Families, &u.Theme, &u.Keywords, &u.UnknownRefs} {
		if *p == nil {
			*p = []string{}
		}
	}
}

func constrain(xs, vocab []string) []string {
	if len(vocab) == 0 {
		return uniq(xs)
	}
	byKey := map[string]string{}
	for _, w := range vocab {
		byKey[vocabKey(w)] = w
	}
	var out []string
	for _, x := range xs {
		if w, ok := byKey[vocabKey(x)]; ok {
			out = append(out, w)
		}
	}
	return uniq(out)
}

func vocabKey(s string) string {
	return strings.Join(stemSeq(strings.Fields(Fold(strings.ReplaceAll(s, "_", " ")))), " ")
}

// ---- keyword fallback ----

// KeywordUnderstander needs no model: it spots vocabulary words in the request, reads "like X", "X style",
// "make X" and "in X" patterns for named refs and themes, and keeps the rest as keywords. It is the
// offline and test understander, and the fallback when Muse fails.
type KeywordUnderstander struct{}

var (
	reLike    = regexp.MustCompile(`(?i)\b(?:like|similar to|inspired by|a version of|clone of|based on)\s+([a-z0-9][\w'.&-]*(?:\s+[a-z0-9][\w'.&-]*){0,3}?)(?:\s+(?:but|with|where|in|set|for|and|that)\b|[,.!?;]|$)`)
	reStyle   = regexp.MustCompile(`(?i)\b([a-z0-9][\w'.&-]*(?:\s+[a-z0-9][\w'.&-]*){0,2}?)[\s-]+(?:style|esque|type|clone|inspired)\b`)
	reMake    = regexp.MustCompile(`(?i)^\s*(?:make|play|build|create)\s+(?:me\s+)?(?:a\s+|an\s+)?([a-z0-9][\w'.&-]*(?:\s+[a-z0-9][\w'.&-]*){0,2})\s*[.!?]?\s*$`)
	reTheme   = regexp.MustCompile(`(?i)\b(?:but |set )?in\s+(?:the\s+)?([a-z0-9][\w'&-]*(?:\s+[a-z0-9][\w'&-]*){0,2}?)(?:\s+(?:with|where|and|for|that)\b|[,.!?;]|$)`)
	reThemed  = regexp.MustCompile(`(?i)\b([a-z0-9][\w'&-]*(?:\s+[a-z0-9][\w'&-]*)?)[\s-]+themed\b`)
	reDomain  = regexp.MustCompile(`(?i)\b[a-z0-9][a-z0-9-]*\.(?:com|io|net|org|gg|game|games|app|co|xyz|fun|ai|dev|me|tv)\b`)
	reFriends = regexp.MustCompile(`(?i)\b(friends?|family|group|together|multiplayer|versus|vs|party|team|coworkers|classmates)\b`)
	reDaily   = regexp.MustCompile(`(?i)\b(daily|every day|each day|today'?s)\b`)
	reLive    = regexp.MustCompile(`(?i)\b(live|real[- ]time|same room)\b`)
	rePass    = regexp.MustCompile(`(?i)\b(pass the phone|pass and play|pass-and-play|hot ?seat|one phone)\b`)
)

// Understand implements Understander.
func (KeywordUnderstander) Understand(_ context.Context, request string, vocab Vocab) (Understanding, error) {
	u := Understanding{}
	folded := " " + Fold(strings.ReplaceAll(request, "_", " ")) + " "
	stems := " " + strings.Join(stemSeq(strings.Fields(folded)), " ") + " "

	contains := func(word string) bool {
		k := " " + vocabKey(word) + " "
		return strings.Contains(stems, k)
	}
	for _, f := range vocab.Families {
		if contains(f) {
			u.Families = append(u.Families, f)
		}
	}
	for _, v := range vocab.Verbs {
		if contains(v) {
			u.Verbs = append(u.Verbs, v)
		}
	}
	for _, in := range vocab.Inputs {
		if contains(in) {
			u.Inputs = append(u.Inputs, in)
		}
	}

	addRef := func(s string) {
		s = strings.TrimSpace(strings.Trim(s, ".,!?;:'\""))
		if s == "" || IsStopword(Fold(s)) || len(Tokens(s)) == 0 {
			return
		}
		u.NamedRefs = append(u.NamedRefs, s)
	}
	for _, m := range reDomain.FindAllString(request, -1) {
		addRef(m)
	}
	for _, m := range reLike.FindAllStringSubmatch(request, -1) {
		addRef(m[1])
	}
	for _, m := range reStyle.FindAllStringSubmatch(request, -1) {
		addRef(m[1])
	}
	if m := reMake.FindStringSubmatch(request); m != nil && !genericPhrase(m[1], vocab) {
		addRef(m[1])
	}
	for _, m := range reTheme.FindAllStringSubmatch(request, -1) {
		if !genericPhrase(m[1], vocab) {
			u.Theme = append(u.Theme, strings.TrimSpace(m[1]))
		}
	}
	for _, m := range reThemed.FindAllStringSubmatch(request, -1) {
		u.Theme = append(u.Theme, strings.TrimSpace(m[1]))
	}
	// a ref that is also a theme is a theme
	themes := map[string]bool{}
	for _, t := range u.Theme {
		themes[Fold(t)] = true
	}
	refs := u.NamedRefs[:0]
	for _, r := range u.NamedRefs {
		if !themes[Fold(r)] {
			refs = append(refs, r)
		}
	}
	u.NamedRefs = refs

	// keywords: content words not already a vocabulary word, ref or theme word
	used := map[string]bool{}
	for _, s := range append(append(append([]string{}, u.NamedRefs...), u.Theme...), append(append(u.Families, u.Verbs...), u.Inputs...)...) {
		for _, t := range Tokens(strings.ReplaceAll(s, "_", " ")) {
			used[t] = true
		}
	}
	for _, t := range Tokens(request) {
		if !used[t] && len(t) > 2 {
			u.Keywords = append(u.Keywords, t)
		}
	}

	switch {
	case rePass.MatchString(request):
		u.Players = "pass_and_play"
	case reLive.MatchString(request):
		u.Players = "live"
	case reDaily.MatchString(request) && reFriends.MatchString(request):
		u.Players = "group_daily"
	case reFriends.MatchString(request):
		u.Players = "async_friends"
	default:
		u.Players = "solo"
	}
	return u.clean(vocab), nil
}

// genericPhrase is true when every word of s is a vocabulary word or a stopword ("make a word game",
// "in a grid"), i.e. not a name.
func genericPhrase(s string, v Vocab) bool {
	known := map[string]bool{}
	for _, list := range [][]string{v.Families, v.Verbs, v.Inputs} {
		for _, w := range list {
			for _, t := range strings.Fields(vocabKey(w)) {
				known[t] = true
			}
		}
	}
	for _, t := range genericWords {
		known[t] = true
	}
	toks := Tokens(s)
	for _, t := range toks {
		if !known[t] {
			return false
		}
	}
	return true
}

// genericWords are common game-description words that are never a game's name on their own.
var genericWords = stemAll(strings.Fields(`quick fast short simple little tiny small easy hard fun cute calm cozy relaxing
	daily new big round level grid board card puzzle quiz trivia word number math color colour shape time timer
	score point player friend group team way minute second`))

// stemSeq stems folded words in order, dropping stopwords.
func stemSeq(ws []string) []string {
	out := make([]string, 0, len(ws))
	for _, w := range ws {
		if !stopwords[w] {
			out = append(out, Stem(w))
		}
	}
	return out
}

func stemAll(ws []string) []string {
	out := stemSeq(ws)
	sort.Strings(out)
	return out
}
