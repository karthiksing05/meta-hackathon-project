package harness

import (
	"sort"
	"strings"
)

// A small synonym table for the controlled vocabulary, so the no-model path (the keyword understander and
// the BM25 query) can bridge everyday words to catalog words: "obscure answers" → rare, "doodle" → draw.
// Muse doesn't need it (it answers in the vocabulary already). Each group is a set of interchangeable
// phrases; a phrase may be several words.
var synonymGroups = [][]string{
	{"rare", "rarest", "obscure", "uncommon", "least popular", "unpopular", "unusual", "niche", "rarity"},
	{"guess", "predict", "estimate", "hunch"},
	{"trivia", "quiz", "questions", "pub quiz"},
	{"type", "typing", "typed", "keyboard"},
	{"draw", "sketch", "doodle", "paint", "scribble"},
	{"memory", "remember", "memorize", "recall"},
	{"match", "pair", "matching"},
	{"stack", "pile", "stacking"},
	{"shoot", "blast", "fire at", "shooter"},
	{"catch", "collect", "grab", "gather", "scoop"},
	{"jump", "hop", "leap"},
	{"dodge", "avoid", "evade"},
	{"runner", "endless runner", "dash"},
	{"tap", "click", "press", "poke"},
	{"swipe", "flick"},
	{"drag", "pull"},
	{"tilt", "lean", "gyro"},
	{"puzzle", "brainteaser", "brain teaser", "riddle"},
	{"calm", "cozy", "relaxing", "chill", "peaceful", "soothing"},
	{"horror", "scary", "spooky", "creepy", "haunted"},
	{"story", "narrative", "tale", "choose your own adventure", "branching"},
	{"daily", "every day", "each day", "once a day"},
	{"rhythm", "beat", "music", "song", "tempo"},
	{"duel", "battle", "fight", "combat", "versus"},
	{"cook", "cooking", "kitchen", "recipe", "bake"},
	{"pet", "nurture", "care for", "virtual pet", "tamagotchi"},
	{"math", "arithmetic", "numbers", "sums", "equation"},
	{"word", "words", "vocabulary"},
	{"bluff", "deceive", "fib"},
	{"deduce", "deduction", "logic", "detective", "sleuth"},
	{"aim", "throw", "toss", "fling", "launch"},
	{"race", "racing", "speed run"},
	{"build", "construct", "craft"},
	{"sort", "sorting", "categorize", "organize"},
	{"friends", "group chat", "squad"},
	{"vote", "poll", "rank"},
}

// synonymIndex maps a stemmed term (a word, or words joined by "_") to the other members of its groups,
// as stemmed terms.
var synonymIndex = func() map[string][]string {
	idx := map[string]map[string]bool{}
	for _, g := range synonymGroups {
		terms := make([]string, 0, len(g))
		for _, p := range g {
			if t := synonymTerm(p); t != "" {
				terms = append(terms, t)
			}
		}
		for _, a := range terms {
			if idx[a] == nil {
				idx[a] = map[string]bool{}
			}
			for _, b := range terms {
				if a != b {
					idx[a][b] = true
				}
			}
		}
	}
	out := make(map[string][]string, len(idx))
	for k, m := range idx {
		out[k] = sortedKeys(m)
	}
	return out
}()

// synonymTerm is a phrase's stemmed form: one token, or tokens joined by "_" (the bigram form the index
// uses; longer phrases keep their first two content words).
func synonymTerm(p string) string {
	toks := Tokens(p)
	switch {
	case len(toks) == 0:
		return ""
	case len(toks) == 1:
		return toks[0]
	default:
		return toks[0] + "_" + toks[1]
	}
}

// Synonyms returns the stemmed terms that are synonyms of a stemmed term (nil if none).
func Synonyms(term string) []string { return synonymIndex[term] }

// expandSynonyms returns the synonyms of every term in terms that aren't already in terms, sorted.
func expandSynonyms(terms []string) []string {
	have := map[string]bool{}
	for _, t := range terms {
		have[t] = true
	}
	add := map[string]bool{}
	for _, t := range terms {
		for _, s := range synonymIndex[t] {
			if !have[s] {
				add[s] = true
			}
		}
	}
	out := make([]string, 0, len(add))
	for s := range add {
		out = append(out, s)
	}
	sort.Strings(out)
	return out
}

// synonymText is the request's stemmed words plus their synonyms (bigram synonyms spelled with spaces),
// for the keyword understander's vocabulary matching.
func synonymText(request string) string {
	terms := TermsWithBigrams(request)
	parts := append([]string{}, Tokens(request)...)
	for _, s := range expandSynonyms(terms) {
		parts = append(parts, strings.ReplaceAll(s, "_", " "))
	}
	return " " + strings.Join(parts, " ") + " "
}
