package api_test

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Everyone but a game's owner is pointed at a manifest without the authoring source; the owner gets the full one.
func TestLightManifestForEveryoneButTheOwner(t *testing.T) {
	ts, root := newServer(t)
	ann, bob := register(t, ts, "ann"), register(t, ts, "bob")
	zipOf := func(m map[string]any) []byte {
		b, _ := json.Marshal(m)
		return makeZip(t, map[string]string{"manifest.json": string(b)})
	}
	big := strings.Repeat("A", 60<<10)
	code, g := do(t, "POST", ts.URL+"/v1/creations", ann, bytes.NewReader(zipOf(map[string]any{
		"id": "heavy-one", "title": "Heavy", "one_line_rule": "x", "formula": "microgame",
		"content": map[string]any{"game_json": `{"z":1}`, "authoring_json": big},
	})), "application/zip")
	if code != 201 {
		t.Fatalf("upload: %d %v", code, g)
	}
	id := g["id"].(string)
	if !strings.HasSuffix(g["manifestUrl"].(string), "/manifest.json") {
		t.Fatalf("the owner gets the full manifest on upload: %v", g["manifestUrl"])
	}
	code, small := do(t, "POST", ts.URL+"/v1/creations", ann, bytes.NewReader(zipOf(map[string]any{
		"id": "small-one", "title": "Small", "one_line_rule": "x", "formula": "microgame",
		"content": map[string]any{"game_json": `{"z":1}`, "authoring_json": "tiny"},
	})), "application/zip")
	if code != 201 {
		t.Fatalf("small upload: %d %v", code, small)
	}

	url := func(who, game string) string {
		_, v := do(t, "GET", ts.URL+"/v1/games/"+game, who, nil, "")
		return v["manifestUrl"].(string)
	}
	for who, tok := range map[string]string{"a guest": "", "another person": bob} {
		if u := url(tok, id); !strings.HasSuffix(u, "/manifest.light.json") {
			t.Fatalf("%s should get the light manifest: %s", who, u)
		}
	}
	if u := url(ann, id); !strings.HasSuffix(u, "/manifest.json") {
		t.Fatalf("the owner keeps the full manifest: %s", u)
	}
	if u := url("", small["id"].(string)); !strings.HasSuffix(u, "/manifest.json") {
		t.Fatalf("a game with a small authoring source has no light copy: %s", u)
	}

	// the lists say the same: the feed and search are what the app loads games from
	_, found := do(t, "GET", ts.URL+"/v1/search?q=Heavy", "", nil, "")
	items := found["items"].([]any)
	if len(items) != 1 || !strings.HasSuffix(items[0].(map[string]any)["manifestUrl"].(string), "/manifest.light.json") {
		t.Fatalf("search for a guest: %v", found)
	}

	// the file is on disk next to the untouched manifest.json, smaller, with game_json as it was
	dir := filepath.Join(root, "published", strings.Split(strings.TrimPrefix(url("", id), "https://games.example.com/"), "/")[0])
	full, err1 := os.ReadFile(filepath.Join(dir, "manifest.json"))
	light, err2 := os.ReadFile(filepath.Join(dir, "manifest.light.json"))
	if err1 != nil || err2 != nil || len(light) > len(full)-len(big)+200 || bytes.Contains(light, []byte("authoring_json")) {
		t.Fatalf("files: %v %v, %d vs %d bytes", err1, err2, len(light), len(full))
	}
	var m struct{ Content map[string]json.RawMessage }
	if json.Unmarshal(light, &m) != nil || string(m.Content["game_json"]) != `"{\"z\":1}"` {
		t.Fatalf("game_json must come through unchanged: %s", light)
	}
}
