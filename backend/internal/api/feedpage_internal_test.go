package api

import (
	"fmt"
	"testing"
	"time"

	"github.com/karthiksing05/meta-hackathon-project/backend/internal/model"
)

func game(id, slug, title string, ageMin int, edit func(*model.Game)) model.Game {
	g := model.Game{ID: id, Slug: slug, Title: title, Formula: "microgame", CreatedAt: time.Date(2026, 11, 13, 12, 0, 0, 0, time.UTC).Add(-time.Duration(ageMin) * time.Minute)}
	if edit != nil {
		edit(&g)
	}
	return g
}

// The families seen on Prod on 2026-11-13: a base game and its Group copies (slug plus a Group suffix), a remix,
// a same-titled variant, and a sponsored game whose Group copy is not sponsored.
func prodLikeGames() []model.Game {
	return []model.Game{
		game("beast", "mg-mr-beast-brainrot-trivia-6jsk", "Mr. Beast Brainrot Trivia", 300, nil),
		game("beast-ct", "mg-mr-beast-brainrot-trivia-6jsk-closer-together-26-20261113", "Mr. Beast Brainrot Trivia", 30, func(g *model.Game) { g.GroupID = "group-ct" }),
		game("beast-sf", "mg-mr-beast-brainrot-trivia-6jsk-newinsf", "Mr. Beast Brainrot Trivia", 31, func(g *model.Game) { g.GroupID = "group-sf" }),
		game("fog", "mg-fog-over-the-bay-kedv", "Fog Over the Bay", 500, nil),
		game("fog-remix", "mg-fog-over-the-bay-smkd", "Fog over the bay!", 490, func(g *model.Game) { g.RemixOf = "fog" }),
		game("decade-1", "mg-guess-the-decade-mc4v", "Guess the Decade", 400, nil),
		game("decade-2", "mg-guess-the-decade-mc4v-newinsf", "Guess the Decade", 20, nil),
		game("guac", "mg-extra-guac-no-charge-wpm9", "Extra Guac, No Charge", 200, func(g *model.Game) { g.Sponsor = &model.Sponsor{Name: "Chipotle"} }),
		game("guac-lab", "mg-extra-guac-no-charge-wpm9-harness-lab", "Extra Guac, No Charge", 10, func(g *model.Game) { g.GroupID = "group-lab" }),
		game("solo", "mg-solo-1234", "Solo", 5, nil),
		// a fan's game that shares a title with a brand's ad stays separate from the ad
		game("soda", "brand-soda", "Fizz Run", 60, func(g *model.Game) { g.Sponsor = &model.Sponsor{Name: "Fizz Co"} }),
		game("soda-fan", "fan-soda", "Fizz Run", 3, nil),
	}
}

func TestFamilyBases(t *testing.T) {
	b := familyBases(prodLikeGames())
	want := map[string]string{
		"beast": "beast", "beast-ct": "beast", "beast-sf": "beast",
		"fog": "fog", "fog-remix": "fog",
		"decade-1": "decade-1", "decade-2": "decade-1",
		"guac": "guac", "guac-lab": "guac",
		"solo": "solo", "soda": "soda", "soda-fan": "soda-fan",
	}
	for id, base := range want {
		if b[id] != base {
			t.Errorf("%s: base %q, want %q", id, b[id], base)
		}
	}
	// a remix of a game outside the candidates still joins its siblings
	b = familyBases([]model.Game{
		game("r1", "", "One", 5, func(g *model.Game) { g.RemixOf = "gone" }),
		game("r2", "", "Two", 9, func(g *model.Game) { g.RemixOf = "gone" }),
	})
	if b["r1"] != "r2" || b["r2"] != "r2" {
		t.Fatalf("remixes of a missing game: %v", b)
	}
	// short slugs are never cut down to a shared stem
	b = familyBases([]model.Game{game("a", "dodge-a", "A", 1, nil), game("b", "dodge-a-b", "B", 2, nil)})
	if b["a"] == b["b"] {
		t.Fatalf("short slugs joined: %v", b)
	}
}

func TestBuildPoolPicksTheBestMemberForTheViewer(t *testing.T) {
	games := prodLikeGames()
	byBase := func(p feedPool) map[string]string {
		out := map[string]string{}
		for _, g := range append(append([]model.Game(nil), p.organic...), p.sponsored...) {
			if _, dup := out[p.bases[g.ID]]; dup {
				t.Fatalf("two members of one family: %s", g.ID)
			}
			out[p.bases[g.ID]] = g.ID
		}
		return out
	}
	// a guest: the open game of each family
	guest := byBase(buildPool(games, &socialContext{}, nil, nil))
	if len(guest) != 7 || guest["beast"] != "beast" || guest["guac"] != "guac" || guest["decade-1"] != "decade-1" || guest["fog"] != "fog" {
		t.Fatalf("guest pool: %v", guest)
	}
	// a member of a Group gets that Group's copy; the Group copy of the ad is not sponsored
	sc := &socialContext{me: "me", groups: map[string]bool{"group-sf": true, "group-lab": true}, friends: map[string]bool{"pal": true}}
	member := buildPool(games, sc, nil, nil)
	if got := byBase(member); got["beast"] != "beast-sf" || got["guac"] != "guac-lab" {
		t.Fatalf("member pool: %v", got)
	}
	for _, g := range member.sponsored {
		if g.ID == "guac-lab" {
			t.Fatal("an unsponsored copy counted as an ad")
		}
	}
	// my own version beats a friend's, a friend's beats the open game
	mine := []model.Game{
		game("base", "mg-thing-abcd", "Thing", 100, nil),
		game("friend", "mg-thing-abcd-x", "Thing", 50, func(g *model.Game) { g.OwnerID = "pal" }),
		game("mine", "", "Thing", 40, func(g *model.Game) { g.OwnerID = "me"; g.RemixOf = "base" }),
	}
	if got := byBase(buildPool(mine, sc, nil, nil)); got["base"] != "mine" {
		t.Fatalf("mine first: %v", got)
	}
	if got := byBase(buildPool(mine[:2], sc, nil, nil)); got["base"] != "friend" {
		t.Fatalf("a friend's next: %v", got)
	}
	// a family seen by any member's id, or excluded by any member's id or slug, is gone
	p := buildPool(games, &socialContext{}, map[string]bool{"beast-ct": true}, []string{"mg-fog-over-the-bay-smkd", "solo"})
	got := byBase(p)
	if _, ok := got["beast"]; ok {
		t.Fatalf("a seen family came back: %v", got)
	}
	if _, ok := got["fog"]; ok {
		t.Fatalf("an excluded family (by a member's slug) came back: %v", got)
	}
	if _, ok := got["solo"]; ok {
		t.Fatalf("an excluded game came back: %v", got)
	}
}

func TestPoolOrderIsDeterministic(t *testing.T) {
	at := time.Date(2026, 11, 13, 0, 0, 0, 0, time.UTC)
	var games []model.Game
	for i := 0; i < 20; i++ {
		games = append(games, model.Game{ID: fmt.Sprintf("g%02d", i), Title: fmt.Sprintf("T%d", i), CreatedAt: at}) // all at the same instant
	}
	first := buildPool(games, &socialContext{}, nil, nil).organic
	for i := 0; i < 5; i++ {
		rev := append([]model.Game(nil), games...)
		for a, b := 0, len(rev)-1; a < b; a, b = a+1, b-1 {
			rev[a], rev[b] = rev[b], rev[a]
		}
		again := buildPool(rev, &socialContext{}, nil, nil).organic
		for j := range first {
			if first[j].ID != again[j].ID {
				t.Fatalf("order depends on input order at %d: %s vs %s", j, first[j].ID, again[j].ID)
			}
		}
	}
	if first[0].ID != "g19" || first[19].ID != "g00" {
		t.Fatalf("ties break by id, highest first: %s ... %s", first[0].ID, first[19].ID)
	}
}

func TestAdsSitAtFixedPositions(t *testing.T) {
	org := []string{"o1", "o2", "o3", "o4", "o5", "o6", "o7", "o8", "o9", "o10"}
	ads := []string{"a1", "a2", "a3"}
	// two pages of six from the same session: ads at session positions 4 and 9 only
	p1 := layoutPage(org, ads, 0, 6)
	if fmt.Sprint(p1) != "[o1 o2 o3 o4 a1 o5]" {
		t.Fatalf("page 1: %v", p1)
	}
	p2 := layoutPage(org[5:], ads[1:], 6, 6)
	if fmt.Sprint(p2) != "[o6 o7 o8 a2 o9 o10]" {
		t.Fatalf("page 2: %v", p2)
	}
	// no ad left: the slot takes a regular game
	if p := layoutPage(org[:6], nil, 0, 6); fmt.Sprint(p) != "[o1 o2 o3 o4 o5 o6]" {
		t.Fatalf("no ads: %v", p)
	}
	// regular games run out: the remaining ads fill the end, and the page stops when both are gone
	if p := layoutPage(org[:2], ads, 0, 10); fmt.Sprint(p) != "[o1 o2 a1 a2 a3]" {
		t.Fatalf("tail: %v", p)
	}
	for p := 0; p < 30; p++ {
		if isAdSlot(p) != (p == 4 || p == 9 || p == 14 || p == 19 || p == 24 || p == 29) {
			t.Fatalf("ad slot %d", p)
		}
	}
}

func TestAnonFeedsExpireAndStayBounded(t *testing.T) {
	var a anonFeeds
	now := time.Now()
	a.put("s", anonFeed{seen: []string{"x"}, shown: 1, at: now})
	if f := a.get("s", now.Add(time.Minute)); f.shown != 1 || len(f.seen) != 1 {
		t.Fatalf("kept: %+v", f)
	}
	if f := a.get("s", now.Add(sessionGap+time.Minute)); f.shown != 0 || len(f.seen) != 0 {
		t.Fatalf("expired: %+v", f)
	}
	for i := 0; i < maxAnonFeeds+10; i++ {
		a.put(fmt.Sprint(i), anonFeed{at: now.Add(time.Duration(i) * time.Millisecond)})
	}
	if len(a.m) > maxAnonFeeds {
		t.Fatalf("unbounded: %d", len(a.m))
	}
	seen := appendSeen(nil, "g", "b")
	if fmt.Sprint(seen) != "[g b]" || fmt.Sprint(appendSeen(nil, "g", "g")) != "[g]" {
		t.Fatalf("appendSeen: %v", seen)
	}
}
