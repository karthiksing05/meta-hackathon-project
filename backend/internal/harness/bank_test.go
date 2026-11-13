package harness

import (
	"context"
	"os"
	"strings"
	"testing"
)

func TestRawBankKey(t *testing.T) {
	cases := []struct{ req, topic, cat string }{
		{"Harry Potter rare-answer game: name a Hogwarts student", "Harry Potter", "Hogwarts student"},
		{"name a Harry Potter spell", "", "Harry Potter spell"},
		{"krillion: name a Greek god", "", "Greek god"},
		{"name a character from Star Wars", "Star Wars", "character"},
	}
	for _, c := range cases {
		k := RawBankKey(c.req, nil)
		if k.Topic != c.topic || k.Category != c.cat {
			t.Errorf("%q: got topic %q category %q, want %q %q", c.req, k.Topic, k.Category, c.topic, c.cat)
		}
		if !LooksLikeBank(c.req) {
			t.Errorf("%q should look like a bank request", c.req)
		}
	}
	if LooksLikeBank("a cozy farming game") {
		t.Error("a farming game is not a bank request")
	}
}

func TestListNamesAndTiers(t *testing.T) {
	doc := `<h2>Students</h2><ul><li><b><a href="/wiki/Hermione">Hermione Granger</a></b> – a Gryffindor student</li>
<li><a href="/wiki/Neville">Neville Longbottom</a>, a Gryffindor</li><li>Luna Lovegood (Ravenclaw)</li></ul>
<h2>References</h2><p>Hermione Granger Hermione Granger Neville Longbottom Granger</p>`
	names, text := ListNames(doc)
	got := strings.Join(names, "|")
	for _, want := range []string{"Hermione Granger", "Neville Longbottom", "Luna Lovegood", "Students"} {
		if !strings.Contains(got, want) {
			t.Errorf("missing %q in %q", want, got)
		}
	}
	if strings.Contains(got, "References") {
		t.Errorf("kept a section title: %q", got)
	}
	cands := countNames(names, []string{" " + Fold(text) + " "})
	if cands[0].Name != "Hermione Granger" {
		t.Errorf("most mentioned first, got %+v", cands)
	}
	tiers := addAliases(tierByMentions(cands))
	if !strings.HasPrefix(tiers["common"][0], "Hermione Granger=Hermione=Granger") {
		t.Errorf("aliases: %v", tiers)
	}
	b := &AnswerBank{Tiers: tiers}
	if strings.Count(b.TALine(), "|") != 3 {
		t.Errorf("ta line: %q", b.TALine())
	}
}

func TestRebalanceFillsEveryTier(t *testing.T) {
	in := map[string][]string{"common": {"a", "b", "c"}, "uncommon": {"d", "e", "f", "g"}, "rare": {"h", "i", "j"}}
	out := rebalance(in)
	for _, tr := range BankTiers {
		if len(out[tr]) == 0 {
			t.Errorf("tier %s empty: %v", tr, out)
		}
	}
	if out["common"][0] != "a" || out["legendary"][len(out["legendary"])-1] != "j" {
		t.Errorf("order not kept: %v", out)
	}
	full := map[string][]string{"common": {"a"}, "uncommon": {"b"}, "rare": {"c"}, "legendary": {"d"}}
	if got := rebalance(full); got["legendary"][0] != "d" {
		t.Errorf("a full set changed: %v", got)
	}
}

func TestNeedsBank(t *testing.T) {
	if ok, _ := NeedsBank(&Plan{TypeIDs: []string{"rare_answer_daily"}}, nil); !ok {
		t.Error("rare_answer type needs a bank")
	}
	if ok, _ := NeedsBank(&Plan{ToolIDs: []string{"typed_answer"}}, nil); !ok {
		t.Error("typed_answer needs a bank")
	}
	if ok, _ := NeedsBank(&Plan{TypeIDs: []string{"endless_runner"}, ToolIDs: []string{"lanes"}}, nil); ok {
		t.Error("a runner needs no bank")
	}
}

// HARNESS_LIVE_BANK=1 reads the real Wikipedia pages (no Muse: tiers come from mentions).
func TestBankLive(t *testing.T) {
	if os.Getenv("HARNESS_LIVE_BANK") == "" {
		t.Skip("set HARNESS_LIVE_BANK=1")
	}
	l := NewLookup(nil)
	b, st := l.Bank(context.Background(), RawBankKey("Harry Potter rare-answer game: name a Hogwarts student", nil), "name a Hogwarts student")
	t.Logf("stats %+v", st)
	if b == nil {
		t.Fatal("no bank")
	}
	for _, tr := range BankTiers {
		t.Logf("%s (%d): %s", tr, len(b.Tiers[tr]), strings.Join(b.Tiers[tr][:min(12, len(b.Tiers[tr]))], ", "))
	}
}
