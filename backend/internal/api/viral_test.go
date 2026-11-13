package api_test

import (
	"context"
	"fmt"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/karthiksing05/meta-hackathon-project/backend/internal/api"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/auth"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/pkgstore"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/recs"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/store"
)

func serverForViral(t *testing.T, v api.ViralOptions) (*httptest.Server, *api.Server) {
	t.Helper()
	pk, err := pkgstore.NewLocal(t.TempDir(), pkgstore.Limits{MaxUploadBytes: 5 << 20, MaxUnpackedBytes: 10 << 20, MaxFileBytes: 5 << 20})
	if err != nil {
		t.Fatal(err)
	}
	if sharedEngine == nil {
		if sharedEngine, err = recs.New(recs.Options{Runtimes: 2}); err != nil {
			t.Fatal(err)
		}
	}
	s := api.New(api.Options{
		Store: store.NewMemory(), Packages: pk, Signer: auth.NewSigner([]byte(strings.Repeat("k", 32)), time.Minute),
		RefreshTTL: time.Hour, GamesBaseURL: "https://games.example.com", MaxUploadMB: 5, Recs: sharedEngine, Viral: v,
	})
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)
	return ts, s
}

func taste(t *testing.T, ts *httptest.Server, tok, loved, skipped string, pages int) {
	t.Helper()
	var events []any
	for i := 0; i < pages; i++ {
		events = append(events,
			map[string]any{"eventID": fmt.Sprintf("l%d", i), "gameID": loved, "feedItemID": fmt.Sprintf("fl%d", i), "dwellSec": 20, "tookOver": true, "runsFinished": 2, "replays": 2, "saved": true, "floated": true})
		if skipped != "" { // a skip teaches a dislike, which pulls the taste away from what was loved
			events = append(events, map[string]any{"eventID": fmt.Sprintf("s%d", i), "gameID": skipped, "feedItemID": fmt.Sprintf("fs%d", i), "dwellSec": 0.4})
		}
	}
	if code, out := post(t, ts.URL, tok, map[string]any{"events": events}); code != 202 {
		t.Fatalf("events: %d %v", code, out)
	}
}

func TestViralMatch(t *testing.T) {
	ts, srv := serverForViral(t, api.ViralOptions{MinPlayers: 4, MinPages: 5, Window: 72 * time.Hour})
	maker := register(t, ts, "maker")
	ids := publishGames(t, ts, maker) // dodge-a, time-a, merge-a, guess-a, group-a, answer-a
	dodge, merge := ids[0], ids[2]
	mk := func(slug, formula, mood, energy, look string) string {
		m := fmt.Sprintf(`{"id":%q,"title":%q,"one_line_rule":"x","formula":%q,"brief":{"mood":[%q],"energy":%q,"competition":"light"},"style":{"look":%q},"structure":{"scope":"everyone"}}`,
			slug, "Game "+slug, formula, mood, energy, look)
		code, g := publish(t, ts.URL, maker, m)
		if code != 201 {
			t.Fatalf("publish %s: %d %v", slug, code, g)
		}
		return g["id"].(string)
	}
	hot := mk("merge-hot", "merge", "calm", "low", "paper")

	// two people whose taste is calm merge games, one whose taste is dodge, one who has barely played
	calm1, calm2 := register(t, ts, "calm1"), register(t, ts, "calm2")
	hype, newbie := register(t, ts, "hype"), register(t, ts, "newbie")
	taste(t, ts, calm1, merge, "", 12)
	taste(t, ts, calm2, merge, "", 12)
	taste(t, ts, hype, dodge, "", 12)
	taste(t, ts, newbie, merge, "", 2)  // too few pages
	played := register(t, ts, "played") // loves them too, but already played the hot game
	taste(t, ts, played, merge, "", 12)

	// not viral yet: three players is under the line of four
	play := func(tok string, game string, n int) {
		var evs []any
		for i := 0; i < n; i++ {
			evs = append(evs, map[string]any{"type": "play", "gameId": game, "clientEventId": fmt.Sprintf("p-%s-%d", game, i)})
		}
		if code, out := post(t, ts.URL, tok, map[string]any{"events": evs}); code != 202 {
			t.Fatalf("play events: %d %v", code, out)
		}
	}
	crowd := []string{register(t, ts, "crowd1"), register(t, ts, "crowd2"), register(t, ts, "crowd3")}
	for _, c := range crowd {
		play(c, hot, 1)
	}
	if n, err := srv.ScanViral(context.Background(), time.Now().UTC()); err != nil || n != 0 {
		t.Fatalf("a game with 3 players is not viral yet: %d %v", n, err)
	}

	play(played, hot, 1) // the fourth player
	n, err := srv.ScanViral(context.Background(), time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}
	got := func(tok string) int { return countKind(inbox(t, ts, tok, ""), "viral_match") }
	if got(calm1) != 1 || got(calm2) != 1 || n < 2 {
		t.Fatalf("the people whose taste fits should hear about it once: calm1 %d calm2 %d (notified %d)", got(calm1), got(calm2), n)
	}
	for name, tok := range map[string]string{"hype": hype, "newbie": newbie, "played": played, "maker": maker, "crowd": crowd[0]} {
		if got(tok) != 0 {
			t.Errorf("%s must not be told", name)
		}
	}
	item := inbox(t, ts, calm1, "")["items"].([]any)[0].(map[string]any)
	if item["kind"] != "viral_match" || item["gameId"] != hot || !strings.Contains(item["title"].(string), "Game merge-hot") {
		t.Fatalf("the notification: %v", item)
	}

	// a second scan changes nothing, and a second viral game the same day is held back by the daily cap
	srv.ScanViral(context.Background(), time.Now().UTC())
	hot2 := mk("merge-hot2", "merge", "calm", "low", "paper")
	for _, c := range append(crowd, played) {
		play(c, hot2, 1)
	}
	srv.ScanViral(context.Background(), time.Now().UTC())
	if got(calm1) != 1 || got(calm2) != 1 {
		t.Fatalf("at most one viral notification a day: %d %d", got(calm1), got(calm2))
	}
	// the next day the cap is gone
	srv.ScanViral(context.Background(), time.Now().UTC().Add(25*time.Hour))
	if got(calm1) != 2 {
		t.Fatalf("a day later the second game can be told: %d", got(calm1))
	}
}
