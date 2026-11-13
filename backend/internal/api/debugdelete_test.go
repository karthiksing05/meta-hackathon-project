package api_test

import (
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/karthiksing05/meta-hackathon-project/backend/internal/api"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/auth"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/pkgstore"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/store"
)

func serverWithDebugDelete(t *testing.T, genURL string, on bool) *httptest.Server {
	t.Helper()
	pk, err := pkgstore.NewLocal(t.TempDir(), pkgstore.Limits{MaxUploadBytes: 5 << 20, MaxUnpackedBytes: 10 << 20, MaxFileBytes: 5 << 20})
	if err != nil {
		t.Fatal(err)
	}
	s := api.New(api.Options{
		Store: store.NewMemory(), Packages: pk, Signer: auth.NewSigner([]byte(strings.Repeat("k", 32)), time.Minute),
		RefreshTTL: time.Hour, GamesBaseURL: "https://games.example.com", MaxUploadMB: 5,
		GeneratorURL: genURL, GenerateConcurrent: 2, GeneratePerHour: 20, DebugDelete: on,
	})
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)
	return ts
}

func TestDebugDelete(t *testing.T) {
	gen := newFakeGenerator(t)
	for _, on := range []bool{false, true} {
		ts := serverWithDebugDelete(t, gen.URL, on)
		tok := register(t, ts, "maker")
		gen.mu.Lock()
		gen.manifest = strings.Replace(fakeManifest, "mg-fog-walk-k3x9", map[bool]string{false: "off-game", true: "on-game"}[on], 1)
		gen.mu.Unlock()
		_, o := startJob(t, ts, tok, map[string]any{"request": "a game"})
		id := waitJob(t, ts, tok, o["jobId"].(string), "done")["game"].(map[string]any)["id"].(string)
		// no sign-in, and not the owner: that is the point of it
		code, _ := do(t, "DELETE", ts.URL+"/v1/debug/games/"+id, "", nil, "")
		if !on {
			if code != 403 {
				t.Fatalf("debug delete is off: %d", code)
			}
			if c, _ := do(t, "GET", ts.URL+"/v1/games/"+id, "", nil, ""); c != 200 {
				t.Fatalf("the game must still be there when debug delete is off: %d", c)
			}
			continue
		}
		if code != 204 {
			t.Fatalf("debug delete is on: %d", code)
		}
		if c, _ := do(t, "GET", ts.URL+"/v1/games/"+id, "", nil, ""); c != 404 {
			t.Fatalf("after a debug delete: %d", c)
		}
		if c, _ := do(t, "DELETE", ts.URL+"/v1/debug/games/"+id, "", nil, ""); c != 404 {
			t.Fatalf("deleting it again: %d", c)
		}
		if _, feed := do(t, "GET", ts.URL+"/v1/feed", "", nil, ""); len(feed["items"].([]any)) != 0 {
			t.Fatalf("the feed after the delete: %v", feed)
		}
	}
}
