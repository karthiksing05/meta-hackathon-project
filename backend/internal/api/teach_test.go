package api_test

import (
	"context"
	"testing"
	"time"

	"github.com/karthiksing05/meta-hackathon-project/backend/internal/api"
	"github.com/karthiksing05/meta-hackathon-project/backend/internal/model"
)

func eventsOf(t *testing.T, srv *api.Server, kind string) []model.Event {
	t.Helper()
	all, err := srv.Store.ExportEvents(context.Background(), time.Time{}, 10000)
	if err != nil {
		t.Fatal(err)
	}
	var out []model.Event
	for _, e := range all {
		if e.Kind == kind {
			out = append(out, e)
		}
	}
	return out
}

// The app has one Save button and no like, and it reports both flags for that one tap; the recommender must see one save.
func TestALikeCountsAsOneSave(t *testing.T) {
	ts, srv := serverForViral(t, api.ViralOptions{})
	maker, bob := register(t, ts, "maker"), register(t, ts, "bob")
	game := publishGames(t, ts, maker)[0]
	ev := map[string]any{"eventID": "e1", "gameID": game, "feedItemID": "f1", "dwellSec": 5, "liked": true}
	if code, out := post(t, ts.URL, bob, map[string]any{"events": []any{ev}}); code != 202 {
		t.Fatalf("event: %d %v", code, out)
	}
	both := map[string]any{"eventID": "e2", "gameID": game, "feedItemID": "f2", "dwellSec": 5, "liked": true, "saved": true}
	post(t, ts.URL, bob, map[string]any{"events": []any{both}})
	all, _ := srv.Store.ExportEvents(context.Background(), time.Time{}, 100)
	seen := 0
	for _, e := range all {
		if e.FeedItemID == "f1" || e.FeedItemID == "f2" {
			seen++
			if !e.Saved || e.Liked || !e.Credit {
				t.Fatalf("a like must be stored as one save: %+v", e)
			}
		}
	}
	if seen != 2 {
		t.Fatalf("stored %d of 2 page events", seen)
	}
}

// Challenges are the server's: it tells the recommender when one is sent and when it is taken up, once each.
func TestChallengesTeachTheRecommender(t *testing.T) {
	ts, srv := serverForViral(t, api.ViralOptions{})
	maker, ann, bob := register(t, ts, "maker"), register(t, ts, "ann"), register(t, ts, "bob")
	annID, bobID := meID(t, ts, ann), meID(t, ts, bob)
	do(t, "PUT", ts.URL+"/v1/me/friends/"+bobID, ann, nil, "")
	game := publishGames(t, ts, maker)[0]
	score := func(tok string, v int) {
		if code, out := do(t, "POST", ts.URL+"/v1/games/"+game+"/scores", tok, js(map[string]any{"score": v}), "application/json"); code != 200 {
			t.Fatalf("score: %d %v", code, out)
		}
	}

	score(ann, 5)
	if code, out := do(t, "POST", ts.URL+"/v1/challenges", ann, js(map[string]any{"gameId": game, "toUserIds": []string{bobID}}), "application/json"); code != 201 {
		t.Fatalf("challenge: %d %v", code, out)
	}
	sent := eventsOf(t, srv, "challenge_sent")
	if len(sent) != 1 || sent[0].UserID != annID || sent[0].GameID != game || len(sent[0].With) != 0 || !sent[0].SocialMoment {
		t.Fatalf("challenge_sent: %+v", sent)
	}
	if n := len(eventsOf(t, srv, "challenge_accepted")); n != 0 {
		t.Fatalf("nobody has answered yet: %d", n)
	}

	score(ann, 9) // the sender playing on is not accepting
	if n := len(eventsOf(t, srv, "challenge_accepted")); n != 0 {
		t.Fatalf("the sender cannot accept their own challenge: %d", n)
	}
	score(bob, 3)
	score(bob, 4) // playing again does not count twice
	acc := eventsOf(t, srv, "challenge_accepted")
	if len(acc) != 1 || acc[0].UserID != bobID || acc[0].GameID != game {
		t.Fatalf("challenge_accepted: %+v", acc)
	}

	// these events never become a second moment for the other person
	_, ms := do(t, "GET", ts.URL+"/v1/me/moments", bob, nil, "")
	n := 0
	for _, m := range ms["moments"].([]any) {
		if k := m.(map[string]any)["kind"]; k == "challenge_sent" || k == "challenge_accepted" {
			n++
		}
	}
	if n != 0 {
		t.Fatalf("moments: %v", ms)
	}
}
