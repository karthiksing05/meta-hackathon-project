package api_test

import (
	"strings"
	"testing"
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
