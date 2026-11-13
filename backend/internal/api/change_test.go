package api_test

import (
	"encoding/json"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestChangeAGame(t *testing.T) {
	gen := newFakeGenerator(t)
	ts, _ := serverWithGenerator(t, gen.URL, 6)
	maker, other := register(t, ts, "maker"), register(t, ts, "other")

	_, out := startJob(t, ts, maker, map[string]any{"request": "a calm fog game", "brief": map[string]any{"mood": []string{"cozy"}}})
	base := waitJob(t, ts, maker, out["jobId"].(string), "done")["game"].(map[string]any)
	baseID := base["id"].(string)

	// What the generator makes from a change is a new game whose lineage points at the base game.
	gen.mu.Lock()
	gen.manifest = strings.Replace(strings.Replace(fakeManifest, "mg-fog-walk-k3x9", "mg-fog-walk-n7p2", 1), `"formula":"microgame"`,
		`"formula":"microgame","lineage":{"remix_of":"`+baseID+`"},"chain":{"index":2}`, 1)
	gen.mu.Unlock()

	for body, want := range map[string]int{
		`{"baseGameId":"` + baseID + `"}`:                                    400, // nothing to change
		`{"baseGameId":"000000000000000000000000","change":"faster"}`:        404,
		`{"baseGameId":"` + baseID + `","change":"faster","nextLevel":true}`: 202,
	} {
		code, o := do(t, "POST", ts.URL+"/v1/generate", other, strings.NewReader(body), "application/json")
		if code != want {
			t.Fatalf("%s: %d %v", body, code, o)
		}
		if code == 202 { // anyone can remix a public game
			job := waitJob(t, ts, other, o["jobId"].(string), "done")
			g := job["game"].(map[string]any)
			if g["slug"] != "mg-fog-walk-n7p2" || g["remixOf"] != baseID || g["ownerUsername"] != "other" {
				t.Fatalf("the changed game: %v", g)
			}
		}
	}
	// The generator got the base game's own manifest, the change, and the next level; the brief stays the game's.
	last := gen.requests[len(gen.requests)-1]
	for _, want := range []string{`"base":{"id":"mg-fog-walk-k3x9"`, `"remixOf":"` + baseID + `"`, `"level":2`, `"request":"faster Make the next level of this game (level 2)`, `"brief":null`} {
		if !strings.Contains(last, want) {
			t.Fatalf("generator request lacks %s:\n%s", want, last)
		}
	}
	// A game that isn't a microgame can't be changed this way.
	if code, o := publish(t, ts.URL, maker, `{"id":"old-game","title":"Old","one_line_rule":"x","formula":"dodge"}`); code != 201 {
		t.Fatalf("publish: %d %v", code, o)
	} else if code, o := do(t, "POST", ts.URL+"/v1/generate", maker, strings.NewReader(`{"baseGameId":"`+o["id"].(string)+`","change":"x"}`), "application/json"); code != 422 {
		t.Fatalf("changing a classic game: %d %v", code, o)
	}
}

func TestAnatomy(t *testing.T) {
	gen := newFakeGenerator(t)
	ts, _ := serverWithGenerator(t, gen.URL, 6)
	tok := register(t, ts, "maker")

	code, a := do(t, "POST", ts.URL+"/v1/anatomy", tok, js(map[string]any{"request": "a calm fog game", "audience": "friends"}), "application/json")
	if code != 200 || a["anatomy"] != "game-anatomy/0.1" || a["title"] != "Fog Garden" {
		t.Fatalf("anatomy: %d %v", code, a)
	}
	code, r := do(t, "POST", ts.URL+"/v1/anatomy/revise", tok, js(map[string]any{"anatomy": a, "change": "also lose if fog returns", "afterPlaying": true}), "application/json")
	if code != 200 || r["anatomy"] != "game-anatomy/0.1" {
		t.Fatalf("revise: %d %v", code, r)
	}
	if n := len(gen.requests); n != 2 || !strings.HasPrefix(gen.requests[1], "/anatomy/revise ") || !strings.Contains(gen.requests[1], "also lose if fog returns") {
		t.Fatalf("what the generator was sent: %v", gen.requests)
	}
	if code, _ := do(t, "POST", ts.URL+"/v1/anatomy", "", js(map[string]any{"request": "x"}), "application/json"); code != 401 {
		t.Fatalf("signed out: %d", code)
	}
	if code, _ := do(t, "POST", ts.URL+"/v1/anatomy", tok, strings.NewReader(`{not json`), "application/json"); code != 400 {
		t.Fatalf("bad body: %d", code)
	}
	gen.mu.Lock()
	gen.fail = true
	gen.mu.Unlock()
	if code, _ := do(t, "POST", ts.URL+"/v1/anatomy", tok, js(map[string]any{"request": "x"}), "application/json"); code != 502 {
		t.Fatalf("when Muse fails: %d", code)
	}
}

func TestDraftsAnatomyAndBaseManifest(t *testing.T) {
	gen := newFakeGenerator(t)
	ts, _ := serverWithGenerator(t, gen.URL, 20)
	maker, other := register(t, ts, "maker"), register(t, ts, "other")

	_, out := startJob(t, ts, maker, map[string]any{"request": "a calm fog game"})
	baseGame := waitJob(t, ts, maker, out["jobId"].(string), "done")["game"].(map[string]any)
	baseID := baseGame["id"].(string)
	if baseGame["unlisted"] != nil {
		t.Fatalf("a new game is public: %v", baseGame)
	}
	// The feed shows one game per family (a change is in its base game's family) and picks the one that suits the
	// viewer, so ask as the person who made the changes: their own version wins. Each look is a new session.
	looks := 0
	feedIDs := func() map[string]bool {
		looks++
		_, f := do(t, "GET", ts.URL+"/v1/feed?sessionID=look"+strconv.Itoa(looks), other, nil, "")
		ids := map[string]bool{}
		for _, it := range f["items"].([]any) {
			ids[it.(map[string]any)["id"].(string)] = true
		}
		return ids
	}

	gen.mu.Lock()
	gen.manifest = strings.Replace(fakeManifest, "mg-fog-walk-k3x9", "mg-fog-walk-v2", 1)
	gen.mu.Unlock()
	anatomy := "Agreed game anatomy:\n1. " + strings.Repeat("A long rule. ", 400) // far over the 2,000 character request limit
	custom := `{"id":"mg-fog-walk-k3x9","title":"My own title","content":{"authoring_json":"{\"edited\":\"on the phone\"}"}}`
	code, o := do(t, "POST", ts.URL+"/v1/generate", other, js(map[string]any{
		"baseGameId": baseID, "change": "faster", "anatomy": anatomy, "baseManifest": json.RawMessage(custom),
	}), "application/json")
	if code != 202 {
		t.Fatalf("change: %d %v", code, o)
	}
	game := waitJob(t, ts, other, o["jobId"].(string), "done")["game"].(map[string]any)
	last := gen.requests[len(gen.requests)-1]
	for _, want := range []string{`"request":"faster\n\nAgreed game anatomy:`, `"base":{"id":"mg-fog-walk-k3x9","title":"My own title"`, `edited`} {
		if !strings.Contains(last, want) {
			t.Fatalf("generator request lacks %s:\n%.400s", want, last)
		}
	}

	// a change is a draft: not in the feed or search, still reachable by id and in the owner's creations
	if game["unlisted"] != true || feedIDs()[game["id"].(string)] {
		t.Fatalf("a change must be unlisted: %v", game)
	}
	if _, s := do(t, "GET", ts.URL+"/v1/search?q=fog", "", nil, ""); len(s["items"].([]any)) != 1 {
		t.Fatalf("search must hold only the public game: %v", s)
	}
	if code, g := do(t, "GET", ts.URL+"/v1/games/"+game["id"].(string), "", nil, ""); code != 200 || g["unlisted"] != true {
		t.Fatalf("by id: %d %v", code, g)
	}
	if _, mine := do(t, "GET", ts.URL+"/v1/creations", other, nil, ""); len(mine["items"].([]any)) != 1 {
		t.Fatalf("my creations include the draft: %v", mine)
	}
	// only the owner can publish or delete it
	pub := ts.URL + "/v1/creations/" + game["id"].(string)
	if code, _ := do(t, "POST", pub+"/publish", maker, nil, ""); code != 404 {
		t.Fatalf("someone else publishing: %d", code)
	}
	if code, g := do(t, "POST", pub+"/publish", other, nil, ""); code != 200 || g["unlisted"] != nil || !feedIDs()[game["id"].(string)] {
		t.Fatalf("publish: %d %v", code, g)
	}
	if code, _ := do(t, "DELETE", pub, maker, nil, ""); code != 404 {
		t.Fatalf("someone else deleting: %d", code)
	}
	if code, _ := do(t, "DELETE", pub, other, nil, ""); code != 204 {
		t.Fatalf("delete: %d", code)
	}
	if code, _ := do(t, "GET", ts.URL+"/v1/games/"+game["id"].(string), "", nil, ""); code != 404 || feedIDs()[game["id"].(string)] {
		t.Fatalf("after delete: %d", code)
	}

	// draft:false publishes a change straight away; draft:true holds a new game back
	gen.mu.Lock()
	gen.manifest = strings.Replace(fakeManifest, "mg-fog-walk-k3x9", "mg-fog-walk-v3", 1)
	gen.mu.Unlock()
	_, o = do(t, "POST", ts.URL+"/v1/generate", other, js(map[string]any{"baseGameId": baseID, "change": "slower", "draft": false}), "application/json")
	if g := waitJob(t, ts, other, o["jobId"].(string), "done")["game"].(map[string]any); g["unlisted"] != nil || !feedIDs()[g["id"].(string)] {
		t.Fatalf("draft:false: %v", g)
	}
	gen.mu.Lock()
	gen.manifest = strings.Replace(fakeManifest, "mg-fog-walk-k3x9", "mg-fog-walk-v4", 1)
	gen.mu.Unlock()
	_, o = do(t, "POST", ts.URL+"/v1/generate", other, js(map[string]any{"request": "a secret game", "draft": true}), "application/json")
	if g := waitJob(t, ts, other, o["jobId"].(string), "done")["game"].(map[string]any); g["unlisted"] != true || feedIDs()[g["id"].(string)] {
		t.Fatalf("draft:true: %v", g)
	}
	// a baseManifest needs a base game
	if code, _ := do(t, "POST", ts.URL+"/v1/generate", other, js(map[string]any{"request": "x", "baseManifest": json.RawMessage(custom)}), "application/json"); code != 400 {
		t.Fatalf("a baseManifest with no base game: %d", code)
	}
	// ...but not its authoring source: the phone plays games from a light manifest without one, so the server fills it in
	// from the stored game and keeps the phone's edits
	code, o = do(t, "POST", ts.URL+"/v1/generate", other, js(map[string]any{
		"baseGameId": baseID, "change": "x", "baseManifest": json.RawMessage(`{"title":"Edited on the phone","content":{}}`),
	}), "application/json")
	if code != 202 {
		t.Fatalf("a baseManifest without authoring_json: %d %v", code, o)
	}
	// the fake generator hands back the same manifest id, so this job ends as failed; what matters is what it was sent
	for i := 0; i < 100; i++ {
		_, jv := do(t, "GET", ts.URL+"/v1/generate/"+o["jobId"].(string), other, nil, "")
		if jv["status"] == "done" || jv["status"] == "failed" {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	gen.mu.Lock()
	last = gen.requests[len(gen.requests)-1]
	gen.mu.Unlock()
	for _, want := range []string{`"title":"Edited on the phone"`, `authoring_json`, `authoring`} {
		if !strings.Contains(last, want) {
			t.Fatalf("generator request lacks %s: %.500s", want, last)
		}
	}
}

func TestCancelAJob(t *testing.T) {
	gen := newFakeGenerator(t)
	gen.hold = make(chan struct{})
	ts, _ := serverWithGenerator(t, gen.URL, 20)
	maker, other := register(t, ts, "maker"), register(t, ts, "other")

	_, out := startJob(t, ts, maker, map[string]any{"request": "a calm fog game"})
	id := out["jobId"].(string)
	waitJob(t, ts, maker, id, "running")
	if code, _ := do(t, "DELETE", ts.URL+"/v1/generate/"+id, other, nil, ""); code != 404 {
		t.Fatalf("someone else cancelling: %d", code)
	}
	if code, _ := do(t, "DELETE", ts.URL+"/v1/generate/"+id, maker, nil, ""); code != 204 {
		t.Fatalf("cancel: %d", code)
	}
	job := waitJob(t, ts, maker, id, "failed")
	if job["error"] != "Cancelled." || job["game"] != nil {
		t.Fatalf("cancelled job: %v", job)
	}
	close(gen.hold)
	// it frees the person to start another, and cancelling a finished job does nothing
	_, out = startJob(t, ts, maker, map[string]any{"request": "a calm fog game"})
	done := waitJob(t, ts, maker, out["jobId"].(string), "done")
	if code, _ := do(t, "DELETE", ts.URL+"/v1/generate/"+done["jobId"].(string), maker, nil, ""); code != 204 {
		t.Fatalf("cancelling a finished job: %d", code)
	}
	if got := waitJob(t, ts, maker, done["jobId"].(string), "done"); got["game"] == nil {
		t.Fatalf("a finished job keeps its game: %v", got)
	}
}
