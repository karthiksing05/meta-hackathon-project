package api_test

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/karthiksing05/meta-hackathon-project/backend/internal/api"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/auth"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/pkgstore"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/store"
)

func newServer(t *testing.T) (*httptest.Server, string) {
	t.Helper()
	root := t.TempDir()
	pk, err := pkgstore.NewLocal(root, pkgstore.Limits{MaxUploadBytes: 5 << 20, MaxUnpackedBytes: 10 << 20, MaxFileBytes: 5 << 20})
	if err != nil {
		t.Fatal(err)
	}
	s := api.New(api.Options{
		Store: store.NewMemory(), Packages: pk, Signer: auth.NewSigner([]byte(strings.Repeat("k", 32)), time.Minute),
		RefreshTTL: time.Hour, GamesBaseURL: "https://games.example.com", MaxUploadMB: 5,
	})
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)
	return ts, root
}

func do(t *testing.T, method, url, token string, body io.Reader, ct string) (int, map[string]any) {
	t.Helper()
	req, _ := http.NewRequest(method, url, body)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	if ct != "" {
		req.Header.Set("Content-Type", ct)
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

func js(v any) io.Reader { b, _ := json.Marshal(v); return bytes.NewReader(b) }

func makeZip(t *testing.T, files map[string]string) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for n, c := range files {
		w, _ := zw.Create(n)
		w.Write([]byte(c))
	}
	zw.Close()
	return buf.Bytes()
}

const manifest = `{"title":"Fog Words","one_line_rule":"Guess the word","formula":"guess","brief":{"mood":["cozy"]}}`

func register(t *testing.T, ts *httptest.Server, name string) string {
	code, out := do(t, "POST", ts.URL+"/v1/auth/register", "", js(map[string]string{
		"email": name + "@example.com", "username": name, "password": "correct horse"}), "application/json")
	if code != 201 {
		t.Fatalf("register: %d %v", code, out)
	}
	return out["accessToken"].(string)
}

func TestAuthFlow(t *testing.T) {
	ts, _ := newServer(t)
	tok := register(t, ts, "alice")
	if code, _ := do(t, "GET", ts.URL+"/v1/auth/me", tok, nil, ""); code != 200 {
		t.Fatalf("me: %d", code)
	}
	if code, _ := do(t, "GET", ts.URL+"/v1/auth/me", "", nil, ""); code != 401 {
		t.Fatalf("me without token: %d", code)
	}
	if code, _ := do(t, "POST", ts.URL+"/v1/auth/register", "", js(map[string]string{
		"email": "alice@example.com", "username": "other", "password": "correct horse"}), "application/json"); code != 409 {
		t.Fatalf("duplicate email: %d", code)
	}
	code, out := do(t, "POST", ts.URL+"/v1/auth/login", "", js(map[string]string{"email": "ALICE@example.com", "password": "correct horse"}), "application/json")
	if code != 200 {
		t.Fatalf("login: %d", code)
	}
	rt := out["refreshToken"].(string)
	if code, _ := do(t, "POST", ts.URL+"/v1/auth/refresh", "", js(map[string]string{"refreshToken": rt}), "application/json"); code != 200 {
		t.Fatalf("refresh: %d", code)
	}
	if code, _ := do(t, "POST", ts.URL+"/v1/auth/refresh", "", js(map[string]string{"refreshToken": rt}), "application/json"); code != 401 {
		t.Fatalf("refresh token must be single use: %d", code)
	}
	if code, _ := do(t, "POST", ts.URL+"/v1/auth/login", "", js(map[string]string{"email": "alice@example.com", "password": "nope nope"}), "application/json"); code != 401 {
		t.Fatalf("bad password: %d", code)
	}
}

func TestCreationFeedSearchLikesEvents(t *testing.T) {
	ts, root := newServer(t)
	tok := register(t, ts, "bob")
	z := makeZip(t, map[string]string{
		"manifest.json": manifest, "game.js": "console.log(1)", "cover.png": "png",
		"source/prompt.txt": "make it cozy",
	})
	code, g := do(t, "POST", ts.URL+"/v1/creations", tok, bytes.NewReader(z), "application/zip")
	if code != 201 {
		t.Fatalf("create: %d %v", code, g)
	}
	id := g["id"].(string)
	if g["manifestUrl"] != "https://games.example.com/"+id+"/manifest.json" || g["coverUrl"] == nil {
		t.Fatalf("urls: %v", g)
	}
	_ = root

	code, feed := do(t, "GET", ts.URL+"/v1/feed", tok, nil, "")
	if code != 200 || len(feed["items"].([]any)) != 1 {
		t.Fatalf("feed: %d %v", code, feed)
	}
	code, s := do(t, "GET", ts.URL+"/v1/search?q=fog", "", nil, "")
	if code != 200 || len(s["items"].([]any)) != 1 {
		t.Fatalf("search: %v", s)
	}
	if _, s := do(t, "GET", ts.URL+"/v1/search?tag=cozy", "", nil, ""); len(s["items"].([]any)) != 1 {
		t.Fatalf("tag search: %v", s)
	}
	if _, s := do(t, "GET", ts.URL+"/v1/search?q=zzz", "", nil, ""); len(s["items"].([]any)) != 0 {
		t.Fatalf("empty search: %v", s)
	}

	// likes are idempotent
	for i := 0; i < 2; i++ {
		if code, out := do(t, "PUT", ts.URL+"/v1/games/"+id+"/like", tok, nil, ""); code != 200 || out["likes"].(float64) != 1 {
			t.Fatalf("like: %d %v", code, out)
		}
	}
	if _, out := do(t, "GET", ts.URL+"/v1/games/"+id, tok, nil, ""); out["likedByMe"] != true {
		t.Fatalf("likedByMe: %v", out)
	}
	if _, out := do(t, "DELETE", ts.URL+"/v1/games/"+id+"/like", tok, nil, ""); out["likes"].(float64) != 0 {
		t.Fatalf("unlike: %v", out)
	}

	// events: anonymous needs deviceId
	ev := map[string]any{"events": []map[string]any{{"gameId": id, "type": "play"}, {"gameId": id, "type": "finish", "value": 12}}}
	if code, _ := do(t, "POST", ts.URL+"/v1/feed/events", "", js(ev), "application/json"); code != 400 {
		t.Fatalf("anonymous events without device: %d", code)
	}
	if code, _ := do(t, "POST", ts.URL+"/v1/feed/events", tok, js(ev), "application/json"); code != 202 {
		t.Fatalf("events: %d", code)
	}
	if _, out := do(t, "GET", ts.URL+"/v1/games/"+id, "", nil, ""); out["plays"].(float64) != 1 || out["finishes"].(float64) != 1 {
		t.Fatalf("counters: %v", out)
	}
	bad := map[string]any{"events": []map[string]any{{"gameId": id, "type": "hack"}}}
	if code, _ := do(t, "POST", ts.URL+"/v1/feed/events", tok, js(bad), "application/json"); code != 400 {
		t.Fatalf("bad event type: %d", code)
	}

	// leaderboard keeps the best score
	do(t, "POST", ts.URL+"/v1/games/"+id+"/scores", tok, js(map[string]any{"score": 10}), "application/json")
	_, lb := do(t, "POST", ts.URL+"/v1/games/"+id+"/scores", tok, js(map[string]any{"score": 4}), "application/json")
	rows := lb["items"].([]any)
	if len(rows) != 1 || rows[0].(map[string]any)["score"].(float64) != 10 {
		t.Fatalf("leaderboard: %v", lb)
	}

	// private source: owner only, zipped
	req, _ := http.NewRequest("GET", ts.URL+"/v1/creations/"+id+"/source", nil)
	req.Header.Set("Authorization", "Bearer "+tok)
	res, _ := http.DefaultClient.Do(req)
	body, _ := io.ReadAll(res.Body)
	zr, err := zip.NewReader(bytes.NewReader(body), int64(len(body)))
	if err != nil || len(zr.File) != 1 || zr.File[0].Name != "prompt.txt" {
		t.Fatalf("source zip: %v", err)
	}
	other := register(t, ts, "carol")
	if code, _ := do(t, "GET", ts.URL+"/v1/creations/"+id+"/source", other, nil, ""); code != 404 {
		t.Fatalf("other user's source must be 404: %d", code)
	}
}

func TestFeedPagination(t *testing.T) {
	ts, _ := newServer(t)
	tok := register(t, ts, "dave")
	for i := 0; i < 5; i++ {
		z := makeZip(t, map[string]string{"manifest.json": manifest})
		if code, out := do(t, "POST", ts.URL+"/v1/creations", tok, bytes.NewReader(z), "application/zip"); code != 201 {
			t.Fatalf("create %d: %v", i, out)
		}
		time.Sleep(2 * time.Millisecond)
	}
	seen := map[string]bool{}
	cursor := ""
	for pages := 0; pages < 10; pages++ {
		_, out := do(t, "GET", ts.URL+"/v1/feed?limit=2&cursor="+cursor, "", nil, "")
		for _, it := range out["items"].([]any) {
			id := it.(map[string]any)["id"].(string)
			if seen[id] {
				t.Fatalf("duplicate %s across pages", id)
			}
			seen[id] = true
		}
		cursor, _ = out["nextCursor"].(string)
		if cursor == "" {
			break
		}
	}
	if len(seen) != 5 {
		t.Fatalf("saw %d of 5", len(seen))
	}
}

func TestUploadRejections(t *testing.T) {
	ts, _ := newServer(t)
	tok := register(t, ts, "erin")
	cases := map[string]map[string]string{
		"traversal":   {"manifest.json": manifest, "../evil.js": "x"},
		"absolute":    {"manifest.json": manifest, "/etc/passwd.txt": "x"},
		"hidden":      {"manifest.json": manifest, ".env.txt": "x"},
		"bad ext":     {"manifest.json": manifest, "run.sh": "x"},
		"no manifest": {"game.js": "x"},
		"bad json":    {"manifest.json": "[1]"},
		"no title":    {"manifest.json": `{"formula":"x"}`},
	}
	for name, files := range cases {
		z := makeZip(t, files)
		if code, out := do(t, "POST", ts.URL+"/v1/creations", tok, bytes.NewReader(z), "application/zip"); code != 422 {
			t.Errorf("%s: want 422, got %d %v", name, code, out)
		}
	}
	if code, _ := do(t, "POST", ts.URL+"/v1/creations", tok, strings.NewReader("not a zip"), "application/zip"); code != 422 {
		t.Errorf("garbage: %d", code)
	}
	if code, _ := do(t, "POST", ts.URL+"/v1/creations", tok, strings.NewReader("{}"), "application/json"); code != 415 {
		t.Errorf("wrong content type: %d", code)
	}
	if code, _ := do(t, "POST", ts.URL+"/v1/creations", "", strings.NewReader("{}"), "application/zip"); code != 401 {
		t.Errorf("unauthenticated: %d", code)
	}
	// feed stays empty: nothing half-published
	if _, out := do(t, "GET", ts.URL+"/v1/feed", "", nil, ""); len(out["items"].([]any)) != 0 {
		t.Errorf("rejected uploads must not appear: %v", out)
	}
}

func TestReady(t *testing.T) {
	ts, _ := newServer(t)
	if code, out := do(t, "GET", ts.URL+"/readyz", "", nil, ""); code != 200 {
		t.Fatalf("readyz: %d %v", code, out)
	}
}
