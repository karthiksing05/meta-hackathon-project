package api_test

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"
)

// soundZip is a sound package: manifest.json, an audio file and a cover.
func soundZip(t *testing.T, manifest map[string]any, files map[string]string) *bytes.Buffer {
	t.Helper()
	var b bytes.Buffer
	zw := zip.NewWriter(&b)
	mf, _ := json.Marshal(manifest)
	w, _ := zw.Create("manifest.json")
	w.Write(mf)
	for name, body := range files {
		w, _ := zw.Create(name)
		w.Write([]byte(body))
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return &b
}

func uploadSound(t *testing.T, base, tok string, manifest map[string]any, files map[string]string) (int, map[string]any) {
	t.Helper()
	req, _ := http.NewRequest("POST", base+"/v1/sounds", soundZip(t, manifest, files))
	req.Header.Set("Content-Type", "application/zip")
	if tok != "" {
		req.Header.Set("Authorization", "Bearer "+tok)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var out map[string]any
	json.NewDecoder(res.Body).Decode(&out)
	return res.StatusCode, out
}

func TestSounds(t *testing.T) {
	gen := newFakeGenerator(t)
	ts, _ := serverWithGenerator(t, gen.URL, 30)
	ann, bob := register(t, ts, "ann"), register(t, ts, "bob")

	loop := map[string]string{"loop.m4a": "AUDIO-BYTES", "cover.png": "PNG-BYTES"}
	code, rain := uploadSound(t, ts.URL, ann, map[string]any{"title": "Rainy Lofi", "audio": "loop.m4a", "cover": "cover.png", "duration_ms": 30000, "bpm": 82, "kind": "library"}, loop)
	if code != 201 || rain["title"] != "Rainy Lofi" || rain["kind"] != "library" || rain["creator"] != "ann" || rain["bpm"].(float64) != 82 || rain["useCount"].(float64) != 0 ||
		rain["audioUrl"] != "https://games.example.com/"+rain["id"].(string)+"/loop.m4a" || rain["coverUrl"] != "https://games.example.com/"+rain["id"].(string)+"/cover.png" {
		t.Fatalf("upload: %d %v", code, rain)
	}
	rainID := rain["id"].(string)
	time.Sleep(3 * time.Millisecond)
	code, chip := uploadSound(t, ts.URL, bob, map[string]any{"title": "Chip Sprint", "audio": "run.mp3"}, map[string]string{"run.mp3": "x"})
	if code != 201 || chip["kind"] != "original" || chip["coverUrl"] != nil {
		t.Fatalf("second upload: %d %v", code, chip)
	}
	chipID := chip["id"].(string)

	// bad packages
	for _, c := range []struct {
		label    string
		manifest map[string]any
		files    map[string]string
	}{
		{"no title", map[string]any{"audio": "loop.m4a"}, loop},
		{"a bad audio name", map[string]any{"title": "x", "audio": "../loop.m4a"}, loop},
		{"audio that isn't audio", map[string]any{"title": "x", "audio": "loop.exe"}, map[string]string{"loop.exe": "x"}},
		{"a bad bpm", map[string]any{"title": "x", "audio": "loop.m4a", "bpm": 9000}, loop},
	} {
		if code, _ := uploadSound(t, ts.URL, ann, c.manifest, c.files); code != 422 {
			t.Fatalf("%s: %d", c.label, code)
		}
	}
	if code, _ := uploadSound(t, ts.URL, "", map[string]any{"title": "x", "audio": "loop.m4a"}, loop); code != 401 {
		t.Fatalf("signed out: %d", code)
	}
	if code, _ := do(t, "POST", ts.URL+"/v1/sounds", ann, strings.NewReader("nope"), "text/plain"); code != 415 {
		t.Fatalf("not a zip: %d", code)
	}

	// a game with a sound
	gen.mu.Lock()
	gen.manifest = strings.Replace(fakeManifest, "mg-fog-walk-k3x9", "sound-a", 1)
	gen.mu.Unlock()
	_, o := startJob(t, ts, ann, map[string]any{"request": "a calm game", "soundId": rainID, "offsetMs": 4000, "mix": 0.4})
	game := waitJob(t, ts, ann, o["jobId"].(string), "done")["game"].(map[string]any)
	gs := game["sound"].(map[string]any)
	if gs["id"] != rainID || gs["title"] != "Rainy Lofi" || gs["creator"] != "ann" || gs["offsetMs"].(float64) != 4000 || gs["mix"].(float64) != 0.4 || gs["audioUrl"] != rain["audioUrl"] {
		t.Fatalf("the sound on a generated game: %v", game["sound"])
	}
	gameID := game["id"].(string)
	if code, _ := startJob(t, ts, ann, map[string]any{"request": "x", "soundId": "000000000000000000000000"}); code != 404 {
		t.Fatalf("an unknown sound: %d", code)
	}
	useCount := func(id string) float64 {
		_, s := do(t, "GET", ts.URL+"/v1/sounds/"+id, "", nil, "")
		return s["useCount"].(float64)
	}
	if useCount(rainID) != 1 {
		t.Fatalf("use count after one game: %v", useCount(rainID))
	}

	// the sound's page: its games, top and recent; drafts stay out
	_, sg := do(t, "GET", ts.URL+"/v1/sounds/"+rainID+"/games?sort=top", "", nil, "")
	if items := sg["items"].([]any); len(items) != 1 || items[0].(map[string]any)["id"] != gameID || items[0].(map[string]any)["sound"] == nil || sg["total"].(float64) != 1 {
		t.Fatalf("games using the sound: %v", sg)
	}
	// a change keeps the original's sound (and it's a draft until published)
	gen.mu.Lock()
	gen.manifest = strings.Replace(fakeManifest, "mg-fog-walk-k3x9", "sound-b", 1)
	gen.mu.Unlock()
	_, o = do(t, "POST", ts.URL+"/v1/generate", ann, js(map[string]any{"baseGameId": gameID, "change": "faster"}), "application/json")
	rev := waitJob(t, ts, ann, o["jobId"].(string), "done")["game"].(map[string]any)
	if rev["unlisted"] != true || rev["sound"].(map[string]any)["id"] != rainID || useCount(rainID) != 2 {
		t.Fatalf("a change keeps the sound: %v (uses %v)", rev["sound"], useCount(rainID))
	}
	if _, sg := do(t, "GET", ts.URL+"/v1/sounds/"+rainID+"/games", "", nil, ""); len(sg["items"].([]any)) != 1 {
		t.Fatalf("a draft isn't on the sound's page: %v", sg)
	}
	// ... unless it names another sound
	gen.mu.Lock()
	gen.manifest = strings.Replace(fakeManifest, "mg-fog-walk-k3x9", "sound-c", 1)
	gen.mu.Unlock()
	_, o = do(t, "POST", ts.URL+"/v1/generate", ann, js(map[string]any{"baseGameId": gameID, "change": "slower", "soundId": chipID}), "application/json")
	if g := waitJob(t, ts, ann, o["jobId"].(string), "done")["game"].(map[string]any); g["sound"].(map[string]any)["id"] != chipID || g["sound"].(map[string]any)["mix"].(float64) != 0.7 {
		t.Fatalf("swapping the sound: %v", g["sound"])
	}

	// attach, swap and remove on a game: owners only
	put := func(tok string, body map[string]any) (int, map[string]any) {
		return do(t, "PUT", ts.URL+"/v1/games/"+gameID+"/sound", tok, js(body), "application/json")
	}
	if code, _ := put(bob, map[string]any{"soundId": chipID}); code != 404 {
		t.Fatalf("someone else's game: %d", code)
	}
	if code, _ := put(ann, map[string]any{"soundId": "000000000000000000000000"}); code != 404 {
		t.Fatalf("an unknown sound: %d", code)
	}
	before := useCount(rainID)
	code, g := put(ann, map[string]any{"soundId": chipID, "offsetMs": 1500, "mix": 5}) // the mix is clamped to 1
	if code != 200 || g["sound"].(map[string]any)["id"] != chipID || g["sound"].(map[string]any)["offsetMs"].(float64) != 1500 || g["sound"].(map[string]any)["mix"].(float64) != 1 || useCount(rainID) != before-1 {
		t.Fatalf("swap: %d %v", code, g["sound"])
	}
	// the trim alone keeps the sound and its mix
	if _, g := put(ann, map[string]any{"soundId": chipID, "offsetMs": 2500}); g["sound"].(map[string]any)["offsetMs"].(float64) != 2500 || g["sound"].(map[string]any)["mix"].(float64) != 1 {
		t.Fatalf("changing only the trim: %v", g["sound"])
	}
	if code, g := do(t, "DELETE", ts.URL+"/v1/games/"+gameID+"/sound", ann, nil, ""); code != 200 || g["sound"] != nil {
		t.Fatalf("remove: %d %v", code, g["sound"])
	}

	// finding sounds: trending puts the most used first; search matches the start of a word
	_, tr := do(t, "GET", ts.URL+"/v1/sounds?tab=trending", "", nil, "")
	items := tr["items"].([]any)
	if len(items) != 2 || items[0].(map[string]any)["id"] != chipID { // chip is on the swapped change (1 use); rain has none left
		t.Fatalf("trending: %v", tr)
	}
	_, rc := do(t, "GET", ts.URL+"/v1/sounds?tab=recent", "", nil, "")
	if r := rc["items"].([]any); r[0].(map[string]any)["id"] != chipID { // uploaded second
		t.Fatalf("recent: %v", rc)
	}
	_, q := do(t, "GET", ts.URL+"/v1/sounds?q=lof", "", nil, "")
	if r := q["items"].([]any); len(r) != 1 || r[0].(map[string]any)["id"] != rainID {
		t.Fatalf("search by title word: %v", q)
	}
	if _, q := do(t, "GET", ts.URL+"/v1/sounds?q=bob", "", nil, ""); len(q["items"].([]any)) != 1 { // by creator
		t.Fatalf("search by creator: %v", q)
	}
	if code, _ := do(t, "GET", ts.URL+"/v1/sounds?tab=nope", "", nil, ""); code != 400 {
		t.Fatalf("a bad tab: %d", code)
	}

	// saving: idempotent, per person, and the Saved tab
	if code, _ := do(t, "GET", ts.URL+"/v1/sounds?tab=saved", "", nil, ""); code != 401 {
		t.Fatalf("saved, signed out: %d", code)
	}
	for i := 0; i < 2; i++ {
		if code, out := do(t, "PUT", ts.URL+"/v1/sounds/"+rainID+"/save", bob, nil, ""); code != 200 || out["saves"].(float64) != 1 || out["savedByMe"] != true {
			t.Fatalf("save %d: %d %v", i, code, out)
		}
	}
	if _, one := do(t, "GET", ts.URL+"/v1/sounds/"+rainID, bob, nil, ""); one["savedByMe"] != true || one["saves"].(float64) != 1 {
		t.Fatalf("saved by me: %v", one)
	}
	if _, one := do(t, "GET", ts.URL+"/v1/sounds/"+rainID, ann, nil, ""); one["savedByMe"] != false {
		t.Fatalf("someone else's save isn't mine: %v", one)
	}
	if _, sv := do(t, "GET", ts.URL+"/v1/sounds?tab=saved", bob, nil, ""); len(sv["items"].([]any)) != 1 || sv["items"].([]any)[0].(map[string]any)["id"] != rainID {
		t.Fatalf("the saved tab: %v", sv)
	}
	if _, out := do(t, "DELETE", ts.URL+"/v1/sounds/"+rainID+"/save", bob, nil, ""); out["saves"].(float64) != 0 || out["savedByMe"] != false {
		t.Fatalf("unsave: %v", out)
	}
	if code, _ := do(t, "PUT", ts.URL+"/v1/sounds/000000000000000000000000/save", bob, nil, ""); code != 404 {
		t.Fatalf("saving an unknown sound: %d", code)
	}
}

// A library track by another artist carries its credit: shown as the creator, with the licence, attribution line,
// source page and tags, and searchable by artist and tag.
func TestSoundCredit(t *testing.T) {
	gen := newFakeGenerator(t)
	ts, _ := serverWithGenerator(t, gen.URL, 30)
	studio := register(t, ts, "studio")
	loop := map[string]string{"loop.m4a": "AUDIO-BYTES"}
	attribution := `"Sneaky Snitch" Kevin MacLeod (incompetech.com) Licensed under Creative Commons: By Attribution 4.0 License http://creativecommons.org/licenses/by/4.0/`
	code, s := uploadSound(t, ts.URL, studio, map[string]any{"title": "Sneaky Snitch", "audio": "loop.m4a", "kind": "library",
		"artist": "Kevin MacLeod", "license": "CC BY 4.0", "attribution": attribution,
		"source_url": "https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1100191", "tags": []string{"Funny", "suspense"}}, loop)
	if code != 201 || s["creator"] != "Kevin MacLeod" || s["license"] != "CC BY 4.0" || s["attribution"] != attribution ||
		!strings.HasPrefix(s["sourceUrl"].(string), "https://incompetech.com/") || len(s["tags"].([]any)) != 2 || s["tags"].([]any)[0] != "funny" {
		t.Fatalf("credited upload: %d %v", code, s)
	}
	// Without credit, the uploader is the creator, as before.
	code, own := uploadSound(t, ts.URL, studio, map[string]any{"title": "My Loop", "audio": "loop.m4a"}, loop)
	if code != 201 || own["creator"] != "studio" || own["attribution"] != nil {
		t.Fatalf("own upload: %d %v", code, own)
	}
	for _, q := range []string{"macleod", "funny"} {
		res, err := http.Get(ts.URL + "/v1/sounds?tab=recent&q=" + q)
		if err != nil {
			t.Fatal(err)
		}
		var list struct{ Items []map[string]any }
		json.NewDecoder(res.Body).Decode(&list)
		res.Body.Close()
		if len(list.Items) != 1 || list.Items[0]["title"] != "Sneaky Snitch" {
			t.Fatalf("search %q: %v", q, list.Items)
		}
	}
	for _, bad := range []map[string]any{
		{"title": "x", "audio": "loop.m4a", "source_url": "javascript:alert(1)"},
		{"title": "x", "audio": "loop.m4a", "tags": []string{"a", "b", "c", "d", "e", "f", "g", "h", "i"}},
		{"title": "x", "audio": "loop.m4a", "tags": []string{""}},
	} {
		if code, out := uploadSound(t, ts.URL, studio, bad, loop); code != 422 {
			t.Fatalf("bad credit %v: %d %v", bad, code, out)
		}
	}
}
