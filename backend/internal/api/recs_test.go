package api_test

import (
	"fmt"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/karthiksing05/meta-hackathon-project/backend/internal/api"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/auth"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/pkgstore"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/recs"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/store"
)

var sharedEngine *recs.Engine

func serverWithRecs(t *testing.T, enabled bool) *httptest.Server {
	t.Helper()
	pk, err := pkgstore.NewLocal(t.TempDir(), pkgstore.Limits{MaxUploadBytes: 5 << 20, MaxUnpackedBytes: 10 << 20, MaxFileBytes: 5 << 20})
	if err != nil {
		t.Fatal(err)
	}
	opts := api.Options{
		Store: store.NewMemory(), Packages: pk, Signer: auth.NewSigner([]byte(strings.Repeat("k", 32)), time.Minute),
		RefreshTTL: time.Hour, GamesBaseURL: "https://games.example.com", MaxUploadMB: 5,
	}
	if enabled {
		if sharedEngine == nil {
			if sharedEngine, err = recs.New(recs.Options{Runtimes: 2}); err != nil {
				t.Fatal(err)
			}
		}
		opts.Recs = sharedEngine
	}
	ts := httptest.NewServer(api.New(opts).Handler())
	t.Cleanup(ts.Close)
	return ts
}

func publishGames(t *testing.T, ts *httptest.Server, tok string) []string {
	t.Helper()
	specs := []struct{ slug, formula, mood, energy, look string }{
		{"dodge-a", "dodge", "hype", "high", "neon"}, {"time-a", "time", "playful", "medium", "pixel"},
		{"merge-a", "merge", "calm", "low", "paper"}, {"guess-a", "guess", "cozy", "low", "chalk"},
		{"group-a", "group", "calm", "low", "clay"}, {"answer-a", "answer", "playful", "medium", "ink"},
	}
	var ids []string
	for _, s := range specs {
		m := fmt.Sprintf(`{"id":%q,"title":%q,"one_line_rule":"x","formula":%q,"brief":{"mood":[%q],"energy":%q,"competition":"light"},"style":{"look":%q},"structure":{"scope":"everyone"}}`,
			s.slug, "Game "+s.slug, s.formula, s.mood, s.energy, s.look)
		code, g := publish(t, ts.URL, tok, m)
		if code != 201 {
			t.Fatalf("publish %s: %d %v", s.slug, code, g)
		}
		ids = append(ids, g["id"].(string))
	}
	return ids
}

func feedPage(t *testing.T, ts *httptest.Server, tok string, body map[string]any) (int, []map[string]any) {
	t.Helper()
	q := fmt.Sprintf("count=%v", body["count"])
	if sid, ok := body["sessionID"].(string); ok {
		q += "&sessionID=" + sid
	}
	if ex, ok := body["exclude"].(string); ok {
		q += "&exclude=" + ex
	}
	code, out := do(t, "GET", ts.URL+"/v1/feed?"+q, tok, nil, "")
	var items []map[string]any
	for _, it := range out["items"].([]any) {
		items = append(items, it.(map[string]any))
	}
	return code, items
}

func TestRankedFeed(t *testing.T) {
	ts := serverWithRecs(t, true)
	maker := register(t, ts, "maker")
	if code, items := feedPage(t, ts, maker, map[string]any{"count": 3}); code != 200 || len(items) != 0 {
		t.Fatalf("no games yet: %d %v", code, items)
	}
	ids := publishGames(t, ts, maker)
	valid := map[string]bool{}
	for _, id := range ids {
		valid[id] = true
	}

	tok := register(t, ts, "viewer")
	// signed out works too: the recommender's cold-start ranking, nothing remembered, exclude skips games already held
	_, anon := feedPage(t, ts, "", map[string]any{"count": 3})
	if len(anon) != 3 || anon[0]["feedItemID"] == "" {
		t.Fatalf("signed-out feed: %v", anon)
	}
	_, rest := feedPage(t, ts, "", map[string]any{"count": 6, "exclude": fmt.Sprintf("%v,%v", anon[0]["id"], anon[1]["id"])})
	for _, it := range rest {
		if it["id"] == anon[0]["id"] || it["id"] == anon[1]["id"] {
			t.Fatalf("excluded game came back: %v", it)
		}
	}
	code, first := feedPage(t, ts, tok, map[string]any{"count": 4, "sessionID": "s1"})
	if code != 200 || len(first) != 4 {
		t.Fatalf("first page: %d %v", code, first)
	}
	seen := map[string]bool{}
	for _, it := range first {
		g := it
		if !valid[g["id"].(string)] || seen[g["id"].(string)] || it["feedItemID"] == "" || it["reason"] == "" || g["manifestUrl"] == nil {
			t.Fatalf("bad item: %v", it)
		}
		seen[g["id"].(string)] = true
	}
	// the next page in the same session doesn't repeat what was just shown
	_, second := feedPage(t, ts, tok, map[string]any{"count": 2, "sessionID": "s1"})
	if len(second) != 2 {
		t.Fatalf("second page: %v", second)
	}
	for _, it := range second {
		if seen[it["id"].(string)] {
			t.Fatalf("a game came back within the repeat window: %v", it)
		}
	}
	// a bad count is clamped, not rejected
	if code, items := feedPage(t, ts, tok, map[string]any{"count": 500, "sessionID": "s2"}); code != 200 || len(items) == 0 || len(items) > 30 {
		t.Fatalf("clamped count: %d %d", code, len(items))
	}
}

func TestRankingIsOffWithoutTheEngine(t *testing.T) {
	ts := serverWithRecs(t, false)
	tok := register(t, ts, "someone")
	// with ranking off the one feed endpoint still answers, newest first
	maker := register(t, ts, "maker3")
	publishGames(t, ts, maker)
	if code, items := feedPage(t, ts, tok, map[string]any{"count": 3}); code != 200 || len(items) != 3 || items[0]["reason"] != "newest" {
		t.Fatalf("ranking off: %d %v", code, items)
	}
	// events are still stored when ranking is off
	if code, _ := post(t, ts.URL, tok, map[string]any{"events": []any{map[string]any{"gameID": "x", "kind": "share"}}}); code != 202 {
		t.Fatalf("events without the engine: %d", code)
	}
}

// People who finish, replay and save one game and skip another see the first ahead of the second
// on average, and resending events doesn't teach the model twice.
func TestLearningFromEvents(t *testing.T) {
	ts := serverWithRecs(t, true)
	maker := register(t, ts, "maker")
	ids := publishGames(t, ts, maker)
	loved, skipped := ids[2], ids[0]

	var lovedPos, skippedPos, n int
	for u := 0; u < 8; u++ {
		tok := register(t, ts, fmt.Sprintf("fan%d", u))
		var events []any
		for i := 0; i < 12; i++ {
			events = append(events,
				map[string]any{"eventID": fmt.Sprintf("l%d", i), "gameID": loved, "feedItemID": fmt.Sprintf("fl%d", i), "dwellSec": 20, "tookOver": true, "runsFinished": 2, "replays": 2, "saved": true, "floated": true},
				map[string]any{"eventID": fmt.Sprintf("s%d", i), "gameID": skipped, "feedItemID": fmt.Sprintf("fs%d", i), "dwellSec": 0.4})
		}
		for len(events) > 0 { // batches of up to 100
			k := min(len(events), 100)
			if code, out := post(t, ts.URL, tok, map[string]any{"events": events[:k]}); code != 202 {
				t.Fatalf("events: %d %v", code, out)
			}
			events = events[k:]
		}
		// the same events again change nothing
		_, before := do(t, "GET", ts.URL+"/v1/me/recs", tok, nil, "")
		post(t, ts.URL, tok, map[string]any{"events": []any{map[string]any{"eventID": "l0", "gameID": loved, "feedItemID": "fl0", "dwellSec": 20, "tookOver": true, "runsFinished": 2, "saved": true}}})
		_, after := do(t, "GET", ts.URL+"/v1/me/recs", tok, nil, "")
		if fmt.Sprint(before["summary"]) != fmt.Sprint(after["summary"]) {
			t.Fatalf("a resent event taught the model again:\n%v\n%v", before["summary"], after["summary"])
		}
		if pages := after["summary"].(map[string]any)["pages"].(float64); pages < 20 {
			t.Fatalf("the model saw %v pages, want 24", pages)
		}

		_, items := feedPage(t, ts, tok, map[string]any{"count": 6, "sessionID": "x"})
		// the first time each game appears (a game can come back once the repeat window has passed)
		seenLoved, seenSkipped := false, false
		for i, it := range items {
			switch it["id"] {
			case loved:
				if !seenLoved {
					lovedPos, seenLoved = lovedPos+i, true
				}
			case skipped:
				if !seenSkipped {
					skippedPos, seenSkipped = skippedPos+i, true
				}
			}
		}
		n++
	}
	if lovedPos >= skippedPos {
		t.Fatalf("across %d people the loved game should come earlier than the skipped one: positions %d vs %d", n, lovedPos, skippedPos)
	}
}

func TestBlend(t *testing.T) {
	ts := serverWithRecs(t, true)
	maker := register(t, ts, "maker")
	publishGames(t, ts, maker)
	tok := register(t, ts, "host")
	_, me := do(t, "GET", ts.URL+"/v1/auth/me", tok, nil, "")
	meID := me["id"].(string)

	body := map[string]any{
		"group": map[string]any{"id": "grp1", "name": "New in SF"},
		"count": 3,
		"members": []any{
			map[string]any{"userID": meID, "name": "You"},
			map[string]any{"userID": "maya", "name": "Maya", "isFriend": true, "bio": "coffee walks and trivia", "skill": map[string]any{"overall": 0.6}},
			map[string]any{"userID": "diego", "name": "Diego"},
		},
	}
	code, out := do(t, "POST", ts.URL+"/v1/blend", tok, js(body), "application/json")
	if code != 200 {
		t.Fatalf("blend: %d %v", code, out)
	}
	picks := out["picks"].([]any)
	if len(picks) != 3 {
		t.Fatalf("picks: %v", picks)
	}
	p0 := picks[0].(map[string]any)
	if p0["label"] == nil || p0["why"] == nil || p0["game"].(map[string]any)["manifestUrl"] == nil {
		t.Fatalf("pick: %v", p0)
	}
	if spec, _ := out["spec"].(map[string]any); spec == nil || spec["prompt"] == nil {
		t.Fatalf("spec: %v", out["spec"])
	}

	// the person asking has to be one of the members, and the group can't be huge
	body["members"] = body["members"].([]any)[1:]
	if code, _ := do(t, "POST", ts.URL+"/v1/blend", tok, js(body), "application/json"); code != 400 {
		t.Fatalf("missing self: %d", code)
	}
	var many []any
	for i := 0; i < 13; i++ {
		many = append(many, map[string]any{"userID": fmt.Sprintf("m%d", i)})
	}
	body["members"] = many
	if code, _ := do(t, "POST", ts.URL+"/v1/blend", tok, js(body), "application/json"); code != 400 {
		t.Fatalf("too many members: %d", code)
	}
}

// A signed-in search keeps text relevance first but moves games the person has loved up, using the
// recommender; signed out, or with ranking off, the order is the plain text-match order.
func TestSearchUsesTheRecommender(t *testing.T) {
	ts := serverWithRecs(t, true)
	maker := register(t, ts, "maker")
	ids := publishGames(t, ts, maker) // published in order, so the first is the oldest
	oldest := ids[0]

	_, anon := do(t, "GET", ts.URL+"/v1/search?q=game", "", nil, "")
	items := anon["items"].([]any)
	if anon["personalized"] != false || len(items) != 6 || items[5].(map[string]any)["id"] != oldest {
		t.Fatalf("signed out: the oldest game is last in text order (newest first), personalized false: %v", anon)
	}

	total := 0
	for u := 0; u < 8; u++ {
		tok := register(t, ts, fmt.Sprintf("searcher%d", u))
		var events []any
		for i := 0; i < 12; i++ {
			events = append(events, map[string]any{"eventID": fmt.Sprintf("e%d", i), "gameID": oldest, "feedItemID": fmt.Sprintf("f%d", i),
				"dwellSec": 20, "tookOver": true, "runsFinished": 2, "replays": 2, "saved": true, "floated": true})
		}
		post(t, ts.URL, tok, map[string]any{"events": events})
		_, res := do(t, "GET", ts.URL+"/v1/search?q=game", tok, nil, "")
		if res["personalized"] != true {
			t.Fatalf("signed in should be personalized: %v", res)
		}
		list := res["items"].([]any)
		if len(list) != 6 {
			t.Fatalf("every match is still returned: %v", list)
		}
		for i, it := range list {
			if it.(map[string]any)["id"] == oldest {
				total += i
			}
		}
	}
	if total >= 8*5 {
		t.Fatalf("the loved game should move up from last place (5) on average, positions summed to %d over 8 people", total)
	}

	// paging past the reordered pool still works, and a search that matches nothing is empty, not an error
	tok := register(t, ts, "pager")
	if _, res := do(t, "GET", ts.URL+"/v1/search?q=zzzz", tok, nil, ""); len(res["items"].([]any)) != 0 {
		t.Fatalf("no matches: %v", res)
	}
	_, p1 := do(t, "GET", ts.URL+"/v1/search?q=game&limit=2", tok, nil, "")
	if p1["nextCursor"] != "2" || len(p1["items"].([]any)) != 2 {
		t.Fatalf("page 1: %v", p1)
	}
	if _, p2 := do(t, "GET", ts.URL+"/v1/search?q=game&limit=2&cursor=2", tok, nil, ""); len(p2["items"].([]any)) != 2 {
		t.Fatalf("page 2: %v", p2)
	}

	off := serverWithRecs(t, false)
	mt := register(t, off, "maker2")
	publishGames(t, off, mt)
	if _, res := do(t, "GET", off.URL+"/v1/search?q=game", register(t, off, "viewer2"), nil, ""); res["personalized"] != false {
		t.Fatalf("with ranking off the order is plain: %v", res)
	}
}

// A page never shows one game twice, even when the catalog has only one game.
func TestFeedNeverRepeatsAGameOnAPage(t *testing.T) {
	ts := serverWithRecs(t, true)
	maker := register(t, ts, "maker")
	if code, out := publish(t, ts.URL, maker, `{"id":"only-game","title":"Only","one_line_rule":"x","formula":"guess","brief":{"mood":["cozy"]}}`); code != 201 {
		t.Fatalf("publish: %d %v", code, out)
	}
	viewer := register(t, ts, "viewer")
	for _, tok := range []string{"", viewer} {
		_, items := feedPage(t, ts, tok, map[string]any{"count": 10, "sessionID": "s1"})
		seen := map[any]bool{}
		for _, it := range items {
			if seen[it["id"]] {
				t.Fatalf("a game came twice on one page (%d items): %v", len(items), items)
			}
			seen[it["id"]] = true
		}
		if len(items) != 1 {
			t.Fatalf("one game, one item: %d", len(items))
		}
	}
}
