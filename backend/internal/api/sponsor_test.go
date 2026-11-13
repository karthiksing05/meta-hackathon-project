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

func serverWithBrands(t *testing.T, genURL string, brands ...string) *httptest.Server {
	t.Helper()
	pk, err := pkgstore.NewLocal(t.TempDir(), pkgstore.Limits{MaxUploadBytes: 5 << 20, MaxUnpackedBytes: 10 << 20, MaxFileBytes: 5 << 20})
	if err != nil {
		t.Fatal(err)
	}
	set := map[string]bool{}
	for _, b := range brands {
		set[b] = true
	}
	s := api.New(api.Options{
		Store: store.NewMemory(), Packages: pk, Signer: auth.NewSigner([]byte(strings.Repeat("k", 32)), time.Minute),
		RefreshTTL: time.Hour, GamesBaseURL: "https://games.example.com", MaxUploadMB: 5,
		GeneratorURL: genURL, GenerateConcurrent: 2, GeneratePerHour: 20, SponsorUsers: set,
	})
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)
	return ts
}

func TestSponsoredGames(t *testing.T) {
	gen := newFakeGenerator(t)
	ts := serverWithBrands(t, gen.URL, "fizzco")
	brand, fan := register(t, ts, "fizzco"), register(t, ts, "fan")

	// a game made by the brand
	_, o := startJob(t, ts, brand, map[string]any{"request": "a soda stacking game"})
	game := waitJob(t, ts, brand, o["jobId"].(string), "done")["game"].(map[string]any)
	id := game["id"].(string)
	if game["sponsor"] != nil {
		t.Fatalf("a game is not sponsored by default: %v", game["sponsor"])
	}
	put := func(tok, gameID string, body map[string]any) (int, map[string]any) {
		return do(t, "PUT", ts.URL+"/v1/games/"+gameID+"/sponsor", tok, js(body), "application/json")
	}

	// only a brand account can sponsor, and only its own game
	gen.mu.Lock()
	gen.manifest = strings.Replace(fakeManifest, "mg-fog-walk-k3x9", "fan-game", 1)
	gen.mu.Unlock()
	_, fo := startJob(t, ts, fan, map[string]any{"request": "a fan game"})
	fanGame := waitJob(t, ts, fan, fo["jobId"].(string), "done")["game"].(map[string]any)["id"].(string)
	if code, _ := put(fan, fanGame, map[string]any{"name": "Fake Brand"}); code != 403 {
		t.Fatalf("a fan sponsoring their own game: %d", code)
	}
	if code, _ := put(brand, fanGame, map[string]any{"name": "Fizz Co"}); code != 404 {
		t.Fatalf("a brand sponsoring someone else's game: %d", code)
	}
	for _, bad := range []map[string]any{
		{"cta": "Play"}, {"name": strings.Repeat("x", 61)}, {"name": "Fizz", "avatarUrl": "javascript:alert(1)"},
		{"name": "Fizz", "url": "ftp://x.example"}, {"name": "Fizz", "cta": strings.Repeat("y", 25)},
	} {
		if code, _ := put(brand, id, bad); code != 400 {
			t.Fatalf("%v: %d", bad, code)
		}
	}

	code, g := put(brand, id, map[string]any{"name": "Fizz Co", "avatarUrl": "https://cdn.example.com/fizz.png", "url": "https://fizz.example.com"})
	sp, _ := g["sponsor"].(map[string]any)
	if code != 200 || sp["name"] != "Fizz Co" || sp["cta"] != "Play now" || sp["avatarUrl"] != "https://cdn.example.com/fizz.png" || sp["url"] != "https://fizz.example.com" {
		t.Fatalf("sponsor: %d %v", code, g)
	}

	// it shows on the game, the feed, search and the owner's creations; nobody else sees any other game as sponsored
	_, one := do(t, "GET", ts.URL+"/v1/games/"+id, "", nil, "")
	_, feed := do(t, "GET", ts.URL+"/v1/feed", "", nil, "")
	var inFeed map[string]any
	for _, it := range feed["items"].([]any) {
		if m := it.(map[string]any); m["id"] == id {
			inFeed = m
		}
	}
	if one["sponsor"] == nil || inFeed == nil || inFeed["sponsor"] == nil || inFeed["sponsor"].(map[string]any)["name"] != "Fizz Co" {
		t.Fatalf("the sponsor on a game and its feed item: %v / %v", one["sponsor"], inFeed)
	}
	for _, it := range feed["items"].([]any) {
		if m := it.(map[string]any); m["id"] == fanGame && m["sponsor"] != nil {
			t.Fatalf("a fan's game must not be sponsored: %v", m)
		}
	}

	// a custom call to action, and taking it off
	if _, g := put(brand, id, map[string]any{"name": "Fizz Co", "cta": "Get the drop"}); g["sponsor"].(map[string]any)["cta"] != "Get the drop" {
		t.Fatalf("cta: %v", g["sponsor"])
	}
	if code, g := do(t, "DELETE", ts.URL+"/v1/games/"+id+"/sponsor", brand, nil, ""); code != 200 || g["sponsor"] != nil {
		t.Fatalf("remove: %d %v", code, g["sponsor"])
	}

	// a sponsored game from the start: brand accounts only
	if code, _ := startJob(t, ts, fan, map[string]any{"request": "x", "sponsor": map[string]any{"name": "Fake"}}); code != 403 {
		t.Fatalf("a fan asking for a sponsored game: %d", code)
	}
	if code, _ := startJob(t, ts, brand, map[string]any{"request": "x", "sponsor": map[string]any{"cta": "no name"}}); code != 400 {
		t.Fatalf("a sponsor without a name: %d", code)
	}
	gen.mu.Lock()
	gen.manifest = strings.Replace(fakeManifest, "mg-fog-walk-k3x9", "fizz-ad", 1)
	gen.mu.Unlock()
	_, o = startJob(t, ts, brand, map[string]any{"request": "a soda ad game", "sponsor": map[string]any{"name": "Fizz Co", "cta": "Try it"}})
	if g := waitJob(t, ts, brand, o["jobId"].(string), "done")["game"].(map[string]any); g["sponsor"] == nil || g["sponsor"].(map[string]any)["cta"] != "Try it" {
		t.Fatalf("sponsored from the start: %v", g["sponsor"])
	}

	// a tap on the card is a moment event the log keeps
	ev := map[string]any{"events": []any{map[string]any{"eventID": "tap1", "gameID": id, "kind": "sponsor_tap"}}}
	if code, out := do(t, "POST", ts.URL+"/v1/feed/events", fan, js(ev), "application/json"); code != 200 && code != 202 {
		t.Fatalf("sponsor_tap event: %d %v", code, out)
	}
}

func TestNoBrandAccountsMeansNoSponsors(t *testing.T) {
	gen := newFakeGenerator(t)
	ts := serverWithBrands(t, gen.URL) // none configured
	tok := register(t, ts, "anyone")
	_, o := startJob(t, ts, tok, map[string]any{"request": "a game"})
	id := waitJob(t, ts, tok, o["jobId"].(string), "done")["game"].(map[string]any)["id"].(string)
	if code, _ := do(t, "PUT", ts.URL+"/v1/games/"+id+"/sponsor", tok, js(map[string]any{"name": "Anyone"}), "application/json"); code != 403 {
		t.Fatalf("with no brand accounts: %d", code)
	}
}
