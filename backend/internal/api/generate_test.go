package api_test

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/karthiksing05/meta-hackathon-project/backend/internal/api"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/auth"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/pkgstore"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/store"
)

// fakeGenerator stands in for the Node generator: /healthz and a streaming /compose.
type fakeGenerator struct {
	*httptest.Server
	mu         sync.Mutex
	configured bool
	manifest   string // the exact result bytes
	fail       bool
	hold       chan struct{} // when set, /compose waits for it before finishing
	requests   []string
}

const fakeManifest = `{"id":"mg-fog-walk-k3x9","title":"Fog Walk","one_line_rule":"Tap to hop the fog.","formula":"microgame","brief":{"mood":["cozy"]},"content":{"game_json":"{\"z_first\":1,\"a_second\":[3,2,1]}","authoring_json":"{\"authoring\":\"microgame-authoring/0.1\"}"}}`

func newFakeGenerator(t *testing.T) *fakeGenerator {
	g := &fakeGenerator{configured: true, manifest: fakeManifest}
	g.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		g.mu.Lock()
		configured, fail, hold := g.configured, g.fail, g.hold
		g.mu.Unlock()
		switch {
		case r.URL.Path == "/healthz":
			fmt.Fprintf(w, `{"status":"ok","museConfigured":%v,"fragments":33}`, configured)
		case r.URL.Path == "/compose" && r.Method == "POST":
			body := make([]byte, 1<<16)
			n, _ := r.Body.Read(body)
			g.mu.Lock()
			g.requests = append(g.requests, string(body[:n]))
			g.mu.Unlock()
			w.Header().Set("Content-Type", "application/x-ndjson")
			fl := w.(http.Flusher)
			line := func(s string) { fmt.Fprintln(w, s); fl.Flush() }
			line(`{"type":"event","event":{"kind":"drafting","attempt":1,"summary":"Muse is drafting the game"}}`)
			line(`{"type":"event","event":{"kind":"expanding","summary":"Building and checking the game"}}`)
			if hold != nil {
				<-hold
			}
			if fail {
				line(`{"type":"event","event":{"kind":"failed","reason":"nope","summary":"Couldn't finish: nope"}}`)
				line(`{"type":"error","message":"Muse's microgame still doesn't validate: E_X at /uses/0","issues":["E_X"],"stats":{"museCalls":3}}`)
				return
			}
			line(`{"type":"event","event":{"kind":"playtested","passed":true,"headline":"5 of 5 bots fine","summary":"Playtested: 5 of 5 bots fine"}}`)
			line(`{"type":"event","event":{"kind":"done","title":"Fog Walk","summary":"Fog Walk is ready"}}`)
			line(`{"type":"result","manifest":` + g.manifest + `,"stats":{"museCalls":2,"repairRounds":1},"gate":{"passed":true,"summary":"fine"}}`)
		case (r.URL.Path == "/anatomy" || r.URL.Path == "/anatomy/revise") && r.Method == "POST":
			body := make([]byte, 1<<16)
			n, _ := r.Body.Read(body)
			g.mu.Lock()
			g.requests = append(g.requests, r.URL.Path+" "+string(body[:n]))
			g.mu.Unlock()
			if fail {
				w.WriteHeader(502)
				fmt.Fprint(w, `{"error":"muse_failed"}`)
				return
			}
			fmt.Fprint(w, `{"anatomy":{"anatomy":"game-anatomy/0.1","title":"Fog Garden","genre":"puzzle","parts":{}},"model":"fake"}`)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(g.Close)
	return g
}

func serverWithGenerator(t *testing.T, url string, perHour int) (*httptest.Server, string) {
	t.Helper()
	root := t.TempDir()
	pk, err := pkgstore.NewLocal(root, pkgstore.Limits{MaxUploadBytes: 5 << 20, MaxUnpackedBytes: 10 << 20, MaxFileBytes: 5 << 20})
	if err != nil {
		t.Fatal(err)
	}
	s := api.New(api.Options{
		Store: store.NewMemory(), Packages: pk, Signer: auth.NewSigner([]byte(strings.Repeat("k", 32)), time.Minute),
		RefreshTTL: time.Hour, GamesBaseURL: "https://games.example.com", MaxUploadMB: 5,
		GeneratorURL: url, GenerateConcurrent: 2, GeneratePerHour: perHour,
	})
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)
	return ts, root
}

func startJob(t *testing.T, ts *httptest.Server, tok string, body any) (int, map[string]any) {
	t.Helper()
	return do(t, "POST", ts.URL+"/v1/generate", tok, js(body), "application/json")
}

func waitJob(t *testing.T, ts *httptest.Server, tok, id string, want string) map[string]any {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for {
		_, j := do(t, "GET", ts.URL+"/v1/generate/"+id, tok, nil, "")
		if j["status"] == want {
			return j
		}
		if time.Now().After(deadline) {
			t.Fatalf("job never became %s: %v", want, j)
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func TestGenerateStoresTheGame(t *testing.T) {
	gen := newFakeGenerator(t)
	ts, root := serverWithGenerator(t, gen.URL, 6)
	tok := register(t, ts, "maker")

	code, out := startJob(t, ts, tok, map[string]any{"request": "a calm fog game", "brief": map[string]any{"mood": []string{"cozy"}, "energy": "low"}})
	if code != 202 || out["jobId"] == nil {
		t.Fatalf("start: %d %v", code, out)
	}
	job := waitJob(t, ts, tok, out["jobId"].(string), "done")

	events := job["events"].([]any)
	if len(events) != 4 || events[0].(map[string]any)["summary"] != "Muse is drafting the game" || events[3].(map[string]any)["kind"] != "done" {
		t.Fatalf("events: %v", events)
	}
	if pt := events[2].(map[string]any); pt["passed"] != true || pt["headline"] != "5 of 5 bots fine" || pt["seq"].(float64) != 3 {
		t.Fatalf("event detail is inline: %v", pt)
	}
	game := job["game"].(map[string]any)
	if game["slug"] != "mg-fog-walk-k3x9" || game["title"] != "Fog Walk" || game["formula"] != "microgame" ||
		game["manifestUrl"] != "https://games.example.com/"+game["id"].(string)+"/manifest.json" {
		t.Fatalf("game: %v", game)
	}

	// The stored manifest is byte for byte what the generator sent (key order inside game_json matters).
	got, err := os.ReadFile(filepath.Join(root, "published", game["id"].(string), "manifest.json"))
	if err != nil || string(got) != fakeManifest {
		t.Fatalf("stored manifest differs: %v\n%s", err, got)
	}
	// It is an ordinary game now: in the feed, by slug, and owned by the maker.
	if _, feed := do(t, "GET", ts.URL+"/v1/feed", "", nil, ""); len(feed["items"].([]any)) != 1 {
		t.Fatalf("feed: %v", feed)
	}
	if code, g := do(t, "GET", ts.URL+"/v1/games/mg-fog-walk-k3x9", "", nil, ""); code != 200 || g["id"] != game["id"] {
		t.Fatalf("by slug: %d %v", code, g)
	}
	if _, mine := do(t, "GET", ts.URL+"/v1/creations", tok, nil, ""); len(mine["items"].([]any)) != 1 {
		t.Fatalf("my creations: %v", mine)
	}
	// What the generator was asked: the request and the brief, with the intent defaulted from the request.
	if len(gen.requests) != 1 || !strings.Contains(gen.requests[0], `"request":"a calm fog game"`) || !strings.Contains(gen.requests[0], `"intent":"a calm fog game"`) {
		t.Fatalf("generator request: %v", gen.requests)
	}
	if stats := job["stats"].(map[string]any); stats["museCalls"].(float64) != 2 || stats["gate"] == nil {
		t.Fatalf("stats: %v", job["stats"])
	}
	_, list := do(t, "GET", ts.URL+"/v1/generate", tok, nil, "")
	if items := list["items"].([]any); len(items) != 1 || items[0].(map[string]any)["status"] != "done" {
		t.Fatalf("list: %v", list)
	}
}

func TestGenerateFailureIsReported(t *testing.T) {
	gen := newFakeGenerator(t)
	gen.fail = true
	ts, _ := serverWithGenerator(t, gen.URL, 6)
	tok := register(t, ts, "unlucky")
	_, out := startJob(t, ts, tok, map[string]any{"request": "a game"})
	job := waitJob(t, ts, tok, out["jobId"].(string), "failed")
	if !strings.Contains(job["error"].(string), "still doesn't validate") || job["game"] != nil {
		t.Fatalf("failed job: %v", job)
	}
	if _, feed := do(t, "GET", ts.URL+"/v1/feed", "", nil, ""); len(feed["items"].([]any)) != 0 {
		t.Fatalf("a failed job must not publish anything: %v", feed)
	}
}

func TestGenerateGuards(t *testing.T) {
	gen := newFakeGenerator(t)
	ts, _ := serverWithGenerator(t, gen.URL, 6)
	tok := register(t, ts, "guarded")

	if code, _ := startJob(t, ts, "", map[string]any{"request": "x"}); code != 401 {
		t.Errorf("signed out: %d", code)
	}
	for name, body := range map[string]any{
		"empty request":   map[string]any{"request": "  "},
		"huge request":    map[string]any{"request": strings.Repeat("x", 2001)},
		"missing request": map[string]any{"brief": map[string]any{}},
	} {
		if code, _ := startJob(t, ts, tok, body); code != 400 {
			t.Errorf("%s: want 400, got %d", name, code)
		}
	}
	if code, _ := do(t, "GET", ts.URL+"/v1/generate/doesnotexist", tok, nil, ""); code != 404 {
		t.Errorf("unknown job: %d", code)
	}

	// someone else's job is a 404, not a 403
	_, out := startJob(t, ts, tok, map[string]any{"request": "mine"})
	id := out["jobId"].(string)
	waitJob(t, ts, tok, id, "done")
	other := register(t, ts, "nosy")
	if code, _ := do(t, "GET", ts.URL+"/v1/generate/"+id, other, nil, ""); code != 404 {
		t.Errorf("another user's job: %d", code)
	}

	// Muse not set up on the server, or the generator down
	gen.mu.Lock()
	gen.configured = false
	gen.mu.Unlock()
	ts2, _ := serverWithGenerator(t, gen.URL, 6)
	tok2 := register(t, ts2, "early")
	if code, out := startJob(t, ts2, tok2, map[string]any{"request": "x"}); code != 503 || !strings.Contains(out["error"].(string), "Muse is not set up") {
		t.Errorf("muse not configured: %d %v", code, out)
	}
	down := newFakeGenerator(t)
	down.Close()
	ts3, _ := serverWithGenerator(t, down.URL, 6)
	if code, _ := startJob(t, ts3, register(t, ts3, "late"), map[string]any{"request": "x"}); code != 503 {
		t.Errorf("generator down: %d", code)
	}
	ts4, _ := serverWithGenerator(t, "", 6)
	if code, _ := startJob(t, ts4, register(t, ts4, "off"), map[string]any{"request": "x"}); code != 503 {
		t.Errorf("generation switched off: %d", code)
	}
}

func TestGenerateLimits(t *testing.T) {
	gen := newFakeGenerator(t)
	gen.hold = make(chan struct{})
	ts, _ := serverWithGenerator(t, gen.URL, 2)
	tok := register(t, ts, "eager")

	_, out := startJob(t, ts, tok, map[string]any{"request": "first"})
	id := out["jobId"].(string)
	waitJob(t, ts, tok, id, "running")
	if code, _ := startJob(t, ts, tok, map[string]any{"request": "second"}); code != 429 {
		t.Fatalf("one running job at a time: %d", code)
	}
	// while it runs, the app sees the steps so far
	_, j := do(t, "GET", ts.URL+"/v1/generate/"+id, tok, nil, "")
	if ev, _ := j["events"].([]any); len(ev) != 2 || j["game"] != nil {
		t.Fatalf("progress while running: %v", j)
	}
	close(gen.hold)
	waitJob(t, ts, tok, id, "done")

	// the manifest id is taken now, so a second identical result fails cleanly instead of overwriting
	_, out = startJob(t, ts, tok, map[string]any{"request": "second"})
	failed := waitJob(t, ts, tok, out["jobId"].(string), "failed")
	if !strings.Contains(failed["error"].(string), "already exists") {
		t.Fatalf("duplicate id: %v", failed)
	}
	if code, _ := startJob(t, ts, tok, map[string]any{"request": "third"}); code != 429 {
		t.Fatalf("per-hour limit: %d", code)
	}
}
