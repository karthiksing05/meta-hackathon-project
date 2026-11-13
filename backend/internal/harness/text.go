package harness

import (
	"strings"
	"unicode"
)

// Text normalization shared by the index and the queries, so both sides fold the same way:
// lowercase, accents folded, punctuation to spaces, and a light stem (plurals, -ing, -ed).

// accentFold maps common accented Latin letters to their base letter (stdlib has no NFD).
var accentFold = map[rune]string{
	'à': "a", 'á': "a", 'â': "a", 'ã': "a", 'ä': "a", 'å': "a", 'ā': "a", 'ă': "a", 'ą': "a",
	'æ': "ae", 'ç': "c", 'ć': "c", 'č': "c", 'ď': "d", 'đ': "d", 'ð': "d",
	'è': "e", 'é': "e", 'ê': "e", 'ë': "e", 'ē': "e", 'ė': "e", 'ę': "e", 'ě': "e",
	'ğ': "g", 'ì': "i", 'í': "i", 'î': "i", 'ï': "i", 'ī': "i", 'į': "i", 'ı': "i",
	'ł': "l", 'ñ': "n", 'ń': "n", 'ň': "n",
	'ò': "o", 'ó': "o", 'ô': "o", 'õ': "o", 'ö': "o", 'ø': "o", 'ō': "o", 'ő': "o", 'œ': "oe",
	'ř': "r", 'ś': "s", 'š': "s", 'ş': "s", 'ß': "ss", 'ť': "t", 'ţ': "t", 'þ': "th",
	'ù': "u", 'ú': "u", 'û': "u", 'ü': "u", 'ū': "u", 'ů': "u", 'ű': "u", 'ų': "u",
	'ý': "y", 'ÿ': "y", 'ź': "z", 'ż': "z", 'ž': "z",
}

// Fold lowercases s, folds accents, drops apostrophes and turns every other non-letter, non-digit
// into a space, then collapses spaces. "Pokémon-style!" → "pokemon style"; "Don't" → "dont".
func Fold(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	space := true
	for _, r := range strings.ToLower(s) {
		if f, ok := accentFold[r]; ok {
			b.WriteString(f)
			space = false
			continue
		}
		switch {
		case r == '\'' || r == '’' || r == '`':
			// "don't" → "dont"
		case unicode.IsLetter(r) || unicode.IsDigit(r):
			b.WriteRune(r)
			space = false
		default:
			if !space {
				b.WriteByte(' ')
				space = true
			}
		}
	}
	return strings.TrimSpace(b.String())
}

// stopwords carry no meaning for matching a game request.
var stopwords = map[string]bool{
	"a": true, "an": true, "the": true, "and": true, "or": true, "but": true, "of": true, "in": true, "on": true,
	"at": true, "to": true, "for": true, "with": true, "by": true, "from": true, "into": true, "as": true,
	"is": true, "are": true, "be": true, "it": true, "its": true, "this": true, "that": true, "these": true,
	"i": true, "me": true, "my": true, "we": true, "our": true, "you": true, "your": true, "some": true,
	"make": true, "made": true, "making": true, "create": true, "build": true, "want": true, "please": true,
	"game": true, "games": true, "like": true, "style": true, "kind": true, "sort": true,
	"where": true, "which": true, "who": true, "what": true, "so": true, "very": true, "just": true, "can": true,
	"let": true, "lets": true, "us": true, "get": true, "one": true, "about": true, "something": true,
}

// IsStopword reports whether a folded token is a stopword.
func IsStopword(tok string) bool { return stopwords[tok] }

// Stem folds plurals and the commonest English suffixes. It is deliberately light: it only has to make
// "matches"/"matching"/"match" and "races"/"racing"/"race" meet, and must never merge unrelated words.
// Both the index and the queries stem the same way, so the stem need not be a real word.
func Stem(w string) string {
	n := len(w)
	if n <= 3 || !isASCIIWord(w) {
		return w
	}
	switch {
	case strings.HasSuffix(w, "ies") && n > 4:
		return w[:n-3] + "y"
	case strings.HasSuffix(w, "sses"), strings.HasSuffix(w, "shes"), strings.HasSuffix(w, "ches"), strings.HasSuffix(w, "xes"), strings.HasSuffix(w, "zzes"):
		return w[:n-2]
	case strings.HasSuffix(w, "ss"), strings.HasSuffix(w, "us"), strings.HasSuffix(w, "is"):
		return w
	case strings.HasSuffix(w, "s"):
		w = w[:n-1]
	case strings.HasSuffix(w, "ing") && n > 5 && hasVowel(w[:n-3]):
		w = undouble(w[:n-3])
	case strings.HasSuffix(w, "ed") && !strings.HasSuffix(w, "eed") && n > 4 && hasVowel(w[:n-2]):
		w = undouble(w[:n-2])
	}
	if len(w) >= 4 && w[len(w)-1] == 'e' {
		w = w[:len(w)-1]
	}
	return w
}

func hasVowel(w string) bool { return strings.ContainsAny(w, "aeiouy") }

// undouble turns "runn" → "run", "stopp" → "stop" (but leaves "fall", "pass", "buzz").
func undouble(w string) string {
	n := len(w)
	if n >= 3 && w[n-1] == w[n-2] && !strings.ContainsRune("lsz", rune(w[n-1])) && !strings.ContainsRune("aeiou", rune(w[n-1])) {
		return w[:n-1]
	}
	return w
}

func isASCIIWord(w string) bool {
	for i := 0; i < len(w); i++ {
		if w[i] < 'a' || w[i] > 'z' {
			return false
		}
	}
	return true
}

// Tokens folds s and returns its stemmed, non-stopword tokens in order.
func Tokens(s string) []string {
	f := Fold(s)
	if f == "" {
		return nil
	}
	parts := strings.Fields(f)
	out := parts[:0]
	for _, p := range parts {
		if stopwords[p] {
			continue
		}
		out = append(out, Stem(p))
	}
	return out
}

// TermsWithBigrams is Tokens plus each adjacent pair joined by "_", so phrases such as "subway surfers"
// or "word search" score above their separate words.
func TermsWithBigrams(s string) []string {
	toks := Tokens(s)
	out := make([]string, 0, 2*len(toks))
	out = append(out, toks...)
	for i := 0; i+1 < len(toks); i++ {
		out = append(out, toks[i]+"_"+toks[i+1])
	}
	return out
}

// Squash is the folded form with no spaces at all, used for exact name and alias hits ("Subway-Surfers"
// and "subwaysurfers" both squash to "subwaysurfers").
func Squash(s string) string { return strings.ReplaceAll(Fold(s), " ", "") }

// Trigrams returns the set of character trigrams of the folded, space-padded string. "krillion" →
// {" kr", "kri", "ril", "ill", "lli", "lio", "ion", "on "}. Spaces between words are kept so phrases have
// word-boundary trigrams too.
func Trigrams(s string) map[string]struct{} {
	f := Fold(s)
	if f == "" {
		return nil
	}
	r := []rune(" " + f + " ")
	set := make(map[string]struct{}, len(r))
	for i := 0; i+3 <= len(r); i++ {
		set[string(r[i:i+3])] = struct{}{}
	}
	return set
}

// Dice is the Sørensen–Dice coefficient of two trigram sets, 0..1.
func Dice(a, b map[string]struct{}) float64 {
	if len(a) == 0 || len(b) == 0 {
		return 0
	}
	if len(a) > len(b) {
		a, b = b, a
	}
	n := 0
	for g := range a {
		if _, ok := b[g]; ok {
			n++
		}
	}
	return 2 * float64(n) / float64(len(a)+len(b))
}

// uniq keeps the first occurrence of each string, dropping empties.
func uniq(in []string) []string {
	seen := make(map[string]bool, len(in))
	out := make([]string, 0, len(in))
	for _, s := range in {
		s = strings.TrimSpace(s)
		if s == "" || seen[s] {
			continue
		}
		seen[s] = true
		out = append(out, s)
	}
	return out
}
