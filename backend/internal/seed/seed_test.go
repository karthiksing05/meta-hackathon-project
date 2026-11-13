package seed_test

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/karthiksing05/meta-hackathon-project/backend/internal/api"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/auth"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/pkgstore"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/recs"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/seed"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/store"
)

func setup(t *testing.T) (store.Store, *api.Server, *httptest.Server) {
	t.Helper()
	st := store.NewMemory()
	pk, err := pkgstore.NewLocal(t.TempDir(), pkgstore.Limits{MaxUploadBytes: 50 << 20, MaxUnpackedBytes: 100 << 20, MaxFileBytes: 50 << 20})
	if err != nil {
		t.Fatal(err)
	}
	engine, err := recs.New(recs.Options{Runtimes: 2})
	if err != nil {
		t.Fatal(err)
	}
	srv := api.New(api.Options{Store: st, Packages: pk, Signer: auth.NewSigner([]byte(strings.Repeat("k", 32)), time.Minute),
		RefreshTTL: time.Hour, GamesBaseURL: "https://games.example.com", MaxUploadMB: 50, Recs: engine})
	ts := httptest.NewServer(srv.Handler())
	t.Cleanup(ts.Close)
	return st, srv, ts
}

func call(t *testing.T, method, url, token string, body any) (int, map[string]any) {
	t.Helper()
	var rd io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = strings.NewReader(string(b))
	}
	req, _ := http.NewRequest(method, url, rd)
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
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

func TestSeedAndUseIt(t *testing.T) {
	st, srv, ts := setup(t)
	ctx := context.Background()
	log := slog.New(slog.NewTextHandler(io.Discard, nil))

	rep, err := seed.Run(ctx, st, srv, log)
	if err != nil {
		t.Fatal(err)
	}
	if rep.Users != 11 || rep.Games != 32 || rep.Groups != 2 || rep.Skipped != 0 || rep.Scores < 200 || rep.Friendships != 9 {
		t.Fatalf("first run: %+v", rep)
	}
	// running it again changes nothing
	again, err := seed.Run(ctx, st, srv, log)
	if err != nil || again.Games != 0 || again.Users != 0 || again.Skipped != 32 {
		t.Fatalf("second run: %+v %v", again, err)
	}

	games, _ := st.AllGames(ctx, 100)
	if len(games) != 32 {
		t.Fatalf("games on the server: %d", len(games))
	}
	bySlug := map[string]string{}
	for _, g := range games {
		bySlug[g.Slug] = g.ID
	}
	night, _ := st.GameBySlug(ctx, "remix-night-hop-fog")
	if night.RemixOf != bySlug["remix-hill-hopper-night-hop"] {
		t.Fatalf("a remix points at its original: %+v", night.RemixOf)
	}
	if o, _ := st.GameBySlug(ctx, "aboutme-maya-first-month"); o.OwnerID != "sf-maya-okafor" {
		t.Fatalf("owner by name: %s", o.OwnerID)
	}
	if g, _ := st.GameBySlug(ctx, "newinsf-daily-fog-words"); g.GroupID != "group-newinsf" || g.Scope != "group" {
		t.Fatalf("group game: %+v", g)
	}
	if maya, _ := st.UserByID(ctx, "sf-maya-okafor"); !maya.Synthetic || maya.Skill < 0.85 || maya.PasswordHash != "" {
		t.Fatalf("a demo person: %+v", maya)
	}
	// nobody can sign in as a demo person
	if code, _ := call(t, "POST", ts.URL+"/v1/auth/login", "", map[string]string{"email": "sf-maya-okafor@cast.invalid", "password": "anything at all"}); code != 401 {
		t.Fatalf("signing in as a demo person: %d", code)
	}

	// A real person arrives, makes friends with the cast and joins the Group: the feed, search and Blend use it.
	_, reg := call(t, "POST", ts.URL+"/v1/auth/register", "", map[string]string{"email": "me@example.com", "username": "me_user", "password": "a long password"})
	tok := reg["accessToken"].(string)
	for _, id := range []string{"sf-maya-okafor", "sf-diego-ramirez", "sf-aiko-tanaka"} {
		if code, _ := call(t, "PUT", ts.URL+"/v1/me/friends/"+id, tok, nil); code != 200 {
			t.Fatalf("friend %s: %d", id, code)
		}
	}
	if code, _ := call(t, "PUT", ts.URL+"/v1/groups/group-newinsf/members/me", tok, nil); code != 200 {
		t.Fatalf("join: %d", code)
	}
	_, feed := call(t, "GET", ts.URL+"/v1/feed?limit=20&sessionID=a", tok, nil)
	items := feed["items"].([]any)
	if len(items) != 20 {
		t.Fatalf("feed: %d items", len(items))
	}
	reasons := map[any]int{}
	for _, it := range items {
		reasons[it.(map[string]any)["reason"]]++
	}
	if reasons["friendBurst"] == 0 {
		t.Fatalf("with friends who play, some pages are from your people: %v", reasons)
	}
	if _, g := call(t, "GET", ts.URL+"/v1/groups/group-newinsf/games", tok, nil); len(g["items"].([]any)) != 10 {
		t.Fatalf("group games: %d", len(g["items"].([]any)))
	}
	code, bl := call(t, "POST", ts.URL+"/v1/groups/group-newinsf/blend", tok, map[string]any{"count": 5})
	if code != 200 || len(bl["picks"].([]any)) != 5 {
		t.Fatalf("group blend: %d %v", code, bl)
	}
	_, lb := call(t, "GET", ts.URL+"/v1/games/hill-hopper/leaderboard", "", nil)
	rows := lb["items"].([]any)
	if len(rows) < 8 || rows[0].(map[string]any)["score"].(float64) < rows[len(rows)-1].(map[string]any)["score"].(float64) {
		t.Fatalf("a board from the bots' runs, best first: %v", lb)
	}
}
