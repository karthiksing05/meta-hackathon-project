package api_test

import (
	"bytes"
	"strings"
	"testing"
)

// PUT /v1/creations/{id} is a new build of your own game: same id, likes and scores; new title, files and group_play.
func TestReplaceCreation(t *testing.T) {
	ts, _ := newServer(t)
	ann, bob := register(t, ts, "ann"), register(t, ts, "bob")
	zipOf := func(manifest string) []byte {
		return makeZip(t, map[string]string{"manifest.json": manifest, "game.js": "console.log(1)"})
	}
	v1 := `{"id":"reroll","title":"Fog Words","one_line_rule":"Guess the word","formula":"guess","brief":{"mood":["cozy"]}}`
	code, g := do(t, "POST", ts.URL+"/v1/creations", ann, bytes.NewReader(zipOf(v1)), "application/zip")
	if code != 201 {
		t.Fatalf("upload: %d %v", code, g)
	}
	id := g["id"].(string)
	oldManifest := g["manifestUrl"].(string)
	do(t, "PUT", ts.URL+"/v1/games/"+id+"/like", bob, nil, "")
	do(t, "POST", ts.URL+"/v1/games/"+id+"/scores", bob, js(map[string]any{"score": 42}), "application/json")

	v2 := `{"id":"reroll","title":"Fog Words 2","one_line_rule":"Guess the better word","formula":"guess","brief":{"mood":["cozy"]},"group_play":{"mode":"group_round","result":{"compare":"score"}}}`
	put := func(tok, key string, body []byte, ct string) (int, map[string]any) {
		return do(t, "PUT", ts.URL+"/v1/creations/"+key, tok, bytes.NewReader(body), ct)
	}
	if code, _ := put(bob, id, zipOf(v2), "application/zip"); code != 404 {
		t.Fatalf("someone else's game: %d", code)
	}
	if code, _ := put(ann, id, zipOf(v2), "text/plain"); code != 415 {
		t.Fatalf("not a zip: %d", code)
	}
	if code, _ := put(ann, id, []byte("not a zip"), "application/zip"); code != 422 {
		t.Fatalf("a broken package: %d", code)
	}
	code, out := put(ann, id, zipOf(v2), "application/zip")
	if code != 200 || out["id"] != id || out["title"] != "Fog Words 2" || out["description"] != "Guess the better word" {
		t.Fatalf("replace: %d %v", code, out)
	}
	if gp, _ := out["group_play"].(map[string]any); gp == nil || gp["mode"] != "group_round" {
		t.Fatalf("group_play after replace: %v", out["group_play"])
	}
	if out["manifestUrl"] == oldManifest || !strings.HasSuffix(out["manifestUrl"].(string), "/manifest.json") {
		t.Fatalf("the files must move to the new package: %v", out["manifestUrl"])
	}
	// likes and scores stay; the game is found under the same id and slug
	_, now := do(t, "GET", ts.URL+"/v1/games/"+id, "", nil, "")
	if now["title"] != "Fog Words 2" || now["likes"].(float64) != 1 {
		t.Fatalf("the game after replace: %v", now)
	}
	_, board := do(t, "GET", ts.URL+"/v1/games/"+id+"/leaderboard", "", nil, "")
	if rows, _ := board["entries"].([]any); len(rows) != 1 {
		if rows, _ := board["items"].([]any); len(rows) != 1 {
			t.Fatalf("the board must keep bob's score: %v", board)
		}
	}
	// a second game can't take the manifest id this one holds
	other := `{"id":"reroll","title":"Other","one_line_rule":"x","formula":"guess"}`
	if code, _ := do(t, "POST", ts.URL+"/v1/creations", ann, bytes.NewReader(zipOf(other)), "application/zip"); code != 422 {
		t.Fatalf("a taken manifest id: %d", code)
	}
	// replacing with an id another game holds is refused
	third := `{"id":"third-game","title":"Third","one_line_rule":"x","formula":"guess"}`
	code, g3 := do(t, "POST", ts.URL+"/v1/creations", ann, bytes.NewReader(zipOf(third)), "application/zip")
	if code != 201 {
		t.Fatalf("third: %d %v", code, g3)
	}
	if code, _ := put(ann, g3["id"].(string), zipOf(v2), "application/zip"); code != 422 {
		t.Fatalf("replace with a taken manifest id: %d", code)
	}
}
